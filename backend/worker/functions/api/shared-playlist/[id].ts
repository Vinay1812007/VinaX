/**
 * 15.0 — /api/shared-playlist/<id> — one shared playlist.
 *
 *   GET  /api/shared-playlist/<id>[?token=…]  → 200 { playlist }
 *        public, or the owner (session), or a collaborator (the invite token)
 *        → 404 not_found otherwise
 *   POST /api/shared-playlist/<id> { token, add?: song, remove?: songId, by? }
 *        a collaborator adds one song or removes one; `by` is a display name
 *        → 200 { playlist } · 403 forbidden (bad token) · 404 · 413 (full)
 *   503 unavailable
 *
 * Collaborator writes bump `version` so the owner's next write sees a 409
 * and merges. No account is needed to collaborate: the link is the key.
 */
import { bearer, readSession } from '../../_lib/googleAuth';
import { CORS, accountOf, json } from '../../_lib/authShared';
import { readJsonCapped } from '../../_lib/body';
import { rateLimit, rateLimitAsync } from '../../_lib/ratelimit';
import { db, dbConfigured, q } from '../../_lib/db';
import { asObject, clip } from '../../_lib/edge';
import { safeEqual } from '../../_lib/safe-compare';
import { MAX_PLAYLIST_BYTES, MAX_PLAYLIST_SONGS, cleanSong, type SocialEnv } from '../../_lib/social';
import { publicPlaylist, type PlaylistRow } from '../shared-playlist';

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET, POST, OPTIONS' } });

const idOf = (v: unknown): string | null => (typeof v === 'string' && /^[a-z0-9]{12}$/.test(v) ? v : null);

async function load(env: SocialEnv, id: string) {
  const r = await db.one<PlaylistRow>(env, 'shared_playlists', q().eq('id', id));
  return r.ok ? { ok: true as const, row: r.value } : { ok: false as const };
}

const tokenOk = (row: PlaylistRow, token: string | null): boolean => !!row.collab_token && !!token && safeEqual(token, row.collab_token);

export const onRequestGet = async (ctx: { request: Request; env: SocialEnv; params?: Record<string, unknown> }): Promise<Response> => {
  const limited = rateLimit(ctx.request, 'shared-playlist-read', { capacity: 60, refillPerMinute: 60 }, ctx.env);
  if (limited) return limited;
  if (!dbConfigured(ctx.env)) return json({ error: 'unavailable' }, 503);
  const id = idOf(ctx.params?.id);
  if (!id) return json({ error: 'not_found' }, 404);
  const r = await load(ctx.env, id);
  if (!r.ok) return json({ error: 'unavailable' }, 503);
  if (!r.row) return json({ error: 'not_found' }, 404);
  const viewer = await readSession(ctx.env, bearer(ctx.request));
  const mine = viewer === r.row.owner_id;
  const token = new URL(ctx.request.url).searchParams.get('token');
  if (!r.row.public && !mine && !tokenOk(r.row, token)) return json({ error: 'not_found' }, 404);
  const acc = await accountOf(ctx.env, r.row.owner_id);
  return json({ playlist: publicPlaylist(r.row, { owner: acc.ok ? acc.value?.name ?? null : null, mine }), canEdit: mine || tokenOk(r.row, token) }, 200);
};

export const onRequestPost = async (ctx: { request: Request; env: SocialEnv; params?: Record<string, unknown> }): Promise<Response> => {
  const limited = await rateLimitAsync(ctx.request, 'shared-playlist-collab', { capacity: 40, refillPerMinute: 20 }, ctx.env);
  if (limited) return limited;
  if (!dbConfigured(ctx.env)) return json({ error: 'unavailable' }, 503);
  const id = idOf(ctx.params?.id);
  if (!id) return json({ error: 'not_found' }, 404);
  const read = await readJsonCapped<unknown>(ctx.request, 16_384);
  if (!read.ok) return json({ error: 'bad_request' }, 400);
  const body = asObject(read.value);
  if (!body) return json({ error: 'bad_request' }, 400);
  const r = await load(ctx.env, id);
  if (!r.ok) return json({ error: 'unavailable' }, 503);
  if (!r.row) return json({ error: 'not_found' }, 404);
  const viewer = await readSession(ctx.env, bearer(ctx.request));
  const token = typeof body.token === 'string' ? body.token : null;
  if (viewer !== r.row.owner_id && !tokenOk(r.row, token)) return json({ error: 'forbidden' }, 403);
  const songs = Array.isArray(r.row.songs) ? [...r.row.songs] : [];
  const add = body.add !== undefined ? cleanSong(body.add) : null;
  const remove = clip(body.remove, 64);
  if (!add && !remove) return json({ error: 'bad_request' }, 400);
  if (add) {
    if (songs.some((s) => s.id === add.id)) return json({ playlist: publicPlaylist(r.row) });
    if (songs.length >= MAX_PLAYLIST_SONGS) return json({ error: 'too_large' }, 413);
    songs.push({ ...add, by: clip(body.by, 40) ?? undefined });
  }
  const next = remove ? songs.filter((s) => s.id !== remove) : songs;
  // The same byte ceiling the owner's writes meet, so a collaborator can never lock the owner out.
  if (JSON.stringify(next).length > MAX_PLAYLIST_BYTES) return json({ error: 'too_large' }, 413);
  const done = await db.update<PlaylistRow>(ctx.env, 'shared_playlists', q().eq('id', id).eq('version', r.row.version), { songs: next, version: r.row.version + 1, updated_at: new Date().toISOString() }, { returning: true });
  if (!done.ok) return json({ error: 'unavailable' }, 503);
  if (!done.rows.length) return json({ error: 'conflict' }, 409);
  return json({ playlist: publicPlaylist(done.rows[0]) });
};
