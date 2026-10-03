/**
 * GET /api/discover?region=&language=&intent=&wait=
 *
 * Live-web music discovery: songs that current web sources name, each resolved
 * to a real catalogue recording, with the source URL, the kind of source, when
 * it was observed and the publication or chart period where the evidence states
 * one. The logic (and every budget, quota and honesty rule) is in
 * _lib/discovery.ts.
 *
 * Two modes, because playback must never wait on a web search:
 *
 *   default      answer from the cache. A miss returns `state: "cold"` with no
 *                items and starts a refresh in the background (waitUntil), so
 *                the NEXT caller gets evidence. A song transition uses this.
 *   wait=1       run the discovery and wait for it, inside its own budget. The
 *                AI Playlist, Radio and the "find something current" paths use
 *                this, where the listener is already waiting for a result.
 *
 * Public, no auth, and no listener data in or out: the query is a region, a
 * language and an intent. Edge-cached briefly so a popular question costs one
 * run per colo rather than one per listener; an answer with no items is cached
 * for seconds only.
 */
import {
  cachedDiscovery,
  discoverMusic,
  discoveryHealth,
  type DiscoveryEnv,
  type DiscoveryIntent,
  type DiscoveryQuery,
  type DiscoveryResult,
} from '../_lib/discovery';
import { methodNotAllowed } from '../_lib/ratelimit';

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type, x-vinax-client',
};

const INTENTS: DiscoveryIntent[] = ['new-releases', 'charting', 'trending-songs'];
const REGION_RE = /^[A-Z]{2}$/;
const LANGUAGE_RE = /^[a-z]{2,20}$/;

export interface DiscoverQuery extends DiscoveryQuery {
  wait: boolean;
}

/** Validate the query string. Anything unknown falls back to a safe default. */
export function parseDiscoverQuery(url: URL): DiscoverQuery {
  const region = (url.searchParams.get('region') ?? '').trim().toUpperCase();
  const language = (url.searchParams.get('language') ?? '').trim().toLowerCase();
  const intent = (url.searchParams.get('intent') ?? '').trim().toLowerCase() as DiscoveryIntent;
  const wait = url.searchParams.get('wait');
  return {
    region: REGION_RE.test(region) ? region : 'IN',
    language: LANGUAGE_RE.test(language) ? language : null,
    intent: INTENTS.includes(intent) ? intent : 'trending-songs',
    wait: wait === '1' || wait === 'true',
  };
}

/** The wire shape. `state` is always honest about where the answer came from. */
export interface DiscoverBody {
  state: DiscoveryResult['state'] | 'cold';
  /** When the evidence behind `items` was observed. Null when there is none. */
  evidenceAt: string | null;
  /** True when the evidence is older than the freshness window. */
  stale: boolean;
  region: string;
  language: string | null;
  intent: DiscoveryIntent;
  items: DiscoveryResult['items'];
  note: string;
  /** Operational state, so a shelf (and the owner console) can say why there is nothing. */
  health: ReturnType<typeof discoveryHealth>;
}

const body = (q: DiscoverQuery, result: DiscoveryResult | null, env: DiscoveryEnv, now: number): DiscoverBody => ({
  state: result?.state ?? 'cold',
  evidenceAt: result?.evidenceAt ?? null,
  stale: result?.state === 'stale',
  region: q.region,
  language: q.language,
  intent: q.intent,
  items: result?.items ?? [],
  note: result?.note ?? 'No evidence cached yet for this question; a refresh has been started.',
  health: discoveryHealth(env, now),
});

function json(value: DiscoverBody, cacheControl: string): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cacheControl, ...CORS },
  });
}

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: CORS });
export const onRequestPost = async (): Promise<Response> => methodNotAllowed();

export const onRequestGet = async (context: {
  request: Request;
  env: DiscoveryEnv;
  waitUntil?: (p: Promise<unknown>) => void;
}): Promise<Response> => {
  const { request, env } = context;
  const now = Date.now();
  const q = parseDiscoverQuery(new URL(request.url));
  const query: DiscoveryQuery = { region: q.region, language: q.language, intent: q.intent };

  if (q.wait) {
    const result = await discoverMusic(env, query);
    // Items are worth a minute at the edge; an empty or failed answer is not.
    return json(body(q, result, env, now), result.items.length ? 'public, max-age=60, s-maxage=300' : 'public, max-age=15, s-maxage=30');
  }

  const cached = cachedDiscovery(query, now);
  if (!cached) {
    // Start the run for the next caller; never wait for it here.
    const run = discoverMusic(env, query).catch(() => undefined);
    if (context.waitUntil) context.waitUntil(run);
    return json(body(q, null, env, now), 'no-store');
  }
  return json(body(q, cached, env, now), cached.items.length ? 'public, max-age=60, s-maxage=300' : 'public, max-age=15, s-maxage=30');
};
