import type { Song } from '@/types';
import { songKey } from './songIdentity';

/**
 * v6.3.0 — transition memory: what this listener did right AFTER a song.
 *
 * The co-play index knows which artists share a sitting; this knows which
 * HAND-OFFS worked. Every time song B follows song A, the outcome of B
 * (completed, or skipped inside its first third) is stored against the pair
 * A → B and, more coarsely, against the artist pair, so the sequencer can
 * prefer hand-offs the listener accepted and avoid ones they rejected.
 * Device-local, capped, decayed; never uploaded.
 */
export const TRANSITIONS_KEY = 'vinax.transitions.v1';
const PAIR_CAP = 600;
const ARTIST_CAP = 400;
/** A memory older than this counts for half. */
const HALF_LIFE_MS = 45 * 86_400_000;

export type TransitionOutcome = 'completed' | 'skipped';

interface Tally {
  ok: number;
  bad: number;
  at: number;
}

interface Store {
  pairs: Record<string, Tally>;
  artists: Record<string, Tally>;
}

const artistOf = (s: Song): string => (s.artists[0]?.name ?? s.subtitle.split(',')[0] ?? '').trim().toLowerCase();
const pairId = (a: Song, b: Song): string => `${songKey(a)}>${songKey(b)}`;
const artistPairId = (a: Song, b: Song): string => `${artistOf(a)}>${artistOf(b)}`;

let cache: Store | null = null;

function load(): Store {
  if (cache) return cache;
  try {
    const raw = JSON.parse(window.localStorage.getItem(TRANSITIONS_KEY) || 'null') as Partial<Store> | null;
    cache = { pairs: raw && typeof raw.pairs === 'object' && raw.pairs ? raw.pairs : {}, artists: raw && typeof raw.artists === 'object' && raw.artists ? raw.artists : {} };
  } catch {
    cache = { pairs: {}, artists: {} };
  }
  return cache;
}

function save(store: Store): void {
  cache = store;
  try {
    window.localStorage.setItem(TRANSITIONS_KEY, JSON.stringify(store));
  } catch {
    /* storage is optional */
  }
}

function trim(table: Record<string, Tally>, cap: number): Record<string, Tally> {
  const keys = Object.keys(table);
  if (keys.length <= cap) return table;
  const keep = keys.sort((x, y) => table[y].at - table[x].at).slice(0, cap);
  return Object.fromEntries(keep.map((k) => [k, table[k]]));
}

/** Test hook. */
export function resetTransitionMemory(): void {
  cache = null;
  try {
    window.localStorage.removeItem(TRANSITIONS_KEY);
  } catch {
    /* ignore */
  }
}

export function recordTransition(prev: Song, next: Song, outcome: TransitionOutcome, now = Date.now()): void {
  if (!prev?.id || !next?.id || prev.id === next.id) return;
  const store = load();
  const bump = (table: Record<string, Tally>, id: string): void => {
    const t = table[id] ?? { ok: 0, bad: 0, at: now };
    if (outcome === 'completed') t.ok += 1;
    else t.bad += 1;
    t.at = now;
    table[id] = t;
  };
  bump(store.pairs, pairId(prev, next));
  if (artistOf(prev) && artistOf(next)) bump(store.artists, artistPairId(prev, next));
  save({ pairs: trim(store.pairs, PAIR_CAP), artists: trim(store.artists, ARTIST_CAP) });
}

function score(t: Tally | undefined, now: number): number {
  if (!t) return 0;
  const n = t.ok + t.bad;
  if (!n) return 0;
  const decay = Math.pow(0.5, Math.max(0, now - t.at) / HALF_LIFE_MS);
  // Wilson-ish shrinkage: a single observation counts less than a pattern.
  const confidence = n / (n + 2);
  return ((t.ok - t.bad) / n) * confidence * decay;
}

/**
 * -1..1 — how well `next` has historically followed `prev` for this listener.
 * The exact song pair dominates; the artist pair is a softer fallback.
 */
export function transitionScore(prev: Song | null | undefined, next: Song, now = Date.now()): number {
  if (!prev) return 0;
  const store = load();
  const exact = score(store.pairs[pairId(prev, next)], now);
  const artist = artistOf(prev) && artistOf(next) ? score(store.artists[artistPairId(prev, next)], now) : 0;
  return Math.max(-1, Math.min(1, exact * 0.8 + artist * 0.4));
}

/** How many hand-offs are remembered (for the Stats / debug surfaces). */
export function transitionMemorySize(): { pairs: number; artists: number } {
  const s = load();
  return { pairs: Object.keys(s.pairs).length, artists: Object.keys(s.artists).length };
}
