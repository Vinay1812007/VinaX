/**
 * GET /api/trends?region=&language=&source=&limit=
 *
 * Verified trends: public-chart and editorial entries that were matched with
 * confidence to catalogue songs, each with its source, rank, evidence link
 * and observation time, plus the status of every source (ok, stale,
 * unavailable, disabled, not_configured). The contract and every threshold
 * are in docs/trends.md; the logic is in _lib/trends/read.ts.
 *
 * Public, no auth, no listener data in or out. Edge-cached for five minutes
 * (Workers cache API) and a minute in the browser; a degraded answer (a
 * database read failed) is cached for 30 seconds only.
 */
import { readPublicTrends } from '../_lib/trends/read';
import { providerById } from '../_lib/trends/registry';
import { configuredRegions, REGION_RE, type TrendsEnv } from '../_lib/trends/types';

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
};

function json(body: unknown, cacheControl: string, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cacheControl, ...CORS },
  });
}

interface EdgeCache {
  match(key: Request): Promise<Response | undefined>;
  put(key: Request, res: Response): Promise<void>;
}

function edgeCache(): EdgeCache | null {
  const c = (globalThis as { caches?: { default?: EdgeCache } }).caches;
  return c && c.default ? c.default : null;
}

export interface TrendsQuery {
  region: string;
  language: string | null;
  source: string | null;
  limit: number;
}

/**
 * Validate the query string; anything unknown falls back to a safe default
 * rather than failing. A region that is not ingested (TRENDS_REGIONS) falls
 * back to the first one that is: every source and item names its region, so
 * the answer stays truthful instead of reporting a working source as down.
 */
export function parseTrendsQuery(url: URL, env: TrendsEnv): TrendsQuery {
  const region = (url.searchParams.get('region') ?? '').trim().toUpperCase();
  const language = (url.searchParams.get('language') ?? '').trim().toLowerCase();
  const source = (url.searchParams.get('source') ?? '').trim().toLowerCase();
  const limit = Number.parseInt(url.searchParams.get('limit') ?? '', 10);
  const ingested = configuredRegions(env);
  return {
    region: REGION_RE.test(region) && ingested.includes(region) ? region : ingested[0],
    language: /^[a-z]{2,20}$/.test(language) ? language : null,
    source: source && providerById(source) ? source : null,
    limit: Number.isFinite(limit) ? Math.min(50, Math.max(1, limit)) : 20,
  };
}

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: CORS });

export const onRequestGet = async (context: { request: Request; env: TrendsEnv; waitUntil?: (p: Promise<unknown>) => void }): Promise<Response> => {
  const { request, env } = context;
  const url = new URL(request.url);
  const q = parseTrendsQuery(url, env);
  const key = new Request(`${url.origin}/api/trends?region=${q.region}&language=${q.language ?? ''}&source=${q.source ?? ''}&limit=${q.limit}`);
  const cache = edgeCache();
  if (cache) {
    const hit = await cache.match(key).catch(() => undefined);
    if (hit) return hit;
  }
  try {
    const { body, degraded } = await readPublicTrends(env, q);
    const res = json(body, degraded ? 'public, max-age=15, s-maxage=30' : 'public, max-age=60, s-maxage=300');
    if (cache) {
      const put = cache.put(key, res.clone()).catch(() => undefined);
      if (context.waitUntil) context.waitUntil(put);
    }
    return res;
  } catch {
    return json({ error: 'unavailable' }, 'no-store', 503);
  }
};
