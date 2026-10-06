import type { DebugBatch } from '@/store/recsDebugStore';
import { songKey } from '@/services/recommendation/songKey';

/**
 * 9.1.0 — the owner diagnostics summary: the numbers that answer "why does this
 * keep repeating?" without reading every batch by hand.
 *
 * Pure, so it can be tested without a browser, and computed from what the engine
 * already publishes to the recs-debug feed (./RecsDebugPanel.tsx shows it). The
 * live SOURCE HEALTH half comes from /api/trends and is
 * fetched by the panel, not here — it is about the server, not this device.
 */

export interface RepeatRates {
  batches: number;
  songs: number;
  /**
   * Share of songs in a batch that the PREVIOUS batch already had, by canonical
   * identity. This is the number the 9.1 repetition work exists to move: on the
   * offline fixture it was 0.67 before and 0.05 after.
   */
  batchOverlap: number;
  /** Share of songs that appeared in ANY earlier batch of this session. */
  sessionRepeat: number;
  /** Distinct lead artists per batch, averaged. */
  artistsPerBatch: number;
  /** The largest share one lead artist took of a single batch. */
  worstArtistShare: number;
}

export interface Diagnostics {
  repeats: RepeatRates;
  /** Candidates contributed per source, newest batch first, summed. */
  sources: Array<{ source: string; count: number }>;
  /** How often each fallback reason came up (an AI order that was not used). */
  fallbacks: Array<{ reason: string; count: number }>;
  /** Which soft rules had to give, and how often. */
  relaxed: Array<{ rule: string; count: number }>;
  /** Hard-filter rejections by rule — where a thin pool actually went. */
  rejections: Array<{ reason: string; count: number }>;
  latency: { p50: number; p95: number; max: number; samples: number };
  pickers: { local: number; ai: number };
}

const EMPTY: Diagnostics = {
  repeats: { batches: 0, songs: 0, batchOverlap: 0, sessionRepeat: 0, artistsPerBatch: 0, worstArtistShare: 0 },
  sources: [],
  fallbacks: [],
  relaxed: [],
  rejections: [],
  latency: { p50: 0, p95: 0, max: 0, samples: 0 },
  pickers: { local: 0, ai: 0 },
};

const lead = (song: { artists?: Array<{ name?: string }>; subtitle?: string }): string =>
  (song.artists?.[0]?.name ?? song.subtitle?.split(',')[0] ?? '').trim().toLowerCase();

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const at = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[at];
}

const tally = (counts: Map<string, number>): Array<{ source: string; count: number }> =>
  [...counts.entries()].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count);

/**
 * Summarise the recorded batches. `batches` arrives NEWEST FIRST (the store
 * unshifts), so the comparisons below walk it in reverse to read it in the order
 * the listener actually heard.
 */
export function summarise(batches: readonly DebugBatch[]): Diagnostics {
  if (!batches.length) return EMPTY;
  const chronological = [...batches].reverse();
  const sources = new Map<string, number>();
  const fallbacks = new Map<string, number>();
  const relaxed = new Map<string, number>();
  const rejections = new Map<string, number>();
  const latencies: number[] = [];
  let local = 0;
  let ai = 0;

  let songs = 0;
  let overlapWithPrevious = 0;
  let comparableSongs = 0;
  let repeatedInSession = 0;
  let artistSum = 0;
  let worstArtistShare = 0;
  const seen = new Set<string>();
  let previous: Set<string> | null = null;

  for (const batch of chronological) {
    const keys = batch.rows.map((r) => songKey(r.song));
    songs += keys.length;
    if (previous) {
      comparableSongs += keys.length;
      for (const k of keys) if (previous.has(k)) overlapWithPrevious += 1;
    }
    for (const k of keys) {
      if (seen.has(k)) repeatedInSession += 1;
      seen.add(k);
    }
    const leads = new Map<string, number>();
    for (const r of batch.rows) {
      const name = lead(r.song);
      if (name) leads.set(name, (leads.get(name) ?? 0) + 1);
      if (r.picker === 'ai') ai += 1;
      else local += 1;
    }
    artistSum += leads.size;
    if (keys.length) worstArtistShare = Math.max(worstArtistShare, Math.max(0, ...leads.values()) / keys.length);
    previous = new Set(keys);

    const trace = batch.trace;
    if (trace) {
      for (const [source, count] of Object.entries(trace.sources ?? {})) sources.set(source, (sources.get(source) ?? 0) + count);
      if (trace.fallback) fallbacks.set(trace.fallback, (fallbacks.get(trace.fallback) ?? 0) + 1);
      for (const rule of trace.relaxed) relaxed.set(rule, (relaxed.get(rule) ?? 0) + 1);
      if (typeof trace.latencyMs === 'number') latencies.push(trace.latencyMs);
    }
    for (const r of batch.rejected) rejections.set(r.reason, (rejections.get(r.reason) ?? 0) + 1);
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  return {
    repeats: {
      batches: chronological.length,
      songs,
      batchOverlap: comparableSongs ? overlapWithPrevious / comparableSongs : 0,
      sessionRepeat: songs ? repeatedInSession / songs : 0,
      artistsPerBatch: chronological.length ? artistSum / chronological.length : 0,
      worstArtistShare,
    },
    sources: tally(sources),
    fallbacks: tally(fallbacks).map(({ source, count }) => ({ reason: source, count })),
    relaxed: tally(relaxed).map(({ source, count }) => ({ rule: source, count })),
    rejections: tally(rejections).map(({ source, count }) => ({ reason: source, count })),
    latency: { p50: percentile(sorted, 50), p95: percentile(sorted, 95), max: sorted.length ? sorted[sorted.length - 1] : 0, samples: sorted.length },
    pickers: { local, ai },
  };
}

export const pct = (n: number): string => `${Math.round(n * 100)}%`;
