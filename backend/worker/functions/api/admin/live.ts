/**
 * GET  /api/admin/live → { configured, now, counts, listening, feed, rooms }
 * POST /api/admin/live { action: 'end_room', code } | { action: 'end_all_rooms' }
 *
 * Live Now. Console rebuild: only people signed in with Google. A device counts
 * when it belongs to an account (its account_id, or the account's latest
 * device); anonymous devices and their events are left out, and device ids
 * never leave this route.
 *
 *   listening: one row per person active in the last 5 minutes (their newest device)
 *     [{ key, user: { id, name, email, picture }, platform, appVersion, country, city, song, isPlaying, lastSeen }]
 *   feed: the newest signed-in activity [{ id, at, kind, user, song, message, errorKind, platform, city }]
 *   rooms: open Listen Together rooms [{ code, hostName, members, song, playing, updatedAt, createdAt }]
 *   counts: { activeNow, playingNow, roomsOpen }
 */
import { adminJson, badRequest, dbFailure } from '../../_lib/admin';
import { adminGet, adminPost } from '../../_lib/adminRoute';
import { db, q, since, firstFailure, type DbEnv } from '../../_lib/db';
import { clip } from '../../_lib/edge';

interface ListenerRow {
  id: string; account_id: string | null; platform: string; app_version: string | null; country: string | null; city: string | null;
  now_playing: { title?: string; artist?: string; image?: string } | null; is_playing: boolean; last_seen: string;
}
interface AccountRow { id: string; name: string | null; email: string | null; picture: string | null; listener_id: string | null }
interface EventRow {
  id: number; at: string; listener_id: string | null; kind: string; song_title: string | null; song_artist: string | null; song_image: string | null;
  message: string | null; error_kind: string | null; platform: string | null; city: string | null;
}
interface RoomRow { code: string; host_name: string | null; current: { title?: string; artist?: string; image?: string } | null; playing: boolean; updated_at: string; created_at: string }
interface MemberRow { room_code: string }

const song = (s: { title?: string; artist?: string; image?: string } | null | undefined) =>
  s && typeof s === 'object' && (s.title || s.artist) ? { title: s.title ?? null, artist: s.artist ?? null, image: s.image ?? null } : null;

/** device id → account, for the given devices (their own link, or an account's latest device). */
async function ownersOf(env: DbEnv, devices: ListenerRow[] | string[]): Promise<{ ok: boolean; byDevice: Map<string, AccountRow> }> {
  const byDevice = new Map<string, AccountRow>();
  const ids = [...new Set((devices as Array<ListenerRow | string>).map((d) => (typeof d === 'string' ? d : d.id)))].slice(0, 300);
  if (!ids.length) return { ok: true, byDevice };
  const linked = new Map<string, string>();
  const rows = devices.filter((d): d is ListenerRow => typeof d !== 'string');
  for (const d of rows) if (d.account_id) linked.set(d.id, d.account_id);
  if (!rows.length) {
    const l = await db.select<{ id: string; account_id: string | null }>(env, 'listeners', q().in('id', ids).select('id,account_id'));
    if (!l.ok) return { ok: false, byDevice };
    for (const d of l.rows) if (d.account_id) linked.set(d.id, d.account_id);
  }
  const accountIds = [...new Set(linked.values())];
  const [byId, byLatest] = await Promise.all([
    accountIds.length ? db.select<AccountRow>(env, 'accounts', q().in('id', accountIds).select('id,name,email,picture,listener_id')) : Promise.resolve({ ok: true as const, rows: [] as AccountRow[] }),
    db.select<AccountRow>(env, 'accounts', q().in('listener_id', ids).select('id,name,email,picture,listener_id')),
  ]);
  if (!byId.ok || !byLatest.ok) return { ok: false, byDevice };
  const accounts = new Map<string, AccountRow>();
  for (const a of [...byId.rows, ...byLatest.rows]) accounts.set(a.id, a);
  for (const [device, acct] of linked) { const a = accounts.get(acct); if (a) byDevice.set(device, a); }
  for (const a of byLatest.rows) if (a.listener_id && !byDevice.has(a.listener_id)) byDevice.set(a.listener_id, a);
  return { ok: true, byDevice };
}

const user = (a: AccountRow) => ({ id: a.id, name: a.name, email: a.email, picture: a.picture });

export const onRequestGet = adminGet(async ({ env }) => {
  const now = Date.now();
  const [recent, feed, rooms, members] = await Promise.all([
    db.select<ListenerRow>(env, 'listeners', q().gt('last_seen', since(5 * 60_000, now)).select('id,account_id,platform,app_version,country,city,now_playing,is_playing,last_seen').order('last_seen', 'desc').limit(300)),
    db.select<EventRow>(env, 'events', q().not('listener_id', 'is', 'null').select('id,at,listener_id,kind,song_title,song_artist,song_image,message,error_kind,platform,city').order('at', 'desc').limit(250)),
    db.select<RoomRow>(env, 'rooms', q().gt('updated_at', since(6 * 3_600_000, now)).select('code,host_name,current,playing,updated_at,created_at').order('updated_at', 'desc').limit(50)),
    db.select<MemberRow>(env, 'room_members', q().gt('last_seen', since(60_000, now)).select('room_code').limit(2000)),
  ]);
  const failed = firstFailure(recent, feed, rooms, members);
  if (failed) return dbFailure(failed);
  if (!recent.ok || !feed.ok || !rooms.ok || !members.ok) return adminJson({ configured: true, error: 'db_unavailable' }, 502);

  const live = await ownersOf(env, recent.rows);
  const feedOwners = await ownersOf(env, feed.rows.map((e) => e.listener_id).filter((x): x is string => !!x));
  if (!live.ok || !feedOwners.ok) return adminJson({ configured: true, error: 'db_unavailable' }, 502);

  // One row per person: the newest device (rows arrive newest first).
  const seen = new Set<string>();
  const listening = [];
  for (const l of recent.rows) {
    const a = live.byDevice.get(l.id);
    if (!a || seen.has(a.id)) continue;
    seen.add(a.id);
    listening.push({
      key: a.id, user: user(a), platform: l.platform || 'web', appVersion: l.app_version, country: l.country, city: l.city,
      song: song(l.now_playing), isPlaying: !!l.is_playing, lastSeen: l.last_seen,
    });
  }
  const recentFeed = [];
  for (const e of feed.rows) {
    const a = e.listener_id ? feedOwners.byDevice.get(e.listener_id) : undefined;
    if (!a) continue;
    recentFeed.push({
      id: e.id, at: e.at, kind: e.kind, user: user(a),
      song: e.song_title ? { title: e.song_title, artist: e.song_artist, image: e.song_image } : null,
      message: e.message, errorKind: e.error_kind, platform: e.platform, city: e.city,
    });
    if (recentFeed.length >= 60) break;
  }
  const memberCount = new Map<string, number>();
  for (const m of members.rows) memberCount.set(m.room_code, (memberCount.get(m.room_code) ?? 0) + 1);
  const openRooms = rooms.rows.map((r) => ({
    code: r.code, hostName: r.host_name, members: memberCount.get(r.code) ?? 0, song: song(r.current),
    playing: !!r.playing, updatedAt: r.updated_at, createdAt: r.created_at,
  }));

  return adminJson({
    configured: true,
    now: new Date(now).toISOString(),
    counts: {
      activeNow: listening.length,
      playingNow: listening.filter((l) => l.isPlaying).length,
      roomsOpen: openRooms.filter((r) => Date.parse(r.updatedAt) > now - 15 * 60_000).length,
    },
    listening,
    feed: recentFeed,
    rooms: openRooms,
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
