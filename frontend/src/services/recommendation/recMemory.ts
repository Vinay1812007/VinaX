import type { Song } from '@/types';
import { songKey } from './songIdentity';

/**
 * 8.2.0 — what the next-song engine remembers about its own picks.
 * Device-local, capped, never uploaded. Two small memories:
 *
 *   outcomes    songs the engine queued AUTOMATICALLY and how they went:
 *               finished or liked = a success, skipped early = a miss. The
 *               successes become a candidate source of their own (songs like
 *               them, and — after a cooldown — the songs themselves again).
 *               Fed by the playback event bus (./transitionTracker.ts).
 *   seed memory for each seed song, the first few songs of the last
 *               continuation the player accepted after it, so asking again
 *               from the same song does not hand back the same five.
 *
 * Both live in localStorage (in memory when storage is unavailable) and read
 * the clock only through the `now` arguments' default.
 */
export const OUTCOMES_KEY = 'vinax.recs.outcomes.v1';
export const SEED_MEMORY_KEY = 'vinax.recs.seedmemo.v1';
const OUTCOME_CAP = 60;
const SEED_CAP = 40;
/** A success older than this is forgotten. */
const OUTCOME_TTL_MS = 60 * 86_400_000;
/** A proven song is offered again as itself only when it last played at least this long ago. */
export const PROVEN_COOLDOWN_MS = 3 * 86_400_000;
/** A seed's remembered continuation holds for this long. */
const SEED_TTL_MS = 12 * 3_600_000;
/** How many songs of a continuation the seed memory keeps. */
export const SEED_MEMORY_SIZE = 5;

export type AutoOutcome = 'success' | 'miss';

interface OutcomeEntry {
  /** Canonical identity (one entry per song, whichever cut played). */
  k: string;
  song: Song;
  ok: number;
  bad: number;
  /** Last time this song ended after an automatic pick. */
  at: number;
}

interface SeedEntry {
  ids: string[];
  at: number;
}

const memory = new Map<string, unknown>();

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T) ?? fallback;
  } catch {
    return (memory.get(key) as T | undefined) ?? fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    memory.set(key, value); // storage unavailable: this session still remembers
  }
}

/** Tests: forget both memories. */
export function resetRecMemory(): void {
  memory.clear();
  try {
    window.localStorage.removeItem(OUTCOMES_KEY);
    window.localStorage.removeItem(SEED_MEMORY_KEY);
  } catch {
    /* ignore */
  }
}

function loadOutcomes(now: number): OutcomeEntry[] {
  const raw = read<unknown>(OUTCOMES_KEY, []);
  if (!Array.isArray(raw)) return [];
  return raw.filter((e): e is OutcomeEntry =>
    !!e && typeof e.k === 'string' && !!e.song?.id && Array.isArray(e.song.artists) && Number.isFinite(e.ok) && Number.isFinite(e.bad) && Number.isFinite(e.at) && now - e.at < OUTCOME_TTL_MS);
}

/** Record how an automatically queued song went. */
export function recordAutoOutcome(song: Song, outcome: AutoOutcome, now = Date.now()): void {
  if (!song?.id || !Array.isArray(song.artists)) return;
  const k = songKey(song);
  const list = loadOutcomes(now);
  const at = list.findIndex((e) => e.k === k);
  const prev = at >= 0 ? list.splice(at, 1)[0] : { k, song, ok: 0, bad: 0, at: now };
  // Kept small: one artwork size is enough to show it in a queue again.
  const slim: Song = { ...song, images: Array.isArray(song.images) ? song.images.slice(-1) : [] };
  const next: OutcomeEntry = { ...prev, song: slim, at: now, ok: prev.ok + (outcome === 'success' ? 1 : 0), bad: prev.bad + (outcome === 'miss' ? 1 : 0) };
  write(OUTCOMES_KEY, [next, ...list].slice(0, OUTCOME_CAP));
}

export interface ProvenPick {
  song: Song;
  /** Successes minus misses (≥ 1). */
  net: number;
  /** When it last ended after an automatic pick. */
  at: number;
}

/**
 * Past automatic picks that worked: more successes than misses, strongest
 * and most recent first. `cooledOnly` keeps only those that have not played
 * for PROVEN_COOLDOWN_MS (to be offered again as themselves).
 */
export function provenPicks(options: { now?: number; cooledOnly?: boolean; limit?: number } = {}): ProvenPick[] {
  const now = options.now ?? Date.now();
  return loadOutcomes(now)
    .filter((e) => e.ok > e.bad && (!options.cooledOnly || now - e.at >= PROVEN_COOLDOWN_MS))
    .map((e) => ({ song: e.song, net: e.ok - e.bad, at: e.at }))
    .sort((a, b) => b.net - a.net || b.at - a.at)
    .slice(0, options.limit ?? OUTCOME_CAP);
}

function seedKeyOf(seed: Song): string {
  return songKey(seed) || seed.id;
}

function loadSeeds(now: number): Record<string, SeedEntry> {
  const raw = read<unknown>(SEED_MEMORY_KEY, {});
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, SeedEntry> = {};
  for (const [k, e] of Object.entries(raw as Record<string, SeedEntry>)) {
    if (e && Array.isArray(e.ids) && Number.isFinite(e.at) && now - e.at < SEED_TTL_MS) out[k] = { ids: e.ids.filter((id) => typeof id === 'string'), at: e.at };
  }
  return out;
}

/**
 * Remember the opening of the continuation the player accepted after `seed`.
 *
 * 9.1.0 — stored as CANONICAL KEYS, not catalogue ids. With ids, asking again
 * from the same song could hand back the same opening under a different
 * release of each song (the film cut, the remaster, the lofi flip all have
 * their own id), which is exactly the repeat this memory exists to prevent.
 */
export function rememberSeedContinuation(seed: Song, songs: readonly Song[], now = Date.now()): void {
  if (!seed?.id || !songs.length) return;
  const seeds = loadSeeds(now);
  seeds[seedKeyOf(seed)] = { ids: songs.slice(0, SEED_MEMORY_SIZE).map((s) => songKey(s)).filter((k) => k && k !== '|'), at: now };
  const kept = Object.entries(seeds).sort((a, b) => b[1].at - a[1].at).slice(0, SEED_CAP);
  write(SEED_MEMORY_KEY, Object.fromEntries(kept));
}

/**
 * The canonical keys the last accepted continuation after `seed` opened with
 * (empty when none is remembered).
 *
 * A device written by 9.0 or earlier holds catalogue ids here. They simply
 * never match a key, so the memory is empty for that seed until the next
 * continuation is accepted — no migration needed, and nothing breaks.
 */
export function lastSeedContinuation(seed: Song, now = Date.now()): Set<string> {
  if (!seed?.id) return new Set();
  return new Set(loadSeeds(now)[seedKeyOf(seed)]?.ids ?? []);
}
