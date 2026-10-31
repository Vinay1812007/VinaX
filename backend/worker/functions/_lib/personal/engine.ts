/**
 * The personal engine's three jobs, each one call from a route:
 *
 *   ingestEvents   a device's batch → events recorded, songs touched (never
 *                  rewritten), the model folded and saved, the vector
 *                  recomputed, new songs confirmed with the catalogue and
 *                  embedded (in the background)
 *   buildHome      the page: cached, else gathered, ranked, shelved,
 *                  composed, saved
 *   recommend      a ranked list for a seed or for the taste alone
 *
 * Every step degrades: a source that fails leaves a smaller pool, a model
 * that fails leaves the deterministic page, an embedding that fails waits
 * for the backlog job. A batch is never half-counted: when its events were
 * recorded but the fold could not be saved, the events are taken out again
 * and the device retries the whole batch.
 */
import type { AiEnv } from '../ai/types';
import { db, q } from '../db';
import { catalogueSongs } from './catalogue';
import { composeHome, COMPOSE_BUDGET_MS, type ComposeContext } from './compose';
import { personalConfig, type PersonalConfig } from './config';
import { embedSongs } from './embed';
import { toRpcEvent } from './events';
import { gatherPool } from './retrieval';
import { rerank, reasonLine, scorePool } from './scoring';
import { buildShelves, isoWeekOf, MIN_SHELF } from './shelves';
import { fetchSongs, toRecord, touchSongs } from './songs';
import { loadExposure, loadPage, loadTaste, savePage, saveTaste } from './store';
import { foldEvents, isTasteMode } from './taste';
import type { HomePage, PersonalEvent, SongFacts, SongRecord, SongRow, Taste, TasteMode } from './types';

export type PersonalEnv = AiEnv & { CATALOG_UPSTREAMS?: string; CATALOG_DIRECT_URL?: string };
type WaitUntil = ((p: Promise<unknown>) => void) | undefined;

