/**
 * 12.0 — GET /api/webimg?u=<picture address>&s=<signature> → a picture a web
 * search returned, shown inside a VinaX AI reply. Only addresses the chat
 * itself signed load here (_lib/chatExtras.ts signedImagePath), so this is
 * not an open proxy; the listener's browser never contacts the picture's site.
 * Raster images only (never SVG, which could carry script on this origin),
 * at most 3 MB, cached a day.
 */
import { imageSignatureOk, type ImageEnv } from '../_lib/chatExtras';
import { methodNotAllowed, rateLimitAsync } from '../_lib/ratelimit';

const DAY = 24 * 3600;
const MAX_BYTES = 3_000_000;

interface EdgeCache {
  match(key: Request): Promise<Response | undefined>;
  put(key: Request, res: Response): Promise<void>;
}
const edgeCache = (): EdgeCache | null => (globalThis as { caches?: { default?: EdgeCache } }).caches?.default ?? null;
const gone = (status = 404): Response => new Response(null, { status, headers: { 'cache-control': 'public, max-age=3600' } });

export const onRequestGet = async (context: { request: Request; env: ImageEnv & Record<string, unknown>; waitUntil?: (p: Promise<unknown>) => void }): Promise<Response> => {
  const { request, env, waitUntil } = context;
  const url = new URL(request.url);
  const target = url.searchParams.get('u') ?? '';
  const sig = url.searchParams.get('s') ?? '';
  if (!/^https?:\/\//i.test(target) || !(await imageSignatureOk(env, target, sig))) return gone(403);
  const key = new Request(`${url.origin}/api/webimg?u=${encodeURIComponent(target)}`, { method: 'GET' });
  const cache = edgeCache();
  const hit = cache ? await cache.match(key).catch(() => undefined) : undefined;
  if (hit) return hit;
  const limited = await rateLimitAsync(request, 'webimg', { capacity: 60, refillPerMinute: 60 }, env);
  if (limited) return limited;
  try {
    const up = await fetch(target, { headers: { accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif' }, redirect: 'follow', signal: AbortSignal.timeout(6_000) });
    const type = (up.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!up.ok || !/^image\/(?:png|jpeg|jpg|gif|webp|avif)$/.test(type)) return gone();
    const declared = Number(up.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_BYTES) return gone();
    const body = await up.arrayBuffer();
    if (!body.byteLength || body.byteLength > MAX_BYTES) return gone();
    const res = new Response(body, {
      headers: { 'content-type': type, 'cache-control': `public, max-age=${DAY}`, 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'" },
    });
    if (cache) {
      const put = cache.put(key, res.clone()).catch(() => undefined);
      if (waitUntil) waitUntil(put);
    }
    return res;
  } catch {
    return gone();
  }
};

export const onRequestPost = async (): Promise<Response> => methodNotAllowed();
