/**
 * 15.0 — /api/profile — the signed-in listener's own public profile.
 *
 *   GET  /api/profile                → 200 { profile }   (204 when none yet)
 *   PUT  /api/profile { handle?, public?, bio?, summary?, nowPlaying?, shareNow?, shareJam?, jam? }
 *                                    → 200 { profile }
 *                                    → 400 bad_request | 409 taken (handle held by another account)
 *                                    → 403 forbidden (jam: not this listener's room) | 409 ended (jam: the room is not live)
 *   DELETE /api/profile              → 204  (the profile and every follow go; the account stays)
 *   401 signed_out · 503 unavailable
 *
 * `summary` is the device's digest (top artists, top languages, recent
 * likes) — the app writes it with sync; nothing is computed here. The
 * profile is private (`public: false`) until the listener switches it on.
 * Public views are at /api/profile/<handle>.
 *
 * v23 — join a friend's jam. `shareJam` is "Let people I follow join my
 * room" (off by default). `jam: { code, hostToken }` says which room this
 * listener hosts: the host token must match the room's (so nobody can point
 * friends at someone else's room) and the room must be live. `jam: null`, or
 * `shareJam: false`, clears it. The code is kept in profiles.jam_code, which
 * the database clears when the room ends or is swept; mutual followers read
 * it through /api/follow and /api/profile/<handle>, and only while the room is
 * live. A write that only touches the jam leaves `updated_at` alone, so it
 * never makes an old "now playing" look fresh.
 */
import { CORS, accountOf, json } from '../_lib/authShared';
import { readJsonCapped } from '../_lib/body';
import { rateLimitAsync } from '../_lib/ratelimit';
import { db, q } from '../_lib/db';
import { asObject, clip } from '../_lib/edge';
import { safeEqual } from '../_lib/safe-compare';
import { JAM_LIVE_MS, MAX_SUMMARY_BYTES, ROOM_CODE_RE, cleanSong, cleanSummary, normalizeHandle, profileByHandle, profileOf, publicProfile, requireAccount, type ProfileRow, type SocialEnv } from '../_lib/social';

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET, PUT, DELETE, OPTIONS' } });

export const onRequestGet = async (ctx: { request: Request; env: SocialEnv }): Promise<Response> => {
  const who = await requireAccount(ctx.env, ctx.request);
  if ('fail' in who) return who.fail;
  const r = await profileOf(ctx.env, who.sub);
  if (!r.ok) return json({ error: 'unavailable' }, 503);
  if (!r.value) return new Response(null, { status: 204, headers: CORS });
  const followers = await db.count(ctx.env, 'follows', q().eq('followee_id', who.sub));
  return json({ profile: publicProfile(r.value, { followers: followers.ok ? followers.value : 0, own: true }) });
};

