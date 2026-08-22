import type { HistoryEntry, Song } from '@/types';

/**
 * On-device item similarity from CO-PLAY (roadmap O.3): artists this listener
 * actually plays together in the same sitting pull each other's songs up in
 * radio and auto-queue. Pure local history in, numbers out — no server, no
 * cohorts, nothing uploaded (the founding invariant).
 *
 * Sessions = runs of plays separated by ≤30-minute gaps. Within a session,
 * every unordered artist pair earns a count. Affinity between two songs is
 * the strongest pair count between their artists, log-dampened and
 * normalized against the index's own maximum — so one binge doesn't dominate
 * and a young history still produces sane 0..1 values.
 */

const SESSION_GAP_MS = 30 * 60_000;
/** Bound the per-session pair explosion (O(n²) on session length). */
const SESSION_CAP = 25;

export interface CoPlayIndex {
  /** Damped co-play strength for an unordered artist-key pair. */
  get(a: string, b: string): number;
  /** Highest damped count in the index (normalization base). */
  max: number;
  /** Distinct artist pairs indexed — 0 means "no signal yet". */
  size: number;
}

function artistKeys(song: Song): string[] {
  return (song.artists ?? [])
    .slice(0, 2)
    .map((a) => (a?.name ?? '').trim().toLowerCase())
    .filter((n) => n.length > 1);
}

const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

export function buildCoPlayIndex(entries: HistoryEntry[]): CoPlayIndex {
  // History is stored newest-first; walk oldest-first so gaps split forward.
  const ordered = [...entries].reverse();
  const counts = new Map<string, number>();
  let session: string[][] = [];
  let lastTs: number | null = null;

  const flush = (): void => {
    const artists = session.slice(-SESSION_CAP);
    // Distinct artists in the session, then all unordered pairs.
    const uniq = [...new Set(artists.flat())];
    for (let i = 0; i < uniq.length; i++) {
      for (let j = i + 1; j < uniq.length; j++) {
        const k = pairKey(uniq[i], uniq[j]);
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
    }
    session = [];
  };

  for (const e of ordered) {
    if (lastTs !== null && e.ts - lastTs > SESSION_GAP_MS) flush();
    lastTs = e.ts;
    const keys = artistKeys(e.song);
    if (keys.length) session.push(keys);
  }
  flush();

  let max = 0;
  const damped = new Map<string, number>();
  for (const [k, n] of counts) {
    const d = Math.log2(1 + n);
    damped.set(k, d);
    if (d > max) max = d;
  }
  return {
    get: (a, b) => damped.get(pairKey(a, b)) ?? 0,
    max,
    size: damped.size,
  };
}

/** 0..1 — how strongly `candidate` co-plays with `seed` for THIS listener. */
export function coPlayAffinity(index: CoPlayIndex, seed: Song, candidate: Song): number {
  if (!index.max || !index.size) return 0;
  const seedKeys = artistKeys(seed);
  const candKeys = artistKeys(candidate);
  if (!seedKeys.length || !candKeys.length) return 0;
  let best = 0;
  for (const s of seedKeys) {
    for (const c of candKeys) {
      if (s === c) continue; // same artist is the 'artist' signal, not co-play
      const v = index.get(s, c);
      if (v > best) best = v;
    }
  }
  return best / index.max;
}

// One radio session calls the scorer dozens of times over the same history —
// memoize the index on the history's identity (newest ts + length).
let cacheKey = '';
let cacheVal: CoPlayIndex | null = null;

export function coPlayIndexFor(entries: HistoryEntry[]): CoPlayIndex {
  const key = `${entries[0]?.ts ?? 0}|${entries.length}`;
  if (key !== cacheKey || !cacheVal) {
    cacheKey = key;
    cacheVal = buildCoPlayIndex(entries);
  }
  return cacheVal;
}
