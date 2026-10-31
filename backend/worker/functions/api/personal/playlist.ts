/**
 * The playlist builder (Authorization: Bearer <session>).
 *
 *   POST /api/personal/playlist { prompt, count?, hour? }
 *     → 200 { id, title, description, songs: [SongRecord & { reason? }], plan, model, generatedAt }
 *     → 400 bad_request                         no prompt (3–500 characters)
 *     → 422 nothing_found                       the catalogue and the pool had nothing that fits
 *   GET /api/personal/playlist?id=<id>          a playlist built earlier, for the account that built it
 *   401 signed_out · 503 unavailable · 503 personal_disabled · 429 (six a minute per account)
 *
 * docs/personalisation.md "Building a playlist".
 */
import { readJsonCapped } from '../../_lib/body';
import { json } from '../../_lib/authShared';
import { embedSongs } from '../../_lib/personal/embed';
import type { PersonalEnv } from '../../_lib/personal/engine';
import { buildPlaylist, PLAYLIST_DEFAULT } from '../../_lib/personal/playlist';
import { gate, localTime, options, personalJson } from '../../_lib/personal/route';
import { loadExposure, loadPlaylistPage, loadTaste, savePage } from '../../_lib/personal/store';
import type { PlaylistPage } from '../../_lib/personal/types';

export const onRequestOptions = options('GET, POST, OPTIONS');

const PLAYLIST_TTL_MS = 30 * 86_400_000;

export const onRequestPost = async (ctx: { request: Request; env: PersonalEnv; waitUntil?: (p: Promise<unknown>) => void }): Promise<Response> => {
  const g = await gate(ctx.env, ctx.request, 'personal-playlist', { capacity: 10, refillPerMinute: 6, perAccount: 'RATE_LIMIT_10' });
  if ('fail' in g) return g.fail;
  const read = await readJsonCapped<{ prompt?: unknown; count?: unknown; hour?: unknown } | null>(ctx.request, 8_192);
  if (!read.ok) return json({ error: 'bad_request' }, 400);
  const prompt = typeof read.value?.prompt === 'string' ? read.value.prompt.replace(/\s+/g, ' ').trim() : '';
  if (prompt.length < 3 || prompt.length > 500) return json({ error: 'bad_request' }, 400);
  const count = typeof read.value?.count === 'number' && Number.isFinite(read.value.count) ? Math.round(read.value.count) : PLAYLIST_DEFAULT;
  const { hour } = localTime({ hour: read.value?.hour });
  const now = Date.now();
  const loaded = await loadTaste(ctx.env, g.sub);
  if (!loaded.ok) return json({ error: 'unavailable' }, 503);
  const built = await buildPlaylist(ctx.env, { accountId: g.sub, prompt, count, taste: loaded.taste, exposure: (ids) => loadExposure(ctx.env, g.sub, ids), config: g.config, hour, now });
  if (!built.songs.length) return json({ error: 'nothing_found' }, 422);
  const page: PlaylistPage = { id: crypto.randomUUID(), title: built.title, description: built.description, songs: built.songs, plan: built.plan, model: built.composed ? built.model : null, generatedAt: new Date(now).toISOString() };
  const work = (async () => {
    await savePage(ctx.env, g.sub, 'playlist', page, { id: page.id, prompt, tasteVersion: loaded.taste.version, eventsSeen: loaded.taste.eventsSeen, modelId: built.model, composed: built.composed, builtMs: Date.now() - now, expiresAt: new Date(now + PLAYLIST_TTL_MS).toISOString() });
    await embedSongs(ctx.env, g.config.embedModel, built.pool.fresh);
  })().catch(() => undefined);
  if (ctx.waitUntil) ctx.waitUntil(work); else await work;
  console.log(JSON.stringify({ route: 'personal-playlist', composed: built.composed, model: built.model, songs: built.songs.length, ms: Date.now() - now }));
  return personalJson(page);
};

export const onRequestGet = async (ctx: { request: Request; env: PersonalEnv }): Promise<Response> => {
  const g = await gate(ctx.env, ctx.request, 'personal-playlist-get', { capacity: 30, refillPerMinute: 30 });
  if ('fail' in g) return g.fail;
  const id = new URL(ctx.request.url).searchParams.get('id') ?? '';
  if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: 'bad_request' }, 400);
  const page = await loadPlaylistPage(ctx.env, g.sub, id);
  if (!page) return json({ error: 'not_found' }, 404);
  return personalJson(page);
};

