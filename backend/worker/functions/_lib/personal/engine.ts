/**
 * The personal engine's three jobs, each one call from a route:
 *
 *   ingestEvents   a device's batch → songs written, events recorded,
 *                  the model folded and saved, the vector recomputed,
 *                  new songs embedded (in the background)
 *   buildHome      the page: cached, else gathered, ranked, shelved,
 *                  composed, saved
 *   recommend      a ranked list for a seed or for the taste alone
 *
 * Every step degrades: a source that fails leaves a smaller pool, a model
 * that fails leaves the deterministic page, an embedding that fails waits
 * for the backlog job.
 */
import type { AiEnv } from '../ai/types';
import { db } from '../db';
import { composeHome, type ComposeContext } from './compose';
import { personalConfig, type PersonalConfig } from './config';
import { embedSongs } from './embed';
import { toRpcEvent } from './events';
import { gatherPool } from './retrieval';
import { rerank, reasonLine, scorePool } from './scoring';
import { buildShelves, isoWeekOf, MIN_SHELF } from './shelves';
import { fetchSongs, toRecord, upsertSongs } from './songs';
import { loadExposure, loadPage, loadTaste, savePage, saveTaste } from './store';
import { foldEvents, isTasteMode } from './taste';
import type { HomePage, PersonalEvent, SongFacts, SongRecord, SongRow, Taste, TasteMode } from './types';

export type PersonalEnv = AiEnv & { CATALOG_UPSTREAMS?: string; CATALOG_DIRECT_URL?: string };
type WaitUntil = ((p: Promise<unknown>) => void) | undefined;

export const HOME_TTL_MS = 30 * 60_000;
/** A new page when the model moved by more than this many folds since the cached one. */
const HOME_STALE_VERSIONS = 2;

const background = (waitUntil: WaitUntil, p: Promise<unknown>) => {
  const safe = p.catch(() => undefined);
  if (waitUntil) waitUntil(safe);
  return safe;
};

// ----------------------------------------------------------------- events --

export interface IngestResult { accepted: number; duplicates: number; version: number | null }

export async function ingestEvents(env: PersonalEnv, accountId: string, events: PersonalEvent[], songs: SongFacts[], o: { mode?: unknown; waitUntil?: WaitUntil; config?: PersonalConfig; now?: number } = {}): Promise<IngestResult | { fail: 'unavailable' }> {
  const now = o.now ?? Date.now();
  const config = o.config ?? (await personalConfig(env));
  if (songs.length) await upsertSongs(env, songs);
  const recorded = await db.rpc<{ inserted?: string[] }>(env, 'personal_record_events', { p_account: accountId, p_events: events.map(toRpcEvent) });
  if (!recorded.ok) return recorded.code === '23503' ? { accepted: 0, duplicates: 0, version: null } : { fail: 'unavailable' };
  const inserted = new Set(Array.isArray(recorded.value?.inserted) ? recorded.value!.inserted : []);
  const accepted = events.filter((e) => inserted.has(e.id));
  const result: IngestResult = { accepted: accepted.length, duplicates: events.length - accepted.length, version: null };
  const mode = isTasteMode(o.mode) ? o.mode : null;
  if (!accepted.length && !mode) return result;

  // The songs the fold needs: what the device sent, else what the engine has.
  const facts = new Map<string, SongFacts | SongRow>(songs.map((s) => [s.id, s]));
  const missing = accepted.map((e) => e.songId).filter((id) => !facts.has(id));
  if (missing.length) for (const [id, row] of await fetchSongs(env, missing)) facts.set(id, row);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const loaded = await loadTaste(env, accountId);
    if (!loaded.ok) return { fail: 'unavailable' };
    const folded = foldEvents(loaded.taste, accepted, facts, now);
    if (mode) folded.mode = mode;
    const saved = await saveTaste(env, accountId, folded, loaded.taste.version, loaded.fresh);
    if (!saved.ok) return { fail: 'unavailable' };
    if (saved.value) { result.version = loaded.taste.version + 1; break; }
  }

  background(o.waitUntil, (async () => {
    if (songs.length) await embedSongs(env, config.embedModel, songs);
    if (accepted.length) await db.rpc(env, 'personal_recompute_vector', { p_account: accountId, p_model: config.embedModel, p_top: 150 });
  })());
  return result;
}

// ------------------------------------------------------------------- home --

export interface HomeOptions {
  fresh?: boolean;
  hour?: number | null;
  dow?: number | null;
  mode?: TasteMode | null;
  firstName?: string | null;
  festival?: string | null;
  waitUntil?: WaitUntil;
  now?: number;
  config?: PersonalConfig;
  signal?: AbortSignal;
}

