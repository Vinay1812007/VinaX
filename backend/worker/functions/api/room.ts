/** Listen Together rooms.
 *  - The 6-char code is the JOIN credential (guests can view + request songs).
 *  - A separate host_token is required for HOST actions (update, end): it is
 *    returned once from `create`, stored client-side, and never transmitted to
 *    guests. This prevents a code-holder from hijacking playback or destroying
 *    the room for everyone. See audit finding H8.
 *  No personal data; both secrets are generated with crypto.getRandomValues. */
import { sbDelete, sbInsertIgnore, sbRpc, sbSelect, sbSelectRes, sbUpsert, supabaseConfigured, type SupabaseEnv } from '../_lib/supabase';
import { rateLimit } from '../_lib/ratelimit';
import { safeEqual } from '../_lib/safe-compare';

interface RoomEnv extends SupabaseEnv {
  TELEMETRY_PEPPER?: string;
}

type Env = RoomEnv;

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS },
  });
}

/** Rate-limit bucket lookup for each room action. Different verbs get very
 *  different budgets (heartbeats fire every ~5s, creates should not). */
const ROOM_RL: Record<string, { capacity: number; refillPerMinute: number }> = {
  create: { capacity: 3, refillPerMinute: 3 },
  heartbeat: { capacity: 60, refillPerMinute: 60 },
  request: { capacity: 20, refillPerMinute: 20 },
  react: { capacity: 20, refillPerMinute: 15 },
  leave: { capacity: 20, refillPerMinute: 20 },
  update: { capacity: 20, refillPerMinute: 20 },
  end: { capacity: 20, refillPerMinute: 20 },
  GET: { capacity: 60, refillPerMinute: 60 },
};

/** Package D11 — the only emojis a reaction may carry (server-enforced). */
const REACTION_EMOJI = ['❤️', '🔥', '😂', '👏', '🎉', '😍'];
/** How long a reaction stays visible in polls. */
const REACTION_WINDOW_MS = 8_000;

export const onRequestOptions = async (): Promise<Response> =>
  new Response(null, { status: 204, headers: CORS });

function clip(v: unknown, n: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, n) : null;
}

type RoomTrack = { song: unknown; by: string | null };

/** The song column carries { v:2, current, queue, requests } — richer group
 *  state with zero schema migration. v1 rows (a bare song object) still parse. */
function unpackSong(v: unknown): { song: unknown; queue: RoomTrack[]; requests: RoomTrack[] } {
  if (v && typeof v === 'object' && (v as { v?: unknown }).v === 2) {
    const o = v as { current?: unknown; queue?: unknown; requests?: unknown };
    return {
      song: o.current ?? null,
      queue: Array.isArray(o.queue) ? (o.queue as RoomTrack[]).slice(0, 12) : [],
      requests: Array.isArray(o.requests) ? (o.requests as RoomTrack[]).slice(0, 20) : [],
    };
  }
  return { song: v ?? null, queue: [], requests: [] };
}

function trackArr(v: unknown, cap: number): RoomTrack[] {
  if (!Array.isArray(v)) return [];
  return v
    .slice(0, cap)
    .map((t) => ({ song: (t as RoomTrack)?.song ?? null, by: clip((t as RoomTrack)?.by, 40) }))
    .filter((t) => !!t.song);
}

function songIdOf(t: RoomTrack): string {
  return String((t.song as { id?: unknown })?.id ?? '');
}

/** Room code — 6 chars from a confusables-free alphabet. Cryptographic RNG so
 *  the sequence can't be predicted from observed codes (audit finding H9). */
function newCode(): string {
  const a = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const buf = new Uint8Array(6);
  crypto.getRandomValues(buf);
  let c = '';
  for (let i = 0; i < 6; i++) c += a[buf[i] % a.length];
  return c;
}

