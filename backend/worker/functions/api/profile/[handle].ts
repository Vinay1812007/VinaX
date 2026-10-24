/**
 * 15.0 — GET /api/profile/<handle> — a listener's public profile.
 *
 *   → 200 { profile }       public, or private and the caller follows them back
 *   → 404 not_found         no such handle, or private to the caller
 *   503 unavailable
 *
 * With a session, `following` says whether the caller follows this profile.
 * The account id never leaves; `name` and `picture` come from the account
 * only when the profile is public.
 */
import { bearer, readSession } from '../../_lib/googleAuth';
import { CORS, accountOf, json } from '../../_lib/authShared';
import { rateLimit } from '../../_lib/ratelimit';
import { db, dbConfigured, q } from '../../_lib/db';
import { isFollowing, normalizeHandle, profileByHandle, publicProfile, type SocialEnv } from '../../_lib/social';

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: CORS });

export const onRequestGet = async (ctx: { request: Request; env: SocialEnv; params?: Record<string, unknown> }): Promise<Response> => {
  const limited = rateLimit(ctx.request, 'profile-read', { capacity: 60, refillPerMinute: 60 }, ctx.env);
  if (limited) return limited;
  if (!dbConfigured(ctx.env)) return json({ error: 'unavailable' }, 503);
  const handle = normalizeHandle(ctx.params?.handle);
  if (!handle) return json({ error: 'not_found' }, 404);
  const r = await profileByHandle(ctx.env, handle);
  if (!r.ok) return json({ error: 'unavailable' }, 503);
  const p = r.value;
  if (!p) return json({ error: 'not_found' }, 404);
  const viewer = await readSession(ctx.env, bearer(ctx.request));
  const self = viewer === p.account_id;
  let following: boolean | undefined;
  if (viewer && !self) following = (await isFollowing(ctx.env, viewer, p.account_id)) ?? false;
  if (!p.public && !self) {
    // Private: visible to people they follow who follow them back.
    const back = viewer ? await isFollowing(ctx.env, p.account_id, viewer) : false;
    if (!back || !following) return json({ error: 'not_found' }, 404);
  }
  const [acc, followers] = await Promise.all([accountOf(ctx.env, p.account_id), db.count(ctx.env, 'follows', q().eq('followee_id', p.account_id))]);
  return json({ profile: publicProfile(p, { following, followers: followers.ok ? followers.value : 0, name: acc.ok ? acc.value?.name ?? null : null, picture: acc.ok ? acc.value?.picture ?? null : null }) });
};