export interface HomeResult { page: HomePage; cached: boolean; composed: boolean; builtMs: number }

export async function buildHome(env: PersonalEnv, accountId: string, o: HomeOptions = {}): Promise<HomeResult | { fail: 'unavailable' | 'empty' }> {
  const now = o.now ?? Date.now();
  const config = o.config ?? (await personalConfig(env));
  const loaded = await loadTaste(env, accountId);
  if (!loaded.ok) return { fail: 'unavailable' };
  const taste: Taste = loaded.taste;
  if (o.mode && o.mode !== taste.mode) taste.mode = o.mode;

  if (!o.fresh) {
    const cached = await loadPage<HomePage>(env, accountId, 'home', now);
    if (cached && (cached.taste_version === null || taste.version - cached.taste_version <= HOME_STALE_VERSIONS)) {
      return { page: cached.page, cached: true, composed: cached.composed, builtMs: 0 };
    }
  }

  const started = Date.now();
  const [pool, exposure] = await Promise.all([
    gatherPool(env, { accountId, taste, embedModel: config.embedModel, now }),
    loadExposure(env, accountId),
  ]);
  const hour = typeof o.hour === 'number' ? o.hour : null;
  const scored = scorePool(pool.candidates, pool.songs, { taste, exposure, weights: config.weights, now, hour, intent: 'taste' });
  const shelves = buildShelves(scored, { taste, songs: pool.songs, now, hour, isoWeek: isoWeekOf(now) });
  if (!shelves.length) {
    background(o.waitUntil, embedSongs(env, config.embedModel, pool.fresh));
    return { fail: 'empty' };
  }

  const ctx: ComposeContext = { taste, firstName: o.firstName ?? null, hour, dow: typeof o.dow === 'number' ? o.dow : null, festival: o.festival ?? null };
  const composed = config.composer ? await composeHome(env, shelves, ctx, o.signal) : { shelves, greeting: null, model: null, composed: false, ms: 0 };
  const builtMs = Date.now() - started;
  const page: HomePage = {
    generatedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + HOME_TTL_MS).toISOString(),
    greeting: composed.greeting,
    shelves: composed.shelves,
    model: composed.composed ? composed.model : null,
    tasteVersion: taste.version,
  };
  background(o.waitUntil, (async () => {
    await savePage(env, accountId, 'home', page, { id: crypto.randomUUID(), tasteVersion: taste.version, modelId: composed.model, composed: composed.composed, builtMs, expiresAt: page.expiresAt });
    await embedSongs(env, config.embedModel, pool.fresh);
  })());
  console.log(JSON.stringify({ route: 'personal-home', composed: composed.composed, model: composed.model, shelves: page.shelves.length, pool: pool.candidates.size, ms: builtMs }));
  return { page, cached: false, composed: composed.composed, builtMs };
}

// -------------------------------------------------------------- recommend --

export interface RecommendOptions {
  seed?: string | null;
  limit?: number;
  exclude?: readonly string[];
  hour?: number | null;
  mode?: TasteMode | null;
  waitUntil?: WaitUntil;
  now?: number;
  config?: PersonalConfig;
}

export async function recommend(env: PersonalEnv, accountId: string, o: RecommendOptions = {}): Promise<{ songs: SongRecord[]; seed: string | null } | { fail: 'unavailable' }> {
  const now = o.now ?? Date.now();
  const config = o.config ?? (await personalConfig(env));
  const loaded = await loadTaste(env, accountId);
  if (!loaded.ok) return { fail: 'unavailable' };
  const taste = loaded.taste;
  if (o.mode && o.mode !== taste.mode) taste.mode = o.mode;
  const seed = o.seed ?? null;
  const [pool, exposure] = await Promise.all([
    gatherPool(env, { accountId, taste, embedModel: config.embedModel, seed, now }),
    loadExposure(env, accountId),
  ]);
  const exclude = new Set(o.exclude ?? []);
  if (seed) exclude.add(seed);
  const scored = scorePool(pool.candidates, pool.songs, { taste, exposure, weights: config.weights, now, hour: o.hour ?? null, intent: seed ? 'seed' : 'taste' })
    .filter((s) => !exclude.has(s.song.id));
  const picks = rerank(scored, { limit: Math.min(50, Math.max(1, o.limit ?? 20)), artistCap: 3 });
  background(o.waitUntil, embedSongs(env, config.embedModel, pool.fresh));
  return { songs: picks.map((p) => toRecord(p.song, reasonLine(p))), seed };
}

export { MIN_SHELF };
