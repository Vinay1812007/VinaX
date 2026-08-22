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
