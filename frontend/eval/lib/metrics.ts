import { addViolations, noViolations, totalViolations, VIOLATION_KINDS, type Violations } from './rules';
import type { BatchRecord, SessionRecord } from './run';

/** Nearest-rank percentile over a copy of the values (0 for an empty list). */
export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return round(sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]);
}

export const round = (n: number, places = 3): number => Math.round(n * 10 ** places) / 10 ** places;
const mean = (values: number[]): number => (values.length ? round(values.reduce((a, b) => a + b, 0) / values.length) : 0);
const count = <T extends string>(values: T[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
};

export interface Summary {
  /** How many sittings and continuations these numbers come from. */
  sessions: number;
  batches: number;
  songs: number;
  emptyBatches: number;
  timedOutBatches: number;
  /** Songs that broke a rule that never bends. Must be zero. */
  violations: Violations;
  hardViolations: number;
  /** Off-language songs under a lock the pipeline was allowed to relax. */
  offLanguageExcused: number;
  /** Rule breaks in the order that was queued first (before any AI refinement). */
  queueReadyHardViolations: number;
  repetition: {
    sameLeadBackToBack: number;
    /** Of those, the ones where another lead artist was still eligible for that batch. */
    sameLeadBackToBackAvoidable: number;
    sameLeadAtBatchBoundary: number;
    sameLeadWithinThree: number;
    sameIdentityBackToBack: number;
    repeatedIdentity: number;
  };
  coverage: {
    distinctArtistsPerBatch: number;
    distinctArtistShareInSession: number;
  };
  discovery: {
    share: number;
    /** The pipeline's own definition, where it publishes one (null for the baseline). */
    engineShare: number | null;
    allocation: number;
    overAllocatedBatches: number;
  };
  familiarFirst: {
    opportunities: number;
    slot1Misses: number;
    slot2Misses: number;
    compliance: number;
  };
  pickers: Record<string, number>;
  fallbacks: Record<string, number>;
  refinements: Record<string, number>;
  relaxed: Record<string, number>;
  aiSongsShipped: number;
  latency: { p50: number; p95: number; max: number; samples: number };
}

function summariseBatches(sessions: SessionRecord[]): Summary {
  const batches: BatchRecord[] = sessions.flatMap((s) => s.batches);
  const violations = noViolations();
  let queueReadyHard = 0;
  let excused = 0;
  let opportunities = 0;
  let slot1 = 0;
  let slot2 = 0;
  let over = 0;
  const relaxed: Record<string, number> = {};
  for (const b of batches) {
    addViolations(violations, b.violations);
    // Each order is excused its own off-language songs when the lock was starved.
    queueReadyHard += totalViolations(b.violationsQueueReady, ['off-language']) + (b.lockStarved ? 0 : b.violationsQueueReady['off-language']);
    excused += b.offLanguageExcused;
    if (b.familiarAvailable > 0 && b.n > 0) {
      opportunities += 1;
      if (b.slot1Discovery) slot1 += 1;
      if (b.slot2Discovery) slot2 += 1;
    }
    if (b.discovery > b.discoveryCap && b.familiarAvailable >= b.n) over += 1;
    for (const r of b.relaxed) relaxed[r] = (relaxed[r] ?? 0) + 1;
  }
  const songs = batches.reduce((n, b) => n + b.n, 0);
  const offLanguageUnexcused = Math.max(0, violations['off-language'] - excused);
  const hard = totalViolations(violations, ['off-language']) + offLanguageUnexcused;
  return {
    sessions: sessions.length,
    batches: batches.length,
    songs,
    emptyBatches: batches.filter((b) => b.n === 0).length,
    timedOutBatches: batches.filter((b) => b.timedOut).length,
    violations: { ...violations, 'off-language': offLanguageUnexcused },
    hardViolations: hard,
    offLanguageExcused: excused,
    queueReadyHardViolations: queueReadyHard,
    repetition: {
      sameLeadBackToBack: sessions.reduce((n, s) => n + s.sameLeadBackToBack, 0),
      sameLeadBackToBackAvoidable: sessions.reduce((n, s) => n + s.sameLeadBackToBackAvoidable, 0),
      sameLeadAtBatchBoundary: sessions.reduce((n, s) => n + s.sameLeadAtBatchBoundary, 0),
      sameLeadWithinThree: sessions.reduce((n, s) => n + s.sameLeadWithinThree, 0),
      sameIdentityBackToBack: sessions.reduce((n, s) => n + s.sameIdentityBackToBack, 0),
      repeatedIdentity: sessions.reduce((n, s) => n + s.repeatedIdentity, 0),
    },
    coverage: {
      distinctArtistsPerBatch: mean(batches.filter((b) => b.n > 0).map((b) => b.distinctArtists)),
      distinctArtistShareInSession: mean(sessions.filter((s) => s.songsInSession > 0).map((s) => s.distinctArtistsInSession / s.songsInSession)),
    },
    discovery: {
      share: mean(batches.filter((b) => b.n > 0).map((b) => b.discovery / b.n)),
      engineShare: batches.some((b) => b.engineDiscovery !== null) ? mean(batches.filter((b) => b.n > 0 && b.engineDiscovery !== null).map((b) => (b.engineDiscovery as number) / b.n)) : null,
      allocation: mean(batches.filter((b) => b.n > 0).map((b) => b.discoveryCap / b.n)),
      overAllocatedBatches: over,
    },
    familiarFirst: {
      opportunities,
      slot1Misses: slot1,
      slot2Misses: slot2,
      compliance: opportunities ? round((opportunities - slot1) / opportunities) : 1,
    },
    pickers: count(batches.map((b) => b.picker)),
    fallbacks: count(batches.map((b) => b.fallback ?? 'none')),
    refinements: count(batches.map((b) => b.refinement)),
    relaxed,
    aiSongsShipped: batches.reduce((n, b) => n + b.aiSongsShipped, 0),
    latency: {
      p50: percentile(batches.map((b) => b.queueReadyMs), 50),
      p95: percentile(batches.map((b) => b.queueReadyMs), 95),
      max: round(Math.max(0, ...batches.map((b) => b.queueReadyMs))),
      samples: batches.length,
    },
  };
}

export interface QualityReport {
  overall: Summary;
  perFixture: Record<string, Summary & { title: string }>;
}

export function summarise(sessions: SessionRecord[], titles: Record<string, string>): QualityReport {
  const byFixture = new Map<string, SessionRecord[]>();
  for (const s of sessions) byFixture.set(s.fixture, [...(byFixture.get(s.fixture) ?? []), s]);
  const perFixture: QualityReport['perFixture'] = {};
  for (const [fixture, list] of byFixture) perFixture[fixture] = { title: titles[fixture] ?? fixture, ...summariseBatches(list) };
  return { overall: summariseBatches(sessions), perFixture };
}

export { VIOLATION_KINDS };
