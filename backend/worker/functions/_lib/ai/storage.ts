/**
 * VinaX AI — the private Supabase Storage bucket `ai-attachments`, reached
 * only from the Worker with the service-role key (REST paths as the official
 * storage client uses them):
 *
 *   upload    POST   /storage/v1/object/ai-attachments/<path>
 *   download  GET    /storage/v1/object/ai-attachments/<path>
 *   remove    DELETE /storage/v1/object/ai-attachments   { prefixes: [paths] }
 *
 * Objects live at `<account id>/<conversation id or "new">/<attachment id>`.
 * Nothing here ever hands out a public or signed URL: files reach the page
 * through GET /api/ai/attachments/:id after an ownership check.
 */
import { dbConfigured, type DbEnv } from '../db';

export const BUCKET = 'ai-attachments';
const TIMEOUT_MS = 30_000;

function base(env: DbEnv): { url: string; key: string } | null {
  if (!dbConfigured(env)) return null;
  return { url: `${env.SUPABASE_URL!.trim().replace(/\/+$/, '')}/storage/v1/object`, key: env.SUPABASE_SERVICE_ROLE_KEY!.trim() };
}

const enc = (path: string): string => path.split('/').map(encodeURIComponent).join('/');

/** Store bytes (or a stream of known length) at `path`. Never overwrites. */
export async function storagePut(env: DbEnv, path: string, body: BodyInit, mime: string, length?: number): Promise<boolean> {
  const b = base(env);
  if (!b) return false;
  try {
    const res = await fetch(`${b.url}/${BUCKET}/${enc(path)}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${b.key}`, apikey: b.key, 'content-type': mime, 'x-upsert': 'false', 'cache-control': 'private, max-age=0',
        ...(length != null ? { 'content-length': String(length) } : {}),
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // A stream body must be sent half-duplex.
      ...(body instanceof ReadableStream ? { duplex: 'half' } : {}),
    } as RequestInit);
    await res.body?.cancel().catch(() => undefined);
    return res.ok;
  } catch {
    return false;
  }
}

/** The stored object's response (stream it on), or null. */
export async function storageGet(env: DbEnv, path: string): Promise<Response | null> {
  const b = base(env);
  if (!b) return null;
  try {
    const res = await fetch(`${b.url}/${BUCKET}/${enc(path)}`, { headers: { authorization: `Bearer ${b.key}`, apikey: b.key }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    return res;
  } catch {
    return null;
  }
}

/** Remove objects (best effort, in batches). */
export async function storageRemove(env: DbEnv, paths: string[]): Promise<boolean> {
  const b = base(env);
  if (!b || !paths.length) return !!b;
  let ok = true;
  for (let i = 0; i < paths.length; i += 500) {
    try {
      const res = await fetch(`${b.url}/${BUCKET}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${b.key}`, apikey: b.key, 'content-type': 'application/json' },
        body: JSON.stringify({ prefixes: paths.slice(i, i + 500) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      await res.body?.cancel().catch(() => undefined);
      ok = ok && res.ok;
    } catch {
      ok = false;
    }
  }
  return ok;
}
