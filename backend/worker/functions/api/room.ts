/**
 * Listen Together rooms — shared playback state every member polls.
 *
 *   POST { action: 'create', hostName?, song? }           → { code, hostToken }
 *   GET  ?code=…&hostToken=…                               → { room, now, memberCount, reactions, members? }
 *   POST { action: 'update', code, hostToken, song, queue, position, playing, consumedIds }   host only
 *   POST { action: 'request', code, song, by }             a guest asks for a song
 *   POST { action: 'react', code, deviceId, emoji, name }  one live reaction per member
 *   POST { action: 'heartbeat', code, deviceId, name }     presence
 *   POST { action: 'leave', code, deviceId }
 *   POST { action: 'end', code, hostToken }                host only
 *   15.0:
 *   POST { action: 'say', code, deviceId, name, text }     a chat line (≤ 200 chars, the room keeps 40)
 *   POST { action: 'skip', code, deviceId, songId }        vote to skip the current song (one per member)
 *
 * The 6-character code is the JOIN credential (anyone with it may watch and
 * request). The host token, returned exactly once at create, authorises
 * `update` and `end`; it is never sent back to anyone. Since 15.0 everyone
 * in the room sees who is here by the name they gave (`names`), the chat,
 * and how many have voted to skip; the host's app skips when the votes pass
 * half the room. Rooms live in `rooms` and `room_members`; idle rooms are
 * swept by housekeeping.
 */
import { db, dbConfigured, q, type DbEnv } from '../_lib/db';
import { asObject, clip, jsonResponse } from '../_lib/edge';
import { rateLimit } from '../_lib/ratelimit';
import { safeEqual } from '../_lib/safe-compare';

type Env = DbEnv;

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};
const json = (body: unknown, status = 200): Response => jsonResponse(body, status, CORS);

/**
 * Budgets are per client address and sized for a ROOM: a host and a few
 * guests on one home network share one address.
 */
const ROOM_RL: Record<string, { capacity: number; refillPerMinute: number }> = {
  create: { capacity: 3, refillPerMinute: 3 },
  heartbeat: { capacity: 90, refillPerMinute: 90 },
  request: { capacity: 30, refillPerMinute: 30 },
  react: { capacity: 30, refillPerMinute: 30 },
  leave: { capacity: 20, refillPerMinute: 20 },
  update: { capacity: 60, refillPerMinute: 60 },
  end: { capacity: 20, refillPerMinute: 20 },
  say: { capacity: 30, refillPerMinute: 30 },
  skip: { capacity: 20, refillPerMinute: 20 },
  GET: { capacity: 200, refillPerMinute: 200 },
};
export const CHAT_MAX = 40;
export const CHAT_TEXT_MAX = 200;

/** The only emojis a reaction may carry. */
export const REACTION_EMOJI: readonly string[] = ['❤️', '🔥', '😂', '👏', '🎉', '😍'];
/** How long a reaction stays in polls. */
const REACTION_WINDOW_MS = 8_000;
/** A member counts as present for this long after their last heartbeat. */
const PRESENCE_MS = 12_000;
const QUEUE_MAX = 12;
const MEMBER_ID_MAX = 64;

interface RoomRow {
  code: string;
  host_token: string;
  host_name: string | null;
  current: unknown;
  queue: unknown;
  requests: unknown;
  position: number;
  playing: boolean;
  updated_at: string;
  messages?: Array<{ by: string; text: string; at: string }>;
  skip_votes?: string[];
}
interface Track { song: unknown; by: string | null }

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: CORS });

/** Room code: 6 chars from a confusables-free alphabet, from the platform CSPRNG. */
export function newCode(): string {
  const a = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const buf = new Uint8Array(6);
  crypto.getRandomValues(buf);
  let c = '';
  for (let i = 0; i < 6; i += 1) c += a[buf[i] % a.length];
  return c;
}

