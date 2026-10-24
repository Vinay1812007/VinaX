/**
 * 15.0 — /api/follow — who the signed-in listener follows.
 *
 *   GET  /api/follow                 → 200 { following: [profile…] }
 *        each profile carries `nowPlaying` when that listener shares it and
 *        was playing in the last 20 minutes — the "friends are listening"
 *        row on Home reads this.
 *   POST /api/follow { handle, on }  → 200 { following: boolean }
 *        400 bad_request · 404 not_found (no such public handle) · 409 self
 *   401 signed_out · 503 unavailable
 */
import { CORS, json } from '../_lib/authShared';
import { readJsonCapped } from '../_lib/body';
import { rateLimitAsync } from '../_lib/ratelimit';
import { db, q } from '../_lib/db';
import { asObject } from '../_lib/edge';
import { normalizeHandle, profileByHandle, publicProfile, requireAccount, type ProfileRow, type SocialEnv } from '../_lib/social';

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET, POST, OPTIONS' } });

export const MAX_FOLLOWING = 500;

export const onRequestGet = async (ctx: { request: Request; env: SocialEnv }): Promise<Response> => {
  const who = await requireAccount(ctx.env, ctx.request);
  if ('fail' in who) return who.fail;
  const f = await db.select<{ followee_id: string }>(ctx.env, 'follows', q().eq('follower_id', who.sub).select('followee_id').limit(MAX_FOLLOWING));
  if (!f.ok) return json({ error: 'unavailable' }, 503);
  const ids = f.rows.map((r) => r.followee_id);
  if (!ids.length) return json({ following: [] });
  const p = await db.select<ProfileRow>(ctx.env, 'profiles', q().in('account_id', ids).limit(MAX_FOLLOWING));
  if (!p.ok) return json({ error: 'unavailable' }, 503);
  const names = await db.select<{ id: string; name: string | null; picture: string | null }>(ctx.env, 'accounts', q().in('id', ids).select('id,name,picture').limit(MAX_FOLLOWING));
  const byId = new Map((names.ok ? names.rows : []).map((a) => [a.id, a]));
  const wanted = new Set(ids);
  const following = p.rows.filter((row) => wanted.has(row.account_id)).map((row) => publicProfile(row, { following: true, name: byId.get(row.account_id)?.name ?? null, picture: byId.get(row.account_id)?.picture ?? null }));
  following.sort((a, b) => (b.nowPlaying ? 1 : 0) - (a.nowPlaying ? 1 : 0) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  return json({ following });
};

export const onRequestPost = async (ctx: { request: Request; env: SocialEnv }): Promise<Response> => {
  const limited = await rateLimitAsync(ctx.request, 'follow', { capacity: 30, refillPerMinute: 20 }, ctx.env);
  if (limited) return limited;
  const who = await requireAccount(ctx.env, ctx.request);
  if ('fail' in who) return who.fail;
  const read = await readJsonCapped<unknown>(ctx.request, 4_096);
  if (!read.ok) return json({ error: 'bad_request' }, 400);
  const body = asObject(read.value);
  const handle = normalizeHandle(body?.handle);
  const on = body?.on;
  if (!handle || typeof on !== 'boolean') return json({ error: 'bad_request' }, 400);
  const target = await profileByHandle(ctx.env, handle);
  if (!target.ok) return json({ error: 'unavailable' }, 503);
  if (!target.value) return json({ error: 'not_found' }, 404);
  if (target.value.account_id === who.sub) return json({ error: 'self' }, 409);
  if (on) {
    const n = await db.count(ctx.env, 'follows', q().eq('follower_id', who.sub));
    if (n.ok && n.value >= MAX_FOLLOWING) return json({ error: 'too_many' }, 409);
    const w = await db.insert(ctx.env, 'follows', { follower_id: who.sub, followee_id: target.value.account_id }, { onConflict: 'follower_id,followee_id', ignoreDuplicates: true });
    if (!w.ok) return json({ error: 'unavailable' }, 503);
  } else {
    const w = await db.remove(ctx.env, 'follows', q().eq('follower_id', who.sub).eq('followee_id', target.value.account_id));
    if (!w.ok) return json({ error: 'unavailable' }, 503);
  }
  return json({ following: on });
};