/** Host secret — 32 bytes of urandom, base64url encoded. */
function newHostToken(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  let s = '';
  for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Read the stored host_token for a room; returns null if the row lacks one
 *  (legacy rooms created before this deploy). */
async function readHostToken(env: Env, code: string): Promise<string | null | 'missing_row'> {
  const rows = await sbSelect<{ host_token: string | null }>(
    env, 'vinax_rooms', `code=eq.${encodeURIComponent(code)}&limit=1&select=host_token`,
  );
  if (!rows.length) return 'missing_row';
  return rows[0].host_token ?? null;
}

/** Enforce host-token check for state-mutating host actions. Returns null if
 *  authorized, or a Response to return on failure.
 *
 *  Audit finding H-SRV-5: the previous grandfather branch silently authorized
 *  ANY caller on legacy rows (host_token IS NULL). It's been removed — those
 *  rows now return 403 legacy_room instead.
 *
 *  TODO(security H-SRV-5): backfill host_token for existing rows via a
 *  Supabase migration OR run a purge cron that deletes rows older than a few
 *  hours (rooms are short-lived; the legacy fleet drains naturally). Until
 *  then, host actions on pre-fix rooms fail fast — guests can still read the
 *  room, and the host recreates cleanly. */
async function requireHost(env: Env, code: string, provided: string | null): Promise<Response | null> {
  const stored = await readHostToken(env, code);
  if (stored === 'missing_row') return json({ error: 'not_found' }, 404);
  if (stored === null) {
    return json(
      { error: 'legacy_room', message: 'This room predates host tokens and cannot be modified.' },
      403,
    );
  }
  if (!provided || !safeEqual(provided, stored)) {
    return json({ error: 'forbidden' }, 403);
  }
  return null;
}

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  const limited = rateLimit(request, 'room-get', ROOM_RL.GET, env);
  if (limited) return limited;
  if (!supabaseConfigured(env)) return json({ error: 'not_configured' }, 503);
  const url = new URL(request.url);
  const code = clip(url.searchParams.get('code'), 8);
  if (!code) return json({ error: 'bad_request' }, 400);
  const providedHostToken = clip(url.searchParams.get('hostToken'), 64);

  const since = new Date(Date.now() - 12_000).toISOString();
  const reactSince = new Date(Date.now() - REACTION_WINDOW_MS).toISOString();
  const [rooms, members, reactionRows] = await Promise.all([
    sbSelect<{ host_name: string | null; song: unknown; position: number; playing: boolean; updated_at: string; host_token: string | null }>(
      env, 'vinax_rooms', `code=eq.${encodeURIComponent(code)}&limit=1&select=host_name,song,position,playing,updated_at,host_token`,
    ),
    sbSelect<{ name: string | null }>(
      env, 'vinax_room_members', `code=eq.${encodeURIComponent(code)}&last_seen=gte.${encodeURIComponent(since)}&select=name`,
    ),
    // D11 — recent reactions, DELIBERATELY a separate query: if the reaction
    // columns haven't been migrated yet this select 400s alone and reactions
    // are simply absent, while memberCount keeps working untouched. No names
    // attached — reactions are anonymous to guests by design (M-SRV-2 spirit).
    sbSelect<{ reaction: string | null; reacted_at: string | null }>(
      env,
      'vinax_room_members',
      `code=eq.${encodeURIComponent(code)}&reacted_at=gte.${encodeURIComponent(reactSince)}&reaction=not.is.null&select=reaction,reacted_at`,
    ),
  ]);

  const raw = rooms[0] ?? null;
  // NB (audit finding M16): a mistyped code and an ended session both currently
  // return `{ room: null }` with HTTP 200. The guest UI treats that shape as
  // 'session ended' which is the right UX (the room genuinely isn't available),
  // and switching to HTTP 404 for the never-existed case would need a
  // coordinated client change to preserve that path — deferred.
  //
  // Audit finding M-SRV-2: an anonymous GET (guest polling with just the room
  // code) no longer receives the raw member NAMES — those can be personal.
  // Only a memberCount is returned. If the caller proves it's the host by
  // presenting the stored host_token, the full member list comes back.
  let hostAuthorized = false;
  if (raw && providedHostToken && raw.host_token && safeEqual(providedHostToken, raw.host_token)) {
    hostAuthorized = true;
  }
  // Never leak the host_token itself back to any caller.
  const roomOut = raw
    ? (() => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { host_token: _ht, ...rest } = raw;
        return { ...rest, ...unpackSong(raw.song) };
      })()
    : null;
  const responseBody: Record<string, unknown> = {
    room: roomOut,
    memberCount: members.length,
    // D11 — everyone sees the room's recent reactions (emoji + stamp only).
    reactions: reactionRows
      .filter((r) => r.reaction && r.reacted_at && REACTION_EMOJI.includes(r.reaction))
      .map((r) => ({ e: r.reaction, at: r.reacted_at })),
  };
  if (hostAuthorized) {
    responseBody.members = members.map((m) => m.name).filter(Boolean);
  }
  return json(responseBody);
};

