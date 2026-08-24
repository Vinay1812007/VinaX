import type { Song } from '@/types';

// Package A5 — a session-scoped Set of ids that survives navigating away
// from Home and back. sessionStorage is used as durable backing so a hard
// refresh clears it; a plain browser tab close also clears it (correct
// semantics — "session" is the browsing session, not forever). Cap at 400
// so localStorage doesn't creep unbounded on a heavy-browsing session.
const SESSION_KEY = 'vinax.home.deduped.v1';
const SESSION_CAP = 400;

function readSessionSet(): Set<string> {
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((s): s is string => typeof s === 'string'));
  } catch {
    return new Set();
  }
}

function writeSessionSet(seen: Set<string>): void {
  try {
    // Trim to cap by keeping the most-recently added — Sets preserve insertion order.
    const arr = [...seen];
    const trimmed = arr.length > SESSION_CAP ? arr.slice(arr.length - SESSION_CAP) : arr;
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(trimmed));
  } catch {
    /* sessionStorage disabled or full — dedup gracefully degrades to per-mount */
  }
}

/**
 * Stateful home-page de-duplicator. Call it once per shelf in display order
 * and it returns only the songs not already shown in an earlier shelf,
 * recording each id it emits. Persists across navigation via sessionStorage,
 * so leaving Home and coming back doesn't show the same songs on the
 * "Trending" and "New Releases" shelves that appeared last time (Package A5).
 * Call `resetShelfDeduper()` from the pull-to-refresh handler to start over.
 */
export function createShelfDeduper(): (songs: Song[]) => Song[] {
  const seen = readSessionSet();
  return (songs) => {
    const out: Song[] = [];
    for (const song of songs) {
      if (!song || seen.has(song.id)) continue;
      seen.add(song.id);
      out.push(song);
    }
    // Persist after every shelf's emit so an early exit still records
    // what the user actually saw.
    writeSessionSet(seen);
    return out;
  };
}

/** Wipe the session-scoped dedup memory. Called by the Home page's
 *  pull-to-refresh so the listener explicitly says "give me fresh picks". */
export function resetShelfDeduper(): void {
  try {
    window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/** Pure helper: de-dupe an ordered list of shelves against each other.
 *  Does NOT persist — this is the deterministic version used by tests. */
export function dedupeShelves(shelves: Song[][]): Song[][] {
  const seen = new Set<string>();
  return shelves.map((songs) => {
    const out: Song[] = [];
    for (const song of songs) {
      if (!song || seen.has(song.id)) continue;
      seen.add(song.id);
      out.push(song);
    }
    return out;
  });
}
