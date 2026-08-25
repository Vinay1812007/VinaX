/** Public, cacheable list of blocked song ids. The app fetches this and hides
 *  the matching songs from results + playback. Coarse, no auth needed. */
import { dbSelect, type DbEnv } from '../_lib/db';

type Env = DbEnv;

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

export const onRequestOptions = async (): Promise<Response> =>
  new Response(null, { status: 204, headers: CORS });

interface IdRow { song_id: string; }

// Package E4 — the blocklist now carries three kinds in one table, namespaced
// in the song_id column (which is plain text): bare ids block one song,
// `artist:<name>` blocks everything by that artist, `kw:<term>` blocks any
// song whose title/subtitle contains the term. Old clients that only read
// `ids` keep working — prefixed entries can never collide with real ids and
// are also filtered out of the ids array below.
export const onRequestGet = async (context: { env: Env }): Promise<Response> => {
  const rows = await dbSelect<IdRow>(context.env, 'vinax_blocklist', 'select=song_id&limit=5000');
  const ids: string[] = [];
  const artists: string[] = [];
  const keywords: string[] = [];
  for (const r of rows) {
    const v = r.song_id;
    if (!v) continue;
    if (v.startsWith('artist:')) artists.push(v.slice(7));
    else if (v.startsWith('kw:')) keywords.push(v.slice(3));
    else ids.push(v);
  }
  return new Response(JSON.stringify({ ids, artists, keywords }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60', ...CORS },
  });
};
