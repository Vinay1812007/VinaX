import { useState, useSyncExternalStore } from 'react';
import { loadProfile } from '@/services/personalization/storage';

/**
 * 9.0.0 — when Home builds itself again.
 *
 * Every Home query that DESIGNS or ROTATES content (the AI-designed shelves,
 * Made For You, the trending / new / popular rotations, the endless feed)
 * carries the Home GENERATION in its key, and caches for HOME_TTL_MS. The
 * generation moves only:
 *
 *   - on an explicit refresh (pull to refresh, "Refresh"): `refreshHome()`;
 *   - when Home opens and the generation is older than HOME_TTL_MS (expiry).
 *
 * It never moves while the listener is on Home, so shelves do not jump while
 * they browse. Returning to Home inside the window is a cache hit: no design
 * call, no catalogue rotation, the same shelves. A new query key keeps the old
 * shelves on screen while the new ones load (`keepPreviousData`), and the
 * query cancels the request of a key it has left, so an older answer can never
 * replace newer preferences (each answer lands under its own key).
 *
 * Preferences that change WHAT should be built (pinned and muted languages,
 * the discovery mode and round, recommendation intensity, the AI-shelves
 * switch) are in each query's own key and rebuild that query at once. Safety
 * settings (Kid mode, muted languages, hidden songs and artists, "Less like
 * this", the blocklist) never rebuild anything: they filter every shelf when
 * it renders (./useShelfSafety.ts), cached shelves included.
 *
 * Before 9.0 the AI shelves used a random nonce per mount with no stale time,
 * so every visit to Home paid for a new design; Made For You froze the profile
 * stamp per mount, so returning after any play rebuilt the whole pipeline.
 */
export const HOME_TTL_MS = 30 * 60_000;

interface Generation {
  gen: number;
  startedAt: number;
}

let current: Generation = { gen: 1, startedAt: Date.now() };
const listeners = new Set<() => void>();

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const snapshot = (): number => current.gen;

export function homeGeneration(): Readonly<Generation> {
  return current;
}

const notify = (): void => {
  for (const l of listeners) l();
};

/** Start a new generation: every generation-keyed Home query builds again. */
export function refreshHome(now = Date.now()): number {
  current = { gen: current.gen + 1, startedAt: now };
  notify();
  return current.gen;
}

/**
 * Called when Home opens (during its first render): a generation older than
 * HOME_TTL_MS expires. Subscribers hear about it after the render, never
 * during it; the page itself reads the new generation straight away.
 */
export function expireHomeIfStale(now = Date.now()): number {
  if (now - current.startedAt >= HOME_TTL_MS) {
    current = { gen: current.gen + 1, startedAt: now };
    queueMicrotask(notify);
  }
  return current.gen;
}

/** Tests: back to the first generation, started at `now`. */
export function resetHomeGeneration(now = Date.now()): void {
  current = { gen: 1, startedAt: now };
}

/** The page: check expiry once per Home visit, then follow the generation. */
export function useHomeVisit(): number {
  useState(() => expireHomeIfStale());
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** A Home query: follow the generation (it only moves on refresh or a new visit). */
export function useHomeGeneration(): number {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/**
 * The taste a Home build reads, coarsely: five more plays, a new like or
 * dislike, a skip streak's worth of skips or a new "Less like this" changes
 * it; a single play does not. Read once per Home visit (the caller freezes
 * it), so a song finishing while the listener browses changes nothing on
 * screen; it counts at the next visit.
 */
export function tasteStamp(): string {
  const p = loadProfile();
  const t = p.totals;
  const mutes = Object.keys(p.softMuted ?? {}).length;
  return [Math.floor(t.plays / 5), t.favorites, Math.floor(t.skips / 3), t.dislikes ?? 0, mutes].join('-');
}
