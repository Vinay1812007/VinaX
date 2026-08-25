/** Content Admin: view + manage the song blocklist the app honors. */
import { isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { logAdminAudit } from '../../_lib/adminAudit';
import { dbDelete, dbRpc, dbSelect, dbUpsert, type DbEnv } from '../../_lib/db';

type Env = AdminEnv & DbEnv;

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
    dbSelect<BlockRow>(env, 'vinax_blocklist', 'select=song_id,song_title,reason,created_at&order=created_at.desc&limit=500'),
    dbRpc<SongRow[]>(env, 'vinax_blockable_songs', { days: 30, lim: 40 }),
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
  // E4 — three block kinds share the table via a namespaced song_id:
  //   song    → the raw id (unchanged behavior)
  //   artist  → artist:<name, lowercased>   (blocks their whole catalog)
  //   keyword → kw:<term, lowercased>       (blocks title/subtitle matches)
  const kind = (body ? clip(body.kind, 8) : null) ?? 'song';
  let songId = body ? clip(body.songId, 120) : null;
  // Namespacing applies to BOTH actions: an unblock carrying kind:'artist'
  // with a bare name used to delete nothing and still report ok (D-19).
  // Already-namespaced ids (the UI echoes the stored song_id) pass through.
  if (songId && !/^(artist|kw):/.test(songId)) {
    if (kind === 'artist') songId = `artist:${songId.toLowerCase()}`;
    else if (kind === 'keyword') {
      const term = songId.toLowerCase();
      // A short keyword is a catalog nuke ("a" would hide everything) —
      // refuse anything under 3 characters.
      if (action === 'block' && term.length < 3) {
        return new Response(JSON.stringify({ error: 'keyword_too_short' }), { status: 400, headers: { 'content-type': 'application/json' } });
      }
      songId = `kw:${term}`;
    }
  }
  if (!action || !songId) {
    return new Response(JSON.stringify({ error: 'bad_request' }), { status: 400, headers: { 'content-type': 'application/json' } });
  }

  let ok: boolean;
  if (action === 'block') {
    ok = await dbUpsert(env, 'vinax_blocklist', {
      song_id: songId,
      song_title: body ? clip(body.songTitle, 200) : null,
      reason: body ? clip(body.reason, 200) : null,
    }, 'song_id');
  } else if (action === 'unblock') {
    ok = await dbDelete(env, 'vinax_blocklist', `song_id=eq.${encodeURIComponent(songId)}`);
  } else {
    // Same convention as maintenance/experiments — was a bare 400 {ok:false}
    // with no error key (D-17).
    return new Response(JSON.stringify({ error: 'unknown_action' }), {
      status: 400,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  }
  // E12 — every blocklist mutation leaves an audit row (best-effort).
  if (ok) {
    void logAdminAudit(env, `blocklist-${action}`, `${songId}${body?.reason ? ` — ${clip(body.reason, 120)}` : ''}`);
  }

  // A failed database write is a server-side failure, not a client error.
  return new Response(JSON.stringify({ ok }), {
    status: ok ? 200 : 500,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
};