export const onRequestPut = async (ctx: { request: Request; env: SocialEnv }): Promise<Response> => {
  const { request, env } = ctx;
  const limited = await rateLimitAsync(request, 'profile-write', { capacity: 20, refillPerMinute: 10 }, env);
  if (limited) return limited;
  const who = await requireAccount(env, request);
  if ('fail' in who) return who.fail;
  const read = await readJsonCapped<Record<string, unknown> | null>(request, MAX_SUMMARY_BYTES + 8_192);
  if (!read.ok) return json({ error: read.reason === 'too_large' ? 'too_large' : 'bad_request' }, read.reason === 'too_large' ? 413 : 400);
  const body = asObject(read.value) ?? {};

  const existing = await profileOf(env, who.sub);
  if (!existing.ok) return json({ error: 'unavailable' }, 503);

  const handle = body.handle !== undefined ? normalizeHandle(body.handle) : existing.value?.handle ?? null;
  if (body.handle !== undefined && !handle) return json({ error: 'bad_request', field: 'handle' }, 400);
  if (!handle) return json({ error: 'bad_request', field: 'handle' }, 400);
  if (handle !== existing.value?.handle) {
    const held = await profileByHandle(env, handle);
    if (!held.ok) return json({ error: 'unavailable' }, 503);
    if (held.value && held.value.account_id !== who.sub) return json({ error: 'taken' }, 409);
  }
  if (body.bio !== undefined && body.bio !== null && typeof body.bio !== 'string') return json({ error: 'bad_request', field: 'bio' }, 400);

  // v23 — the room this listener hosts, checked against the room itself.
  const shareJam = typeof body.shareJam === 'boolean' ? body.shareJam : existing.value?.share_jam === true;
  let jamCode: string | null | undefined; // undefined: unchanged
  if (body.jam === null) jamCode = null;
  else if (body.jam !== undefined) {
    const j = asObject(body.jam);
    const code = typeof j?.code === 'string' ? j.code.trim().toUpperCase() : '';
    const token = clip(j?.hostToken, 64);
    if (!ROOM_CODE_RE.test(code) || !token) return json({ error: 'bad_request', field: 'jam' }, 400);
    if (shareJam) {
      const room = await db.one<{ host_token: string; updated_at: string }>(env, 'rooms', q().eq('code', code).select('host_token,updated_at'));
      if (!room.ok) return json({ error: 'unavailable' }, 503);
      if (!room.value || !safeEqual(token, room.value.host_token)) return json({ error: 'forbidden', field: 'jam' }, 403);
      if (!(Date.now() - Date.parse(room.value.updated_at) < JAM_LIVE_MS)) return json({ error: 'ended', field: 'jam' }, 409);
      jamCode = code;
    } else jamCode = null;
  }
  // The switch off: no code stays behind.
  if (!shareJam && (jamCode !== undefined || existing.value?.jam_code)) jamCode = null;
  const jamOnly = !!existing.value && Object.keys(body).every((k) => k === 'jam');

  const patch: Partial<ProfileRow> & { account_id: string; handle: string; updated_at: string } = {
    account_id: who.sub,
    handle,
    updated_at: jamOnly && existing.value ? existing.value.updated_at : new Date().toISOString(),
    public: typeof body.public === 'boolean' ? body.public : existing.value?.public ?? false,
    share_now: typeof body.shareNow === 'boolean' ? body.shareNow : existing.value?.share_now ?? false,
    bio: body.bio === undefined ? existing.value?.bio ?? null : body.bio === null ? null : clip(body.bio, 160),
    summary: body.summary !== undefined ? cleanSummary(body.summary) : existing.value?.summary ?? cleanSummary({}),
    now_playing: body.nowPlaying === undefined ? existing.value?.now_playing ?? null : body.nowPlaying === null ? null : cleanSong(body.nowPlaying),
    // Sent only when they change, so a write that never touches the jam works on a database before v23.
    ...(typeof body.shareJam === 'boolean' ? { share_jam: body.shareJam } : {}),
    ...(jamCode !== undefined ? { jam_code: jamCode } : {}),
  };
  if (JSON.stringify(patch.summary).length > MAX_SUMMARY_BYTES) return json({ error: 'too_large' }, 413);
  const wrote = await db.upsert<ProfileRow>(env, 'profiles', patch, 'account_id', { returning: true });
  if (!wrote.ok) {
    // v23 — the room went between the check and the write (profiles.jam_code references rooms;
    // PostgREST answers a foreign-key miss with 409, so this comes before `taken`).
    if (wrote.code === '23503' && typeof jamCode === 'string') return json({ error: 'ended', field: 'jam' }, 409);
    if (wrote.error === 'conflict') return json({ error: 'taken' }, 409);
    if (wrote.code === '23503') return json({ error: 'signed_out' }, 401);
    return json({ error: 'unavailable' }, 503);
  }
  const acc = await accountOf(env, who.sub);
  const row = wrote.rows[0] ?? ({ ...patch } as ProfileRow);
  return json({ profile: publicProfile(row, { name: acc.ok ? acc.value?.name ?? null : null, picture: acc.ok ? acc.value?.picture ?? null : null, own: true }) });
};

export const onRequestDelete = async (ctx: { request: Request; env: SocialEnv }): Promise<Response> => {
  const who = await requireAccount(ctx.env, ctx.request);
  if ('fail' in who) return who.fail;
  const a = await db.remove(ctx.env, 'follows', q().eq('follower_id', who.sub));
  const b = await db.remove(ctx.env, 'follows', q().eq('followee_id', who.sub));
  const c = await db.remove(ctx.env, 'profiles', q().eq('account_id', who.sub));
  if (!a.ok || !b.ok || !c.ok) return json({ error: 'unavailable' }, 503);
  return new Response(null, { status: 204, headers: CORS });
};
