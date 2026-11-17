/**
 * GET /api/charts/vinax → { updatedAt, days, minListeners, songs: [{ id, title, artist, image, rank }] }
 *
 * "Most played on VinaX this week": the console's Trending numbers
 * (stats_trending(7, 100) in supabase/schema.sql) cut down to a public chart.
 *
 *   - What it counts: play events from the usage sharing of devices that
 *     belong to a signed-in account (signed_devices()), over the last 7 India
 *     calendar days. Ranked by plays.
 *   - A song is listed only when at least MIN_LISTENERS different ACCOUNTS
 *     played it, and only when it has a catalogue id (so it can be played).
 *     Ranks are renumbered 1..n after that cut.
 *   - Only id, title, artist, image and rank leave the Worker: never play
 *     counts, listener counts, previous ranks or the daily series.
 *
 * Cost: one database call every CACHE_S per place at most. The answer is kept
 * in the isolate and in the edge cache (caches.default, a synthetic key) for
 * three hours, and the response carries s-maxage for any cache in front. A
 * database failure answers an empty list, cached for a few minutes only, so
 * the app falls back to its catalogue list instead of breaking.
 */
import { db, type DbEnv } from '../../_lib/db';

export const CHART_DAYS = 7;
/** stats_trending's own ceiling (p_limit is clamped to 1..100). */
export const CHART_POOL = 100;
export const MIN_LISTENERS = 5;
/** Three hours. */
export const CACHE_S = 3 * 60 * 60;
const EMPTY_CACHE_S = 5 * 60;
const EDGE_KEY = 'https://vinax-charts.internal/v1/vinax';

export interface ChartSong {
  id: string;
  title: string;
  artist: string;
  image: string | null;
  rank: number;
}
export interface PublicChart {
  updatedAt: string;
  days: number;
  minListeners: number;
  songs: ChartSong[];
}

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
};

const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);

/** stats_trending's answer → the public chart: the listener cut, public fields only, ranks renumbered. */
export function publicChart(data: unknown, now = new Date()): PublicChart {
  const raw = data && typeof data === 'object' ? (data as { songs?: unknown }).songs : null;
  const rows = Array.isArray(raw) ? raw : [];
  const kept = rows
    .map((r) => (r && typeof r === 'object' ? (r as Record<string, unknown>) : {}))
    .filter((r) => num(r.listeners) >= MIN_LISTENERS && text(r.id, 64) && text(r.title, 200))
    .sort((a, b) => num(a.rank) - num(b.rank));
  const seen = new Set<string>();
  const songs: ChartSong[] = [];
  for (const r of kept) {
    const id = text(r.id, 64);
    if (seen.has(id)) continue;
    seen.add(id);
    const image = text(r.image, 500);
    songs.push({ id, title: text(r.title, 200), artist: text(r.artist, 200), image: /^https:\/\//.test(image) ? image : null, rank: songs.length + 1 });
  }
  return { updatedAt: now.toISOString(), days: CHART_DAYS, minListeners: MIN_LISTENERS, songs };
}

/** The isolate's copy and when it runs out (a failure is remembered for a few minutes only). */
let memo: { until: number; body: string } | null = null;
/** Tests: forget the isolate's copy. */
export function resetChartMemo(): void {
  memo = null;
}

const edgeCache = (): Cache | null => (globalThis as { caches?: { default?: Cache } }).caches?.default ?? null;

function respond(body: string, maxAge: number): Response {
  return new Response(body, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${Math.min(maxAge, 30 * 60)}, s-maxage=${maxAge}`,
      ...CORS,
    },
  });
}

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: CORS });

export const onRequestGet = async (context: { request: Request; env?: DbEnv; waitUntil?: (p: Promise<unknown>) => void }): Promise<Response> => {
  const now = Date.now();
  if (memo && now < memo.until) return respond(memo.body, Math.max(60, Math.floor((memo.until - now) / 1000)));

  const cache = edgeCache();
  if (cache) {
    try {
      const hit = await cache.match(EDGE_KEY);
      if (hit) {
        const body = await hit.text();
        const at = Date.parse(String((JSON.parse(body) as { updatedAt?: unknown }).updatedAt));
        if (Number.isFinite(at) && now - at < CACHE_S * 1000) {
          memo = { until: at + CACHE_S * 1000, body };
          return respond(body, Math.max(60, CACHE_S - Math.floor((now - at) / 1000)));
        }
      }
    } catch {
      /* the cache is best-effort */
    }
  }

  const r = await db.rpc<unknown>(context.env ?? {}, 'stats_trending', { p_days: CHART_DAYS, p_limit: CHART_POOL });
  if (!r.ok) {
    const empty = JSON.stringify(publicChart(null, new Date(now)));
    memo = { until: now + EMPTY_CACHE_S * 1000, body: empty };
    return respond(empty, EMPTY_CACHE_S);
  }

  const body = JSON.stringify(publicChart(r.value, new Date(now)));
  memo = { until: now + CACHE_S * 1000, body };
  if (cache) {
    const put = cache.put(EDGE_KEY, respond(body, CACHE_S)).catch(() => undefined);
    if (context.waitUntil) context.waitUntil(put);
    else await put;
  }
  return respond(body, CACHE_S);
};
