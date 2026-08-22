/** Content Admin: view + manage the song blocklist the app honors. */
import { isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { sbDelete, sbRpc, sbSelect, sbUpsert, type SupabaseEnv } from '../../_lib/supabase';

type Env = AdminEnv & SupabaseEnv;

interface BlockRow { song_id: string; song_title: string | null; reason: string | null; created_at: string; }
interface SongRow { song_id: string; song_title: string | null; song_artist: string | null; plays: number; }

function clip(v: unknown, n: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, n) : null;
}

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!isAdmin(request, env)) return unauthorized();

  const [blocked, topSongs] = await Promise.all([
    sbSelect<BlockRow>(env, 'vinax_blocklist', 'select=song_id,song_title,reason,created_at&order=created_at.desc&limit=500'),
    sbRpc<SongRow[]>(env, 'vinax_blockable_songs', { days: 30, lim: 40 }),
  ]);

  return new Response(JSON.stringify({ blocked, topSongs: topSongs ?? [] }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
};

export const onRequestPost = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!isAdmin(request, env)) return unauthorized();

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = body ? clip(body.action, 12) : null;
  const songId = body ? clip(body.songId, 64) : null;
  if (!action || !songId) {
    return new Response(JSON.stringify({ error: 'bad_request' }), { status: 400, headers: { 'content-type': 'application/json' } });
  }

  let ok = false;
  if (action === 'block') {
    ok = await sbUpsert(env, 'vinax_blocklist', {
      song_id: songId,
      song_title: body ? clip(body.songTitle, 200) : null,
      reason: body ? clip(body.reason, 200) : null,
    }, 'song_id');
  } else if (action === 'unblock') {
    ok = await sbDelete(env, 'vinax_blocklist', `song_id=eq.${encodeURIComponent(songId)}`);
  }

  return new Response(JSON.stringify({ ok }), {
    status: ok ? 200 : 400,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
};
