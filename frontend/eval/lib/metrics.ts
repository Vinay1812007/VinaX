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
  /** 8.1.0 — language-opening / language-run breaks the engine reported as its own `language-mix` give-way (nothing in the queue language was left). */
  languageMixExcused: number;
  latency: { p50: number; p95: number; max: number; samples: number };
  /**
   * 8.3.0 — style continuity, over the continuations of fixtures that are in
   * a style (a DJ-remix or a folk sitting): the mean share of each
   * continuation in that style, and how many held four of five (⌈0.8 n⌉)
   * while the pool still had that many. null when no fixture has a style.
   */
  style: { batches: number; share: number; heldBatches: number; heldOpportunities: number; held: number } | null;
  /** 9.0.0 — songs only an album page or an artist page could supply, and their share of all songs queued. */
  retrieval: { deepShipped: number; deepShare: number };
  /**
   * 9.0.0 — agreement with each fixture's DECLARED taste (the share of queued
   * songs in it), over fixtures that declare one. A measure of whether the
   * taste signals are used, not of anyone's enjoyment. null when none declares one.
   */
  taste: { batches: number; agreement: number } | null;
  /** 9.0.0 — songs by an artist this sitting pushed away (two skips or more), in continuations where another lead was eligible. */
  sittingAvoided: { shipped: number; batches: number };
  /** 9.0.0 — songs another surface showed this week, queued anyway (null when no fixture records any). */
  served: { batches: number; shipped: number; share: number } | null;
}

const MIX_KINDS = ['language-opening', 'language-run'] as const;
const mixBreaks = (v: Violations): number => v['language-opening'] + v['language-run'];

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
  let mixExcused = 0;
  for (const b of batches) {
    addViolations(violations, b.violations);
    // 8.1.0 — the mix rules give way only when the engine says nothing in the
    // queue language was left; that batch is excused its opening/run breaks.
    const mixStarved = b.relaxed.includes('language-mix');
    if (mixStarved) mixExcused += mixBreaks(b.violations);
    // Each order is excused its own off-language songs when the lock was starved.
    queueReadyHard += totalViolations(b.violationsQueueReady, ['off-language', ...MIX_KINDS]) + (b.lockStarved ? 0 : b.violationsQueueReady['off-language']) + (mixStarved ? 0 : mixBreaks(b.violationsQueueReady));
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
  const styled = batches.filter((b) => b.inStyle !== null && b.n > 0);
  const styleChances = styled.filter((b) => (b.styleAvailable ?? 0) >= Math.ceil(0.8 * b.n));
  const heldBatches = styleChances.filter((b) => (b.inStyle ?? 0) >= Math.ceil(0.8 * b.n)).length;
  const offLanguageUnexcused = Math.max(0, violations['off-language'] - excused);
  const mixUnexcused = Math.max(0, mixBreaks(violations) - mixExcused);
  const hard = totalViolations(violations, ['off-language', ...MIX_KINDS]) + offLanguageUnexcused + mixUnexcused;
  return {
    sessions: sessions.length,
    batches: batches.length,
    songs,
    emptyBatches: batches.filter((b) => b.n === 0).length,
    timedOutBatches: batches.filter((b) => b.timedOut).length,
    violations: { ...violations, 'off-language': offLanguageUnexcused },
    hardViolations: hard,
    offLanguageExcused: excused,
    languageMixExcused: mixExcused,
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
    retrieval: { deepShipped: batches.reduce((n, b) => n + (b.deepShipped ?? 0), 0), deepShare: songs ? round(batches.reduce((n, b) => n + (b.deepShipped ?? 0), 0) / songs) : 0 },
    taste: (() => {
      const t = batches.filter((b) => b.tasteHits !== null && b.tasteHits !== undefined && b.n > 0);
      return t.length ? { batches: t.length, agreement: mean(t.map((b) => (b.tasteHits as number) / b.n)) } : null;
    })(),
    sittingAvoided: (() => {
      const a = batches.filter((b) => b.avoidedAvoidable);
      return { shipped: a.reduce((n, b) => n + b.avoidedShipped, 0), batches: a.length };
    })(),
    served: (() => {
      const sv = batches.filter((b) => b.servedShipped !== null && b.servedShipped !== undefined && b.n > 0);
      const shipped = sv.reduce((n, b) => n + (b.servedShipped as number), 0);
      const total = sv.reduce((n, b) => n + b.n, 0);
      return sv.length ? { batches: sv.length, shipped, share: total ? round(shipped / total) : 0 } : null;
    })(),
    style: styled.length
      ? { batches: styled.length, share: mean(styled.map((b) => (b.inStyle ?? 0) / b.n)), heldBatches, heldOpportunities: styleChances.length, held: styleChances.length ? round(heldBatches / styleChances.length) : 1 }
      : null,
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
