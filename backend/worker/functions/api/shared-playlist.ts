/**
 * 15.0 — /api/shared-playlist — a playlist that leaves the device.
 *
 *   POST /api/shared-playlist { id?, name, description?, songs, public?, collab? , version? }
 *        → 200 { playlist, collabToken? }   created (no id) or updated (owner's id)
 *        → 409 { playlist }                   someone wrote first (collaborator or other device): merge and resend
 *        400 bad_request · 403 forbidden (not the owner) · 413 too_large
 *   DELETE /api/shared-playlist?id=…   → 204
 *   401 signed_out · 503 unavailable
 *
 * `collab: true` mints an invite token (returned once per mint; a later POST
 * with `collab: false` revokes it). Reads and collaborator writes are at
 * /api/shared-playlist/<id>.
 */
import { CORS, accountOf, json } from '../_lib/authShared';
import { readJsonCapped } from '../_lib/body';
import { rateLimitAsync } from '../_lib/ratelimit';
import { db, q } from '../_lib/db';
import { asObject, clip } from '../_lib/edge';
import { MAX_PLAYLIST_BYTES, MAX_PLAYLIST_SONGS, cleanSong, newId, newToken, requireAccount, type SocialEnv } from '../_lib/social';

export interface PlaylistRow {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  songs: Array<Record<string, unknown>>;
  public: boolean;
  collab_token: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export function cleanSongs(raw: unknown): Array<Record<string, unknown>> | null {
  if (!Array.isArray(raw)) return null;
  const out: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  for (const s of raw.slice(0, MAX_PLAYLIST_SONGS)) {
    const c = cleanSong(s);
    if (!c || seen.has(c.id as string)) continue;
    seen.add(c.id as string);
    out.push(c);
  }
  return out;
}

/** The playlist as anyone may see it; `collab` says an invite exists, never what it is. */
export function publicPlaylist(p: PlaylistRow, extra: { owner?: string | null; mine?: boolean } = {}) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    // No music provider: a shared playlist's stored songs are never shown.
    songs: [],
    public: p.public,
    collab: !!p.collab_token,
    version: p.version,
    owner: extra.owner ?? null,
    mine: extra.mine ?? false,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS' } });

export const onRequestGet = async (ctx: { request: Request; env: SocialEnv }): Promise<Response> => {
  const who = await requireAccount(ctx.env, ctx.request);
  if ('fail' in who) return who.fail;
  const r = await db.select<PlaylistRow>(ctx.env, 'shared_playlists', q().eq('owner_id', who.sub).order('updated_at', 'desc').limit(200));
  if (!r.ok) return json({ error: 'unavailable' }, 503);
  return json({ playlists: r.rows.map((p) => publicPlaylist(p, { mine: true })) });
};

export const onRequestPost = async (ctx: { request: Request; env: SocialEnv }): Promise<Response> => {
  const { request, env } = ctx;
  const limited = await rateLimitAsync(request, 'shared-playlist', { capacity: 30, refillPerMinute: 15 }, env);
  if (limited) return limited;
  const who = await requireAccount(env, request);
  if ('fail' in who) return who.fail;
  const read = await readJsonCapped<unknown>(request, MAX_PLAYLIST_BYTES + 8_192);
  if (!read.ok) return json({ error: read.reason === 'too_large' ? 'too_large' : 'bad_request' }, read.reason === 'too_large' ? 413 : 400);
  const body = asObject(read.value);
  if (!body) return json({ error: 'bad_request' }, 400);
  const name = clip(body.name, 80);
  const songs = cleanSongs(body.songs);
  if (!name || !songs) return json({ error: 'bad_request' }, 400);
  if (JSON.stringify(songs).length > MAX_PLAYLIST_BYTES) return json({ error: 'too_large' }, 413);
  const description = body.description === undefined || body.description === null ? null : clip(body.description, 300);
  const isPublic = typeof body.public === 'boolean' ? body.public : undefined;
  const collab = typeof body.collab === 'boolean' ? body.collab : undefined;
  const now = new Date().toISOString();
  const acc = await accountOf(env, who.sub);
  const ownerName = acc.ok ? acc.value?.name ?? null : null;

  const id = typeof body.id === 'string' && /^[a-z0-9]{12}$/.test(body.id) ? body.id : null;
  if (!id) {
    const row: PlaylistRow = { id: newId(), owner_id: who.sub, name, description, songs, public: isPublic ?? false, collab_token: collab ? newToken() : null, version: 1, created_at: now, updated_at: now };
    const made = await db.insert<PlaylistRow>(env, 'shared_playlists', row, { returning: true });
    if (!made.ok) return json({ error: made.code === '23503' ? 'signed_out' : 'unavailable' }, made.code === '23503' ? 401 : 503);
    const saved = made.rows[0] ?? row;
    return json({ playlist: publicPlaylist(saved, { owner: ownerName, mine: true }), ...(saved.collab_token ? { collabToken: saved.collab_token } : {}) });
  }
  const cur = await db.one<PlaylistRow>(env, 'shared_playlists', q().eq('id', id));
  if (!cur.ok) return json({ error: 'unavailable' }, 503);
  if (!cur.value) return json({ error: 'not_found' }, 404);
  if (cur.value.owner_id !== who.sub) return json({ error: 'forbidden' }, 403);
  const seen = typeof body.version === 'number' && Number.isInteger(body.version) ? body.version : cur.value.version;
  if (seen !== cur.value.version) return json({ playlist: publicPlaylist(cur.value, { owner: ownerName, mine: true }) }, 409);
  let token = cur.value.collab_token;
  let minted = false;
  if (collab === true && !token) { token = newToken(); minted = true; }
  if (collab === false) token = null;
  const patch = { name, description, songs, public: isPublic ?? cur.value.public, collab_token: token, version: seen + 1, updated_at: now };
  const done = await db.update<PlaylistRow>(env, 'shared_playlists', q().eq('id', id).eq('version', seen), patch, { returning: true });
  if (!done.ok) return json({ error: 'unavailable' }, 503);
  if (!done.rows.length) {
    const again = await db.one<PlaylistRow>(env, 'shared_playlists', q().eq('id', id));
    return again.ok && again.value ? json({ playlist: publicPlaylist(again.value, { owner: ownerName, mine: true }) }, 409) : json({ error: 'unavailable' }, 503);
  }
  return json({ playlist: publicPlaylist(done.rows[0], { owner: ownerName, mine: true }), ...(minted || (collab === true && token) ? { collabToken: token } : {}) });
};

export const onRequestDelete = async (ctx: { request: Request; env: SocialEnv }): Promise<Response> => {
  const who = await requireAccount(ctx.env, ctx.request);
  if ('fail' in who) return who.fail;
  const id = new URL(ctx.request.url).searchParams.get('id') ?? '';
  if (!/^[a-z0-9]{12}$/.test(id)) return json({ error: 'bad_request' }, 400);
  const r = await db.remove(ctx.env, 'shared_playlists', q().eq('id', id).eq('owner_id', who.sub));
  if (!r.ok) return json({ error: 'unavailable' }, 503);
  return new Response(null, { status: 204, headers: CORS });
};