export const onRequestPost = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!supabaseConfigured(env)) return json({ error: 'not_configured' }, 503);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = body ? clip(body.action, 12) : null;
  const now = new Date().toISOString();

  if (action === 'create') {
    const rl = rateLimit(request, 'room-create', ROOM_RL.create, env);
    if (rl) return rl;
    // sbUpsert with merge-duplicates would silently overwrite an existing
    // row's host_token if two concurrent creates picked the same random code
    // — the second caller would receive a hostToken the first caller can't
    // recognize, and the first host's control of the room silently evaporates
    // (audit finding H-SRV-4). Use sbInsertIgnore instead: on collision the
    // response comes back empty, and we regenerate + retry.
    let created: { code: string; hostToken: string } | null = null;
    for (let attempt = 0; attempt < 5 && !created; attempt += 1) {
      const code = newCode();
      const hostToken = newHostToken();
      const rows = await sbInsertIgnore<{ code: string }>(env, 'vinax_rooms', {
        code,
        host_name: body ? clip(body.hostName, 60) : null,
        host_token: hostToken,
        song: body?.song ?? null,
        position: 0,
        playing: false,
        updated_at: now,
      }, 'code');
      if (rows === null) {
        // The insert was REJECTED (not a collision). The dominant real-world
        // cause: the live table predates the H8 host_token column, so
        // PostgREST refuses the whole row and every "Start session" fails.
        // Probe the schema so the client (and the admin) get an honest,
        // actionable error instead of a generic 500.
        const probe = await sbSelectRes(env, 'vinax_rooms', 'select=host_token&limit=1');
        if (!probe.ok) {
          const tableProbe = await sbSelectRes(env, 'vinax_rooms', 'select=code&limit=1');
          return json(
            {
              error: 'needs_migration',
              message: tableProbe.ok
                ? 'vinax_rooms is missing the host_token column — run supabase/migrations/2026-08-vinax-rooms-hosttoken.sql'
                : 'vinax_rooms table is missing — run supabase/schema.sql',
            },
            503,
          );
        }
        return json({ error: 'create_failed' }, 500);
      }
      if (rows.length > 0) created = { code, hostToken };
      // rows.length === 0 -> the random code collided; loop with fresh keys.
    }
    if (!created) return json({ error: 'code_space_exhausted' }, 503);
    // The host token is returned exactly once. The client must persist it —
    // there is no recovery path if lost (the room is effectively closed to
    // further host actions and the guest UI will keep polling stale state).
    return json(created);
  }

  if (action === 'update') {
    const rl = rateLimit(request, 'room-update', ROOM_RL.update, env);
    if (rl) return rl;
    const code = body ? clip(body.code, 8) : null;
    if (!code) return json({ error: 'bad_request' }, 400);
    const hostToken = body ? clip(body.hostToken, 64) : null;
    const authErr = await requireHost(env, code, hostToken);
    if (authErr) return authErr;
    // Preserve requests the host hasn't consumed yet — a state push must
    // never clobber a guest request that raced it.
    const existing = await sbSelect<{ song: unknown }>(
      env, 'vinax_rooms', `code=eq.${encodeURIComponent(code)}&limit=1&select=song`,
    );
    const prev = unpackSong(existing[0]?.song);
    const consumedIds = Array.isArray(body?.consumedIds)
      ? (body?.consumedIds as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];
    const requests = prev.requests.filter((t) => !consumedIds.includes(songIdOf(t)));
    const ok = await sbUpsert(env, 'vinax_rooms', {
      code,
      song: { v: 2, current: body?.song ?? null, queue: trackArr(body?.queue, 12), requests },
      position: typeof body?.position === 'number' ? body.position : 0,
      playing: body?.playing === true,
      updated_at: now,
    }, 'code');
    return json({ ok });
  }

  if (action === 'request') {
    const rl = rateLimit(request, 'room-request', ROOM_RL.request, env);
    if (rl) return rl;
    const code = body ? clip(body.code, 8) : null;
    if (!code) return json({ error: 'bad_request' }, 400);
    // Sanitize the incoming song shape before it enters the jsonb column —
    // the RPC otherwise happily persists any nested structure a guest sends,
    // which the audit flagged as an unbounded jsonb write path (H-SRV-2).
    const song = body?.song;
    if (!song || typeof song !== 'object') return json({ error: 'bad_song' }, 400);
    const rawSong = song as Record<string, unknown>;
    const cleanSong = {
      id: String((rawSong.id as unknown) ?? '').slice(0, 128),
      title: String((rawSong.title as unknown) ?? '').slice(0, 200),
      subtitle: String((rawSong.subtitle as unknown) ?? '').slice(0, 200),
      image: String((rawSong.image as unknown) ?? '').slice(0, 512),
    };
    if (!cleanSong.id) return json({ error: 'bad_song' }, 400);
    if (JSON.stringify(cleanSong).length > 2048) return json({ error: 'song_too_large' }, 400);
    // Atomic append inside the DB so two concurrent guest requests don't
    // clobber each other via read-modify-write (audit finding M12). The RPC
    // also de-dupes and caps to the last 20 entries.
    const ok = await sbRpc<void>(env, 'vinax_room_append_request', {
      p_code: code,
      p_song: cleanSong,
      p_by: (body ? clip(body.by, 40) : null) ?? '',
    });
    // sbRpc returns null on any HTTP failure — including our own
    // `room_not_found` raise, so translate that to a 404 client-side by
    // probing existence when the RPC signals a failure.
    if (ok === null) {
      const existing = await sbSelect<{ code: string }>(
        env, 'vinax_rooms', `code=eq.${encodeURIComponent(code)}&limit=1&select=code`,
      );
      if (!existing.length) return json({ error: 'not_found' }, 404);
      return json({ error: 'append_failed' }, 500);
    }
    return json({ ok: true });
  }

  if (action === 'react') {
    const rl = rateLimit(request, 'room-react', ROOM_RL.react, env);
    if (rl) return rl;
    const code = body ? clip(body.code, 8) : null;
    const deviceId = body ? clip(body.deviceId, 64) : null;
    const emoji = body ? clip(body.emoji, 8) : null;
    if (!code || !deviceId || !emoji || !REACTION_EMOJI.includes(emoji)) {
      return json({ error: 'bad_request' }, 400);
    }
    // Race-free by construction: each member only ever writes their OWN row
    // (keyed code+device_id), so no RPC is needed — unlike the shared request
    // array. One live reaction per member also self-limits spam. Doubles as a
    // heartbeat. Fails soft (ok:false) until the reaction columns exist.
    const ok = await sbUpsert(env, 'vinax_room_members', {
      code,
      device_id: deviceId,
      name: body ? clip(body.name, 60) : null,
      last_seen: now,
      reaction: emoji,
      reacted_at: now,
    }, 'code,device_id');
    return json({ ok });
  }

  if (action === 'heartbeat') {
    const rl = rateLimit(request, 'room-heartbeat', ROOM_RL.heartbeat, env);
    if (rl) return rl;
    const code = body ? clip(body.code, 8) : null;
    const deviceId = body ? clip(body.deviceId, 64) : null;
    if (!code || !deviceId) return json({ error: 'bad_request' }, 400);
    const ok = await sbUpsert(env, 'vinax_room_members', {
      code, device_id: deviceId, name: body ? clip(body.name, 60) : null, last_seen: now,
    }, 'code,device_id');
    return json({ ok });
  }

  if (action === 'end') {
    const rl = rateLimit(request, 'room-end', ROOM_RL.end, env);
    if (rl) return rl;
    const code = body ? clip(body.code, 8) : null;
    if (!code) return json({ error: 'bad_request' }, 400);
    const hostToken = body ? clip(body.hostToken, 64) : null;
    const authErr = await requireHost(env, code, hostToken);
    if (authErr) return authErr;
    const ok = await Promise.all([
      sbDelete(env, 'vinax_rooms', `code=eq.${encodeURIComponent(code)}`),
      sbDelete(env, 'vinax_room_members', `code=eq.${encodeURIComponent(code)}`),
    ]).then((r) => r.every(Boolean));
    return json({ ok });
  }

  if (action === 'leave') {
    const rl = rateLimit(request, 'room-leave', ROOM_RL.leave, env);
    if (rl) return rl;
    const code = body ? clip(body.code, 8) : null;
    const deviceId = body ? clip(body.deviceId, 64) : null;
    if (!code || !deviceId) return json({ error: 'bad_request' }, 400);
    const ok = await sbDelete(env, 'vinax_room_members', `code=eq.${encodeURIComponent(code)}&device_id=eq.${encodeURIComponent(deviceId)}`);
    return json({ ok });
  }

  return json({ error: 'unknown_action' }, 400);
};
