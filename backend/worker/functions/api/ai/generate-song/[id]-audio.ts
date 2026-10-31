/**
 * VinaX music AI — GET /api/ai/generate-song/:jobId/audio: a finished
 * generated song, from Worker storage, until it expires. The job id is a
 * random UUID and works as the address's key, because an <audio> element
 * cannot send a session; nothing about the listener is in it. Byte ranges are
 * answered, so the player can seek.
 *
 *   → 200 | 206 audio/* · 404 not_found · 416 range_not_satisfiable
 */
import { CORS, json } from '../../../_lib/authShared';
import { audioKey, storageOf, type GenEnv } from '../../../_lib/ai/songGen';
import { JOB_ID } from './[id]';

interface Ctx { request: Request; env: GenEnv; params: { id?: string } }

interface KvWithMeta {
  getWithMetadata?(key: string, type: 'arrayBuffer'): Promise<{ value: ArrayBuffer | null; metadata: unknown }>;
}

export const onRequestGet = async ({ request, env, params }: Ctx): Promise<Response> => {
  const id = String(params.id ?? '');
  const kv = storageOf(env);
  if (!JOB_ID.test(id) || !kv) return json({ error: 'not_found' }, 404);
  const withMeta = (kv as unknown as KvWithMeta).getWithMetadata;
  const got = withMeta ? await withMeta.call(kv, audioKey(id), 'arrayBuffer').catch(() => null) : { value: await kv.get(audioKey(id), 'arrayBuffer').catch(() => null), metadata: null };
  const bytes = got?.value;
  if (!bytes) return json({ error: 'not_found' }, 404);
  const meta = got.metadata && typeof got.metadata === 'object' ? (got.metadata as { mime?: unknown }) : {};
  const mime = typeof meta.mime === 'string' && /^audio\/[\w.+-]+$/.test(meta.mime) ? meta.mime : 'audio/mpeg';
  const headers: Record<string, string> = {
    'content-type': mime,
    'accept-ranges': 'bytes',
    'cache-control': 'private, max-age=3600',
    'x-content-type-options': 'nosniff',
    'content-disposition': 'inline',
    ...CORS,
  };
  const size = bytes.byteLength;
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '');
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2] || 0));
    const end = range[1] && range[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
    if (!Number.isFinite(start) || start >= size || start > end) return new Response(null, { status: 416, headers: { ...headers, 'content-range': `bytes */${size}` } });
    return new Response(bytes.slice(start, end + 1), { status: 206, headers: { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': String(end - start + 1) } });
  }
  return new Response(bytes, { status: 200, headers: { ...headers, 'content-length': String(size) } });
};
