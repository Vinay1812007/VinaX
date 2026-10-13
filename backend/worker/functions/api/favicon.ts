/**
 * 12.0 — GET /api/favicon?host=example.com → the site's small logo, for the
 * source chips, the Sources list and the Trending strip. Loaded through the
 * Worker so a listener's browser never asks a third party which sites their
 * answers cited. Public host names only (_lib/chatExtras.ts logoHost); cached
 * at the edge and in the browser for a week. 404 → the page shows the site's
 * letter instead.
 */
import { logoHost } from '../_lib/chatExtras';
import { methodNotAllowed, rateLimitAsync } from '../_lib/ratelimit';

const WEEK = 7 * 24 * 3600;
const MAX_BYTES = 100_000;

interface EdgeCache {
  match(key: Request): Promise<Response | undefined>;
  put(key: Request, res: Response): Promise<void>;
}
const edgeCache = (): EdgeCache | null => (globalThis as { caches?: { default?: EdgeCache } }).caches?.default ?? null;

const notFound = (): Response => new Response(null, { status: 404, headers: { 'cache-control': 'public, max-age=86400' } });

export const onRequestGet = async (context: { request: Request; env: Record<string, unknown>; waitUntil?: (p: Promise<unknown>) => void }): Promise<Response> => {
  const { request, env, waitUntil } = context;
  const url = new URL(request.url);
  const host = logoHost(url.searchParams.get('host'));
  if (!host) return notFound();
  const key = new Request(`${url.origin}/api/favicon?host=${host}`, { method: 'GET' });
  const cache = edgeCache();
  const hit = cache ? await cache.match(key).catch(() => undefined) : undefined;
  if (hit) return hit;
  const limited = await rateLimitAsync(request, 'favicon', { capacity: 120, refillPerMinute: 120 }, env);
  if (limited) return limited;
  try {
    const up = await fetch(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`, { signal: AbortSignal.timeout(4_000) });
    const type = (up.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!up.ok || !/^image\/(?:png|x-icon|vnd\.microsoft\.icon|jpeg|gif|webp)$/.test(type)) return notFound();
    const body = await up.arrayBuffer();
    if (!body.byteLength || body.byteLength > MAX_BYTES) return notFound();
    const res = new Response(body, {
      headers: { 'content-type': type, 'cache-control': `public, max-age=${WEEK}`, 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'" },
    });
    if (cache) {
      const put = cache.put(key, res.clone()).catch(() => undefined);
      if (waitUntil) waitUntil(put);
    }
    return res;
  } catch {
    return notFound();
  }
};

export const onRequestPost = async (): Promise<Response> => methodNotAllowed();