export const HOME_TTL_MS = 30 * 60_000;
/** A new page once the model took in this many events since the cached one was built. */
export const HOME_STALE_EVENTS = 30;
/** Device-asserted songs confirmed with the catalogue per batch (the job does the rest). */
const VERIFY_PER_BATCH = 10;

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
  const mode = isTasteMode(o.mode) ? o.mode : null;

  // 1. The events, first: the account's foreign key is the proof the account still exists.
  const recorded = events.length
    ? await db.rpc<{ inserted?: string[] }>(env, 'personal_record_events', { p_account: accountId, p_events: events.map(toRpcEvent) })
    : ({ ok: true, value: { inserted: [] } } as const);
  if (!recorded.ok) return recorded.code === '23503' ? { accepted: 0, duplicates: 0, version: null } : { fail: 'unavailable' };
  const inserted = new Set(Array.isArray(recorded.value?.inserted) ? recorded.value!.inserted : []);
  const accepted = events.filter((e) => inserted.has(e.id));
  const result: IngestResult = { accepted: accepted.length, duplicates: events.length - accepted.length, version: null };

  // 2. The songs the batch named, never rewriting what the engine knows (verified rows win).
  const named = new Set(accepted.map((e) => e.songId));
  const touched = songs.filter((s) => named.has(s.id));
  if (touched.length) await touchSongs(env, touched, false);

  // 3. The fold, with the version check; a lost race re-reads and folds again.
  const facts = new Map<string, SongFacts | SongRow>(touched.map((s) => [s.id, s]));
  const missing = accepted.map((e) => e.songId).filter((id) => !facts.has(id));
  if (missing.length) for (const [id, row] of await fetchSongs(env, missing, { all: true })) facts.set(id, row);

  let saved = false;
  let attempts = 0;
  for (; attempts < 3 && !saved; attempts += 1) {
    const loaded = await loadTaste(env, accountId);
    if (!loaded.ok) break;
    if (!accepted.length && (!mode || mode === loaded.taste.mode)) return result;
    const folded = foldEvents(loaded.taste, accepted, facts, now);
    if (mode) folded.mode = mode;
    const r = await saveTaste(env, accountId, folded, loaded.taste.version, loaded.fresh);
    if (!r.ok) break;
    if (r.value) { saved = true; result.version = loaded.taste.version + 1; }
  }
  if (!saved) {
    // Recorded but not folded would be a batch that never counts: take the events out so the retry counts them.
    if (accepted.length) await db.remove(env, 'personal_events', q().eq('account_id', accountId).in('client_id', accepted.map((e) => e.id)));
    return { fail: 'unavailable' };
  }

  background(o.waitUntil, (async () => {
    // Songs the engine had not met are confirmed with the catalogue (a few per batch; the job does the rest),
    // and only confirmed songs are embedded.
    const known = await fetchSongs(env, touched.map((s) => s.id), { all: true });
    const unverified = touched.filter((s) => known.get(s.id)?.verified === false).slice(0, VERIFY_PER_BATCH);
    if (unverified.length) {
      const found = await catalogueSongs(env, unverified.map((s) => s.id), VERIFY_PER_BATCH);
      if (found.length) {
        await touchSongs(env, found, true);
        await embedSongs(env, config.embedModel, found);
      }
    }
    const verifiedKnown = touched.filter((s) => known.get(s.id)?.verified && known.get(s.id)?.embed_model !== config.embedModel);
    if (verifiedKnown.length) await embedSongs(env, config.embedModel, verifiedKnown);
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
  /** Read only when a page is built (not for a cache hit). */
  firstName?: () => Promise<string | null>;
  festival?: string | null;
  waitUntil?: WaitUntil;
  now?: number;
  config?: PersonalConfig;
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
    if (cached && (cached.events_seen === null || taste.eventsSeen - cached.events_seen < HOME_STALE_EVENTS)) {
      return { page: cached.page, cached: true, composed: cached.composed, builtMs: 0 };
    }
  }

  const started = Date.now();
  const pool = await gatherPool(env, { accountId, taste, embedModel: config.embedModel, now });
  const exposure = await loadExposure(env, accountId, [...pool.candidates.keys()]);
  const hour = typeof o.hour === 'number' ? o.hour : null;
  const scored = scorePool(pool.candidates, pool.songs, { taste, exposure, weights: config.weights, now, hour, intent: 'taste' });
  const shelves = buildShelves(scored, { taste, songs: pool.songs, now, hour, isoWeek: isoWeekOf(now) });
  if (!shelves.length) {
    background(o.waitUntil, embedSongs(env, config.embedModel, pool.fresh));
    return { fail: 'empty' };
  }

  const firstName = config.composer && o.firstName ? await o.firstName().catch(() => null) : null;
  const ctx: ComposeContext = { taste, firstName, hour, dow: typeof o.dow === 'number' ? o.dow : null, festival: o.festival ?? null };
  // The composer's whole budget, across models and the repair turn, not per model.
  const composed = config.composer
    ? await composeHome(env, shelves, ctx, AbortSignal.timeout(COMPOSE_BUDGET_MS))
    : { shelves, greeting: null, model: null, composed: false, ms: 0 };
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
    await savePage(env, accountId, 'home', page, { id: crypto.randomUUID(), tasteVersion: taste.version, eventsSeen: taste.eventsSeen, modelId: composed.model, composed: composed.composed, builtMs, expiresAt: page.expiresAt });
    // Everything on the page counts as shown once, so the next page and the other devices know.
    await db.rpc(env, 'personal_mark_shown', { p_account: accountId, p_songs: [...new Set(page.shelves.flatMap((s) => s.songs.map((x) => x.id)))] });
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
  const pool = await gatherPool(env, { accountId, taste, embedModel: config.embedModel, seed, now });
  const exposure = await loadExposure(env, accountId, [...pool.candidates.keys()]);
  const exclude = new Set(o.exclude ?? []);
  if (seed) exclude.add(seed);
  const scored = scorePool(pool.candidates, pool.songs, { taste, exposure, weights: config.weights, now, hour: o.hour ?? null, intent: seed ? 'seed' : 'taste' })
    .filter((s) => !exclude.has(s.song.id));
  const picks = rerank(scored, { limit: Math.min(50, Math.max(1, o.limit ?? 20)), artistCap: 3 });
  background(o.waitUntil, embedSongs(env, config.embedModel, pool.fresh));
  return { songs: picks.map((p) => toRecord(p.song, reasonLine(p))), seed };
}

export { MIN_SHELF };