/** Host secret: 32 random bytes, base64url. */
export function newHostToken(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  let s = '';
  for (const b of buf) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const codeOf = (v: unknown): string | null => {
  const c = clip(v, 8)?.toUpperCase() ?? null;
  return c && /^[A-Z0-9]{4,8}$/.test(c) ? c : null;
};
const memberOf = (v: unknown): string | null => clip(v, MEMBER_ID_MAX);

/** A song as the room keeps it: id, title, subtitle, image and a few display fields, ≤ 2 KB. */
function cleanSong(raw: unknown): Record<string, unknown> | null {
  const s = asObject(raw);
  if (!s) return null;
  const out: Record<string, unknown> = {};
  for (const k of ['id', 'title', 'subtitle', 'image', 'url', 'duration', 'language', 'year']) {
    const v = s[k];
    if (typeof v === 'string') out[k] = v.slice(0, k === 'url' || k === 'image' ? 512 : 200);
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  for (const k of ['artists', 'images', 'downloadUrls']) if (Array.isArray(s[k])) out[k] = (s[k] as unknown[]).slice(0, 8);
  if (!out.id || typeof out.id !== 'string') return null;
  return JSON.stringify(out).length <= 4096 ? out : { id: out.id, title: out.title ?? null, subtitle: out.subtitle ?? null, image: out.image ?? null };
}

function trackList(raw: unknown, cap: number): Track[] {
  if (!Array.isArray(raw)) return [];
  const out: Track[] = [];
  for (const t of raw.slice(0, cap)) {
    const o = asObject(t);
    const song = cleanSong(o?.song);
    if (song) out.push({ song, by: clip(o?.by, 40) });
  }
  return out;
}
const tracks = (raw: unknown): Track[] => (Array.isArray(raw) ? (raw as Track[]) : []);
const songId = (t: Track): string => String((asObject(t.song)?.id as unknown) ?? '');

/** The room as the app sees it (host_token never leaves). */
function publicRoom(r: RoomRow) {
  return {
    host_name: r.host_name,
    song: r.current ?? null,
    queue: tracks(r.queue),
    requests: tracks(r.requests),
    position: typeof r.position === 'number' ? r.position : 0,
    playing: r.playing === true,
    updated_at: r.updated_at,
    // 15.0 — the chat and the skip votes for the current song.
    messages: Array.isArray(r.messages) ? r.messages.slice(-CHAT_MAX) : [],
    skipVotes: Array.isArray(r.skip_votes) ? r.skip_votes.length : 0,
  };
}

async function readRoom(env: Env, code: string): Promise<{ ok: true; room: RoomRow | null } | { ok: false }> {
  const r = await db.one<RoomRow>(env, 'rooms', q().eq('code', code));
  return r.ok ? { ok: true, room: r.value } : { ok: false };
}

/** Host authorisation: the stored token must match in constant time. */
async function requireHost(env: Env, code: string, provided: string | null): Promise<{ room: RoomRow } | { fail: Response }> {
  const r = await readRoom(env, code);
  if (!r.ok) return { fail: json({ error: 'unavailable' }, 503) };
  if (!r.room) return { fail: json({ error: 'not_found' }, 404) };
  if (!provided || !safeEqual(provided, r.room.host_token)) return { fail: json({ error: 'forbidden' }, 403) };
  return { room: r.room };
}

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  const limited = rateLimit(request, 'room-get', ROOM_RL.GET, env);
  if (limited) return limited;
  if (!dbConfigured(env)) return json({ error: 'not_configured' }, 503);
  const url = new URL(request.url);
  const code = codeOf(url.searchParams.get('code'));
  if (!code) return json({ error: 'bad_request' }, 400);
  const hostToken = clip(url.searchParams.get('hostToken'), 64);

  const now = Date.now();
  const [room, members] = await Promise.all([
    readRoom(env, code),
    db.select<{ member_id: string; name: string | null; last_seen: string; reaction: string | null; reacted_at: string | null }>(
      env, 'room_members', q().eq('room_code', code).gte('last_seen', new Date(now - 86_400_000).toISOString()).select('member_id,name,last_seen,reaction,reacted_at').limit(200),
    ),
  ]);
  if (!room.ok) return json({ error: 'unavailable' }, 503);
  const present = members.ok ? members.rows.filter((m) => Date.parse(m.last_seen) >= now - PRESENCE_MS) : [];
  const reactSince = now - REACTION_WINDOW_MS;
  const reactions = (members.ok ? members.rows : [])
    .filter((m) => m.reaction && m.reacted_at && REACTION_EMOJI.includes(m.reaction) && Date.parse(m.reacted_at) >= reactSince)
    .map((m) => ({ e: m.reaction as string, at: m.reacted_at as string }));
  const hostAuthorized = !!(room.room && hostToken && safeEqual(hostToken, room.room.host_token));
  // 15.0 — a skip vote counts only while its member is here.
  if (room.room && Array.isArray(room.room.skip_votes)) {
    const here = new Set((members.ok ? members.rows : []).filter((m) => Date.parse(m.last_seen) >= now - PRESENCE_MS).map((m) => m.member_id));
    room.room.skip_votes = room.room.skip_votes.filter((id) => here.has(id));
  }
  // A mistyped code and an ended room both read `room: null` — the app shows "session ended".
  const body: Record<string, unknown> = {
    room: room.room ? publicRoom(room.room) : null,
    // The server's clock when it answered: followers project the host's position from it.
    now,
    memberCount: present.length,
    reactions,
  };
  // 15.0 — everyone sees the names members gave (a name is what a member
  // chose to show the room); the host's list is the same list.
  const names = present.map((m) => m.name).filter((n): n is string => !!n);
  body.names = names;
  if (hostAuthorized) body.members = names;
  return json(body);
};

export const onRequestPost = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!dbConfigured(env)) return json({ error: 'not_configured' }, 503);
  const body = asObject(await request.json().catch(() => null)) ?? {};
  const action = clip(body.action, 12) ?? '';
  const budget = ROOM_RL[action];
  if (!budget) return json({ error: 'unknown_action' }, 400);
  const limited = rateLimit(request, `room-${action}`, budget, env);
  if (limited) return limited;
  const now = new Date().toISOString();

  if (action === 'create') {
    // The random code can collide: insert with ignore-duplicates and retry
    // with fresh keys when the answer comes back empty (nothing written).
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = newCode();
      const hostToken = newHostToken();
      const r = await db.insert<{ code: string }>(env, 'rooms', {
        code,
        host_token: hostToken,
        host_name: clip(body.hostName, 60),
        current: cleanSong(body.song),
        queue: [],
        requests: [],
        position: 0,
        playing: false,
        created_at: now,
        updated_at: now,
      }, { returning: true, onConflict: 'code', ignoreDuplicates: true });
      if (!r.ok) return json({ error: r.error === 'not_found' ? 'needs_migration' : 'create_failed', message: r.error === 'not_found' ? 'The rooms table is missing — run backend/supabase/schema.sql' : undefined }, r.error === 'not_found' ? 503 : 500);
      if (r.rows.length) return json({ code, hostToken });
    }
    return json({ error: 'code_space_exhausted' }, 503);
  }

  const code = codeOf(body.code);
  if (!code) return json({ error: 'bad_request' }, 400);

  if (action === 'update') {
    const host = await requireHost(env, code, clip(body.hostToken, 64));
    if ('fail' in host) return host.fail;
    // A state push must never clobber a guest request that raced it: only the
    // requests the host says it consumed leave the list.
    const consumed = new Set(Array.isArray(body.consumedIds) ? (body.consumedIds as unknown[]).filter((x): x is string => typeof x === 'string') : []);
    const requests = tracks(host.room.requests).filter((t) => !consumed.has(songId(t)));
    const nextSong = cleanSong(body.song);
    const changed = String(nextSong?.id ?? '') !== String(asObject(host.room.current)?.id ?? '');
    const r = await db.update(env, 'rooms', q().eq('code', code), {
      current: nextSong,
      queue: trackList(body.queue, QUEUE_MAX),
      requests,
      position: typeof body.position === 'number' && Number.isFinite(body.position) ? body.position : 0,
      playing: body.playing === true,
      updated_at: now,
      // 15.0 — a new song starts with no skip votes.
      ...(changed ? { skip_votes: [] } : {}),
    });
    return json({ ok: r.ok });
  }

  if (action === 'request') {
    const song = cleanSong(body.song);
    if (!song) return json({ error: 'bad_song' }, 400);
    const r = await db.rpc<boolean>(env, 'room_request', { p_code: code, p_song: { id: song.id, title: song.title ?? '', subtitle: song.subtitle ?? '', image: song.image ?? '' }, p_by: clip(body.by, 40) ?? '' });
    if (!r.ok) return json({ error: 'unavailable' }, 503);
    if (r.value !== true) return json({ error: 'not_found' }, 404);
    return json({ ok: true });
  }

  const memberId = memberOf(body.deviceId);

  if (action === 'react') {
    const emoji = clip(body.emoji, 8);
    if (!memberId || !emoji || !REACTION_EMOJI.includes(emoji)) return json({ error: 'bad_request' }, 400);
    // Each member writes only their OWN row, so reactions never race each
    // other and one live reaction per member limits spam. Doubles as a heartbeat.
    const r = await db.upsert(env, 'room_members', { room_code: code, member_id: memberId, name: clip(body.name, 60), last_seen: now, reaction: emoji, reacted_at: now }, 'room_code,member_id');
    return json({ ok: r.ok });
  }

  if (action === 'heartbeat') {
    if (!memberId) return json({ error: 'bad_request' }, 400);
    const r = await db.upsert(env, 'room_members', { room_code: code, member_id: memberId, name: clip(body.name, 60), last_seen: now }, 'room_code,member_id');
    // A heartbeat for a room that no longer exists is refused by the foreign key: tell the guest.
    if (!r.ok && (r.error === 'bad_request' || r.error === 'conflict')) return json({ error: 'not_found' }, 404);
    return json({ ok: r.ok });
  }

  if (action === 'say') {
    const text = clip(body.text, CHAT_TEXT_MAX);
    if (!memberId || !text) return json({ error: 'bad_request' }, 400);
    const r = await readRoom(env, code);
    if (!r.ok) return json({ error: 'unavailable' }, 503);
    if (!r.room) return json({ error: 'not_found' }, 404);
    const line = { by: clip(body.name, 40) ?? 'Someone', text, at: now };
    const messages = [...(Array.isArray(r.room.messages) ? r.room.messages : []), line].slice(-CHAT_MAX);
    const w = await db.update(env, 'rooms', q().eq('code', code), { messages, updated_at: now });
    // Saying something is being here.
    void db.upsert(env, 'room_members', { room_code: code, member_id: memberId, name: clip(body.name, 60), last_seen: now }, 'room_code,member_id');
    return json({ ok: w.ok });
  }

  if (action === 'skip') {
    if (!memberId) return json({ error: 'bad_request' }, 400);
    const r = await readRoom(env, code);
    if (!r.ok) return json({ error: 'unavailable' }, 503);
    if (!r.room) return json({ error: 'not_found' }, 404);
    // A vote names the song it is for, so a late vote never counts against the next one.
    const forSong = clip(body.songId, 64);
    const current = String(asObject(r.room.current)?.id ?? '');
    if (!forSong || forSong !== current) return json({ ok: true, skipVotes: Array.isArray(r.room.skip_votes) ? r.room.skip_votes.length : 0, stale: true });
    // Only a member who is here may vote: the voter's own row must be fresh.
    const member = await db.one<{ last_seen: string }>(env, 'room_members', q().eq('room_code', code).eq('member_id', memberId).select('last_seen'));
    if (!member.ok) return json({ error: 'unavailable' }, 503);
    if (!member.value || Date.parse(member.value.last_seen) < Date.now() - PRESENCE_MS) return json({ error: 'not_member' }, 403);
    const votes = new Set(Array.isArray(r.room.skip_votes) ? r.room.skip_votes : []);
    votes.add(memberId);
    const w = await db.update(env, 'rooms', q().eq('code', code), { skip_votes: [...votes].slice(0, 200) });
    return json({ ok: w.ok, skipVotes: votes.size });
  }

  if (action === 'leave') {
    if (!memberId) return json({ error: 'bad_request' }, 400);
    const r = await db.remove(env, 'room_members', q().eq('room_code', code).eq('member_id', memberId));
    return json({ ok: r.ok });
  }

  if (action === 'end') {
    const host = await requireHost(env, code, clip(body.hostToken, 64));
    if ('fail' in host) return host.fail;
    const r = await db.remove(env, 'rooms', q().eq('code', code)); // members cascade
    return json({ ok: r.ok });
  }

  return json({ error: 'unknown_action' }, 400);
};
