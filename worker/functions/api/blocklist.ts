/** Public, cacheable list of blocked song ids. The app fetches this and hides
 *  the matching songs from results + playback. Coarse, no auth needed. */
import { sbSelect, type SupabaseEnv } from '../_lib/supabase';

type Env = SupabaseEnv;

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

export const onRequestOptions = async (): Promise<Response> =>
  new Response(null, { status: 204, headers: CORS });

interface IdRow { song_id: string; }

export const onRequestGet = async (context: { env: Env }): Promise<Response> => {
  const rows = await sbSelect<IdRow>(context.env, 'vinax_blocklist', 'select=song_id&limit=5000');
  const ids = rows.map((r) => r.song_id).filter(Boolean);
  return new Response(JSON.stringify({ ids }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60', ...CORS },
  });
};
