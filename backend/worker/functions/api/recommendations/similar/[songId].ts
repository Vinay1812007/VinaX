/**
 * 8.5.0 — GET /api/recommendations/similar/:songId — songs like one song.
 *
 *   query    limit?     1–30 (default 20)
 *            languages? comma list, e.g. "telugu,hindi" (default: any)
 *   200      { seed: { id, title, artist, language },
 *              tracks: [{ id, title, artist, artists, album, language, year,
 *                         durationSec, reason: 'similar' | 'same_artist',
 *                         reasonText, seedId }],
 *              source: 'catalogue' }
 *   400      { error: 'invalid_song_id' | 'bad_request' }
 *   404      { error: 'song_not_found' }
 *   429      { error: 'rate_limited', retryAfter }
 *   502      { error: 'catalogue_unavailable' }
 *
 * Anonymous and stateless: nothing about the caller is read or stored, so
 * the answer is the same for everyone and is cached publicly. Every track is
 * a catalogue song (see _lib/recs.ts).
 */
import { methodNotAllowed, rateLimitAsync } from '../../../_lib/ratelimit';
import { parseLanguages, parseLimit, poolsFor, seedOf, selectTracks, SONG_ID } from '../../../_lib/recs';
import { CatalogUnavailable, lookupCatalogSong } from '../../../_lib/trends/catalog';

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

export const onRequestGet = async (context: { request: Request; env: object; params: { songId?: string } }): Promise<Response> => {
  const { request, env, params } = context;
  // One seed lookup, one similar-songs list and one artist search per call.
  const limited = await rateLimitAsync(request, 'recs-similar', { capacity: 30, refillPerMinute: 30 }, env);
  if (limited) return limited;
  const songId = String(params.songId ?? '');
  if (!SONG_ID.test(songId)) return json({ error: 'invalid_song_id' }, 400);
  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get('limit'));
  const languages = parseLanguages(url.searchParams.get('languages'));
  if (limit == null || languages == null) return json({ error: 'bad_request' }, 400);
  try {
    const found = await lookupCatalogSong(songId);
    if (!found) return json({ error: 'song_not_found' }, 404);
    const seed = seedOf(found);
    const tracks = selectTracks(seed, await poolsFor(seed, true), { limit, languages });
    return json({ seed, tracks, source: 'catalogue' }, 200, 'public, max-age=600, s-maxage=3600');
  } catch (e) {
    if (e instanceof CatalogUnavailable) return json({ error: 'catalogue_unavailable' }, 502);
    console.warn('[recs-similar] unhandled:', e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    return json({ error: 'internal' }, 500);
  }
};
