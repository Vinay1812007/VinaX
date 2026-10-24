/**
 * GET  /api/admin/live → { configured, now, listening, feed, rooms }
 * POST /api/admin/live { action: 'end_room', code } | { action: 'end_all_rooms' }
 *
 * Who is listening this minute, the latest events, and the Listen Together
 * rooms that are open.
 */
import { adminJson, badRequest, dbFailure } from '../../_lib/admin';
import { adminGet, adminPost } from '../../_lib/adminRoute';
import { db, q, since, firstFailure } from '../../_lib/db';
import { clip } from '../../_lib/edge';

interface ListenerRow {
  id: string; display_name: string | null; handle: string | null; platform: string; country: string | null; city: string | null;
  now_playing: { title?: string; artist?: string; image?: string } | null; is_playing: boolean; last_seen: string;
}
interface EventRow {
  id: number; at: string; listener_id: string | null; kind: string; song_title: string | null; song_artist: string | null; song_image: string | null;
  message: string | null; error_kind: string | null; platform: string | null; country: string | null;
}
interface RoomRow { code: string; host_name: string | null; current: { title?: string; artist?: string; image?: string } | null; playing: boolean; updated_at: string; created_at: string }
interface MemberRow { room_code: string }

const song = (s: { title?: string; artist?: string; image?: string } | null | undefined) =>
  s && typeof s === 'object' && (s.title || s.artist) ? { title: s.title ?? null, artist: s.artist ?? null, image: s.image ?? null } : null;

export const onRequestGet = adminGet(async ({ env }) => {
  const now = Date.now();
  const [listening, feed, rooms, members] = await Promise.all([
    db.select<ListenerRow>(env, 'listeners', q().gt('last_seen', since(5 * 60_000, now)).select('id,display_name,handle,platform,country,city,now_playing,is_playing,last_seen').order('last_seen', 'desc').limit(100)),
    db.select<EventRow>(env, 'events', q().select('id,at,listener_id,kind,song_title,song_artist,song_image,message,error_kind,platform,country').order('at', 'desc').limit(60)),
    db.select<RoomRow>(env, 'rooms', q().gt('updated_at', since(6 * 3_600_000, now)).select('code,host_name,current,playing,updated_at,created_at').order('updated_at', 'desc').limit(50)),
    db.select<MemberRow>(env, 'room_members', q().gt('last_seen', since(60_000, now)).select('room_code').limit(2000)),
  ]);
  const failed = firstFailure(listening, feed, rooms, members);
  if (failed) return dbFailure(failed);
  if (!listening.ok || !feed.ok || !rooms.ok || !members.ok) return adminJson({ configured: true, error: 'db_unavailable' }, 502);

  // Names for the feed: the listeners already loaded plus the rest in one read.
  const names = new Map<string, string | null>(listening.rows.map((l) => [l.id, l.display_name ?? l.handle ?? null]));
  const missing = [...new Set(feed.rows.map((e) => e.listener_id).filter((id): id is string => !!id && !names.has(id)))];
  if (missing.length) {
    const more = await db.select<{ id: string; display_name: string | null; handle: string | null }>(env, 'listeners', q().in('id', missing.slice(0, 100)).select('id,display_name,handle'));
    if (more.ok) for (const l of more.rows) names.set(l.id, l.display_name ?? l.handle ?? null);
  }
  const memberCount = new Map<string, number>();
  for (const m of members.rows) memberCount.set(m.room_code, (memberCount.get(m.room_code) ?? 0) + 1);

  return adminJson({
    configured: true,
    now: new Date(now).toISOString(),
    listening: listening.rows.map((l) => ({
      id: l.id, name: l.display_name, handle: l.handle, platform: l.platform, country: l.country, city: l.city,
      song: song(l.now_playing), isPlaying: !!l.is_playing, lastSeen: l.last_seen,
    })),
    feed: feed.rows.map((e) => ({
      id: e.id, at: e.at, kind: e.kind,
      listener: e.listener_id ? { id: e.listener_id, name: names.get(e.listener_id) ?? null } : null,
      song: e.song_title ? { title: e.song_title, artist: e.song_artist, image: e.song_image } : null,
      message: e.message, errorKind: e.error_kind, platform: e.platform, country: e.country,
    })),
    rooms: rooms.rows.map((r) => ({
      code: r.code, hostName: r.host_name, members: memberCount.get(r.code) ?? 0, song: song(r.current),
      playing: !!r.playing, updatedAt: r.updated_at, createdAt: r.created_at,
    })),
  });
});

export const onRequestPost = adminPost(async ({ env, body, audit }) => {
  if (body.action === 'end_room') {
    const code = clip(body.code, 8)?.toUpperCase();
    if (!code) return badRequest();
    const r = await db.remove<{ code: string }>(env, 'rooms', q().eq('code', code), { returning: true });
    if (!r.ok) return dbFailure(r);
    if (!r.rows.length) return adminJson({ error: 'not_found' }, 404);
    await audit({ action: 'room-end', summary: `ended room ${code}`, target: code });
    return adminJson({ ok: true, ended: r.rows.length });
  }
  if (body.action === 'end_all_rooms') {
    const r = await db.remove<{ code: string }>(env, 'rooms', q().neq('code', ''), { returning: true });
    if (!r.ok) return dbFailure(r);
    await audit({ action: 'room-end-all', summary: `ended ${r.rows.length} room${r.rows.length === 1 ? '' : 's'}` });
    return adminJson({ ok: true, ended: r.rows.length });
  }
  return badRequest('unknown_action');
});
