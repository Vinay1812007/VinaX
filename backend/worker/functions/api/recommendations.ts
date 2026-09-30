/**
 * 8.5.0 — GET /api/recommendations — songs like a few songs the app names.
 *
 *   query    seeds      1–5 catalogue song ids (comma list), e.g. the
 *                       listener's most-played songs, chosen ON THE DEVICE
 *            limit?     1–30 (default 20)
 *            languages? comma list (default: any)
 *            exclude?   up to 100 song ids never to return (already queued / played)
 *   200      { seeds: [{ id, title, artist, language }],
 *              tracks: [...same track shape as /api/recommendations/similar/:songId],
 *              source: 'catalogue' }
 *   400      { error: 'bad_request' }     (no seeds, a malformed id, bad limit / languages)
 *   404      { error: 'song_not_found' }  (none of the seeds exist)
 *   429      { error: 'rate_limited', retryAfter }
 *   502      { error: 'catalogue_unavailable' }
 *
 * Why seeds instead of "the signed-in user": VinaX has no accounts and keeps
 * history on the device. The app decides which of its songs to send; the
 * server keeps none of it (private, short cache; no logging of ids).
 */
import { methodNotAllowed, rateLimitAsync } from '../_lib/ratelimit';
import { interleave, MAX_SEEDS, parseIds, parseLanguages, parseLimit, poolsFor, seedOf, selectTracks, type RecTrack } from '../_lib/recs';
import { CatalogUnavailable, lookupCatalogSong } from '../_lib/trends/catalog';

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type, x-vinax-client',
};

function json(body: unknown, status = 200, cache = 'no-store'): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': cache, ...CORS } });
}

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: CORS });
export const onRequestPost = async (): Promise<Response> => methodNotAllowed('GET, OPTIONS');

export const onRequestGet = async (context: { request: Request; env: object }): Promise<Response> => {
  const { request, env } = context;
  // Up to five seeds, two catalogue calls each.
  const limited = await rateLimitAsync(request, 'recs', { capacity: 10, refillPerMinute: 10 }, env);
  if (limited) return limited;
  const url = new URL(request.url);
  const seedIds = parseIds(url.searchParams.get('seeds'), MAX_SEEDS);
  const exclude = parseIds(url.searchParams.get('exclude'), 100);
  const limit = parseLimit(url.searchParams.get('limit'));
  const languages = parseLanguages(url.searchParams.get('languages'));
  if (!seedIds?.length || exclude == null || limit == null || languages == null) return json({ error: 'bad_request' }, 400);
  try {
    const found = (await Promise.all(seedIds.map((id) => lookupCatalogSong(id)))).filter((c): c is NonNullable<typeof c> => c !== null);
    if (!found.length) return json({ error: 'song_not_found' }, 404);
    const seeds = found.map(seedOf);
    const excludeIds = new Set([...exclude, ...seedIds]);
    // A single seed also draws on its artist; several seeds already give enough variety.
    const withArtist = seeds.length === 1;
    const taken = { ids: new Set<string>(), keys: new Set<string>(), perArtist: new Map<string, number>() };
    const artistCap = Math.max(2, Math.ceil(limit / 5));
    const perSeed: RecTrack[][] = [];
    for (const [i, seed] of seeds.entries()) {
      const pools = await poolsFor(seed, withArtist);
      // Other seeds' titles are never recommended back either.
      const others = new Set(seeds.filter((_, j) => j !== i).map((s) => s.id));
      perSeed.push(selectTracks(seed, pools, { limit, languages, excludeIds: new Set([...excludeIds, ...others]), artistCap }, taken));
    }
    return json({ seeds, tracks: interleave(perSeed, limit), source: 'catalogue' }, 200, 'private, max-age=600');
  } catch (e) {
    if (e instanceof CatalogUnavailable) return json({ error: 'catalogue_unavailable' }, 502);
    console.warn('[recs] unhandled:', e instanceof Error ? e.name : 'error');
    return json({ error: 'internal' }, 500);
  }
};
