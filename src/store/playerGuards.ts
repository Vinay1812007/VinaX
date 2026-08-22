import type { Song } from '@/types';

/**
 * Pure helpers + module-scoped guards for the player store, extracted so they
 * are unit-testable and physically cannot touch playerStore internals.
 */

// ---------------------------------------------------------------------------
// Skip-loop guard: when several tracks in a row have no playable sources
// (CDN outage, stale URLs, offline), stop after 4 strikes instead of churning
// through the whole queue with endless skips and refetches.
// ---------------------------------------------------------------------------

const SKIP_GUARD_LIMIT = 4;
let consecutiveUnavailable = 0;

/** Record one unavailable track. Returns true when the guard trips (and self-resets). */
export function noteUnavailable(): boolean {
  consecutiveUnavailable += 1;
  if (consecutiveUnavailable >= SKIP_GUARD_LIMIT) {
    consecutiveUnavailable = 0;
    return true;
  }
  return false;
}

/**
 * Reset the guard ONLY on a genuine "sources are alive" signal: a track
 * actually finished, or the user manually started one. Never call this from
 * pure helpers or queue bookkeeping (DQA-01: a stray reset inside normTitle()
 * silently defeated the guard during auto-continuation).
 */
export function resetSkipGuard(): void {
  consecutiveUnavailable = 0;
}

// ---------------------------------------------------------------------------
// Queue de-dupe (pure — no side effects).
// ---------------------------------------------------------------------------

/** Normalized title key. Pure by contract: must never mutate module state. */
export function normTitle(s: Song): string {
  return (s.title || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** De-dupe by id AND normalized title — the same song often has multiple
 *  catalog ids (e.g. reordered artists), which slipped past id-only checks. */
export function dedupeSongs(songs: Song[]): Song[] {
  const ids = new Set<string>();
  const titles = new Set<string>();
  const out: Song[] = [];
  for (const s of songs) {
    const t = normTitle(s);
    if (ids.has(s.id) || (t && titles.has(t))) continue;
    ids.add(s.id);
    if (t) titles.add(t);
    out.push(s);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Persisted-state validation: localStorage can hold partial/corrupt/legacy
// data; a malformed song must never reach the render tree (DQA-03/04/06).
// ---------------------------------------------------------------------------

/** Minimal shape a persisted queue entry must have to render + play safely. */
export function isValidSong(s: unknown): s is Song {
  if (!s || typeof s !== 'object') return false;
  const o = s as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    o.id.length > 0 &&
    typeof o.title === 'string' &&
    Array.isArray(o.images) &&
    Array.isArray(o.audio) &&
    Array.isArray(o.artists)
  );
}

/** Package D5 — the queue after "clear from here down". Only future rows can
 *  be swept: `from` must sit strictly after the playing index and inside the
 *  queue. Returns null for a no-op (caller leaves state untouched). */
export function queueAfterClearFrom<T>(queue: T[], index: number, from: number): T[] | null {
  if (from <= index || from >= queue.length) return null;
  return queue.slice(0, from);
}

/**
 * Pure reorder for drag-to-rearrange: move `from` → `to` and keep the playing
 * `index` pointing at the SAME song. Null on no-ops/out-of-range so callers
 * can skip the set() entirely.
 */
export function reorderQueue<T>(
  queue: T[],
  index: number,
  from: number,
  to: number,
): { queue: T[]; index: number } | null {
  if (from === to || from < 0 || to < 0 || from >= queue.length || to >= queue.length) return null;
  const next = [...queue];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  let newIndex = index;
  if (index === from) newIndex = to;
  else if (from < index && to >= index) newIndex = index - 1;
  else if (from > index && to <= index) newIndex = index + 1;
  return { queue: next, index: newIndex };
}

// ---------------------------------------------------------------------------
// Package D5 — "Sort by" for the upcoming queue. Pure and stable: equal keys
// keep their existing order, so sorting never shuffles what it doesn't rank.
// ---------------------------------------------------------------------------
import { energyOfSong } from '@/services/personalization/session';
import { inferMood, type Mood } from '@/services/recommendation/mood';

export type QueueSortKind = 'energy' | 'calm' | 'new' | 'old' | 'mood';

// Mood clusters ordered by falling energy so a "mood" sort reads as one long
// deliberate arc instead of alphabetical noise.
const MOOD_ORDER: Record<Mood, number> = {
  energetic: 0,
  romantic: 1,
  neutral: 2,
  devotional: 3,
  chill: 4,
  melancholy: 5,
};

export function sortQueueTail(songs: Song[], kind: QueueSortKind): Song[] {
  const keyed = songs.map((s, i) => ({ s, i }));
  const yearOf = (s: Song): number => (s.year ? Number(s.year) || 0 : 0);
  keyed.sort((a, b) => {
    let d: number;
    if (kind === 'energy') d = energyOfSong(b.s) - energyOfSong(a.s);
    else if (kind === 'calm') d = energyOfSong(a.s) - energyOfSong(b.s);
    else if (kind === 'new') d = yearOf(b.s) - yearOf(a.s);
    else if (kind === 'old') d = yearOf(a.s) - yearOf(b.s);
    else d = MOOD_ORDER[inferMood(a.s)] - MOOD_ORDER[inferMood(b.s)];
    return d !== 0 ? d : a.i - b.i; // stable
  });
  return keyed.map((k) => k.s);
}
