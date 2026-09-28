import { expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * The offline evaluation of next-song selection.
 *
 * It runs the REAL pipeline — whatever `@/services/recommendation/engine`
 * exports in the tree this config points at — against versioned fixtures,
 * with only the network-facing modules replaced (see eval/lib/mocks.ts). The
 * same file runs the current pipeline and the frozen baseline: the baseline
 * has no `planNextSongs`, so the harness falls back to `recommendNextSongs`.
 *
 * What it measures: rule compliance, diversity mechanics, fallback behaviour
 * and latency. What it cannot measure: whether anyone enjoys the songs.
 *
 *   npx vitest run --config eval/vitest.config.ts     (or: node scripts/eval-recs.mjs)
 */
vi.mock('@/services/api', async () => (await import('./lib/mocks')).apiMock);
vi.mock('@/services/ai/recommendations', async () => (await import('./lib/mocks')).recommendationsMock);
vi.mock('@/services/ai/dj', async () => (await import('./lib/mocks')).djMock);
vi.mock('@/services/queryClient', async () => (await import('./lib/mocks')).queryClientMock);
vi.mock('@/services/ai/embeddings', async () => (await import('./lib/mocks')).embeddingsMock);

import * as engineModule from '@/services/recommendation/engine';
import * as candidatesModule from '@/services/recommendation/candidates';
import { songKey } from '@/services/recommendation/songIdentity';
import { resetTransitionMemory } from '@/services/recommendation/transitions';
import { artistKey, useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { buildFixtures, EVAL_FIXTURES_VERSION, largePoolFixture, latencyFixture, type EvalFixture } from './fixtures';
import { armFixture, planOnce, runSession, LIMIT, type EngineLike, type SessionRecord } from './lib/run';
import { percentile, round, summarise } from './lib/metrics';

/** Bump when the harness changes what it measures. */
export const EVAL_HARNESS_VERSION = '1.0.0';

/** One fixed instant. Fixtures never read the clock; the harness hands them this. */
const NOW = 1_800_000_000_000;
const SALTS = Math.max(1, Number(process.env.EVAL_SALTS ?? 12));
const LATENCY_RUNS = Math.max(1, Number(process.env.EVAL_LATENCY_RUNS ?? 8));
const PIPELINE = process.env.EVAL_PIPELINE ?? 'current';
const OUT = process.env.EVAL_OUT ?? resolve(process.cwd(), `eval/reports/${PIPELINE}.json`);
/** A never-settling source has to be cut off somewhere: the baseline has no deadline of its own. */
const LATENCY_CAP_MS = Math.max(2_000, Number(process.env.EVAL_LATENCY_CAP_MS ?? 12_000));

const engine = engineModule as unknown as EngineLike;
const ENTRY = typeof engine.planNextSongs === 'function' ? 'planNextSongs' : 'recommendNextSongs';

/** 7.2 caches provider responses for three minutes; a fixture must never inherit another fixture's pool. */
const resetCandidateCache = (candidatesModule as { resetCandidateCache?: () => void }).resetCandidateCache;

function applyFixture(fixture: EvalFixture): void {
  localStorage.clear();
  sessionStorage.clear();
  resetTransitionMemory();
  resetCandidateCache?.();
  useSettingsStore.setState({
    kidMode: fixture.kidMode,
    aiDj: fixture.ai.mode === 'dj',
    aiAssist: true,
    djVoice: false,
    mutedLanguages: fixture.mutedLanguages,
    pinnedLanguages: fixture.pinnedLanguages,
    // 8.1.0 — absent = the seed's language only (what every engine before 8.1 does).
    ...(fixture.queueLanguages ? { queueLanguages: fixture.queueLanguages } : {}),
    discoveryMode: fixture.discoveryMode,
    recommendationIntensity: 0.7,
    autoplay: true,
  } as never);
  useLibraryStore.setState({
    hiddenSongIds: fixture.hiddenSongIds,
    hiddenArtists: fixture.hiddenArtists.map((name) => artistKey(name)),
    favorites: fixture.favorites,
  } as never);
}

function buildContext(fixture: EvalFixture, salt: number): unknown {
  return {
    profile: fixture.profile,
    hour: 20,
    dayOfWeek: 5,
    region: null,
    pinnedLanguages: fixture.pinnedLanguages,
    // 8.1.0 — absent = the seed's language only (what every engine before 8.1 does).
    ...(fixture.queueLanguages ? { queueLanguages: fixture.queueLanguages } : {}),
    mutedLanguages: fixture.mutedLanguages,
    intensity: 0.7,
    favorites: fixture.favorites,
    history: fixture.history,
    salt,
    explore: fixture.discoveryMode === 'discover',
    discoveryMode: fixture.discoveryMode,
    sessionIntent: fixture.sessionIntent,
    surface: 'playlist',
  };
}

const env = {
  now: NOW,
  songKey,
  applyFixture,
  buildContext: (fixture: EvalFixture, salt: number, played: unknown[]) => {
    const ctx = buildContext(fixture, salt) as Record<string, unknown>;
    // The songs this sitting has already played are part of the listener's history by now.
    const session = (played as EvalFixture['favorites']).map((song, i) => ({ song, ts: NOW - (played.length - i) * 210_000, completed: true }));
    return { ...ctx, history: [...session.reverse(), ...fixture.history] };
  },
};

interface LatencyCondition {
  id: string;
  notes: string;
  runs: number;
  /** How long a single run may take before the harness stops waiting. */
  capMs?: number;
  slow?: boolean;
  suggestions?: 'throw' | 'never';
  search?: 'throw' | 'never';
  /** Searches after this many calls never settle; the earlier ones answer. */
  searchNeverAfter?: number;
  ai?: EvalFixture['ai'];
  deadlineMs?: number;
  /** Run against a production-sized pool instead of the small fixture pool. */
  largePool?: boolean;
  /** The baseline has no deadline option, so an urgent-deadline condition is the current pipeline's alone. */
  currentOnly?: boolean;
}

/** Every run is sequential: the scripted sources and AI are one shared script, so two runs at once would read each other's. */
const LONG_RUNS = Math.max(3, Math.min(LATENCY_RUNS, 5));
const CONDITIONS: LatencyCondition[] = [
  { id: 'instant-sources', notes: 'Every source answers at once, AI off: the cost of the on-device pipeline itself.', runs: Math.max(20, LATENCY_RUNS * 3) },
  { id: 'slow-sources', notes: 'Every catalogue call answers after 140–900 ms, taken in order from a fixed ladder.', runs: LATENCY_RUNS, slow: true },
  { id: 'source-throws', notes: 'The seed-suggestions source fails at once; the searches answer.', runs: LATENCY_RUNS, suggestions: 'throw' },
  { id: 'source-never-settles', notes: 'A search never settles and the rest of the pool stays small; the default deadline applies.', runs: LONG_RUNS, search: 'never', capMs: 10_000 },
  { id: 'source-never-settles-large-pool', notes: 'Two searches answer with a production-sized pool and every later one never settles: the gather may stop waiting once the pool is useful.', runs: LONG_RUNS, searchNeverAfter: 2, largePool: true, capMs: 10_000 },
  { id: 'source-never-settles-urgent', notes: 'A search never settles while the listener waits at the end of the queue (urgent deadline).', runs: LONG_RUNS, search: 'never', deadlineMs: 3_500, capMs: 6_000, currentOnly: true },
  { id: 'ai-slow', notes: 'The AI DJ answers after 2 s with an order of its own.', runs: LATENCY_RUNS, ai: { mode: 'dj', answer: 'reorder', delayMs: 2_000 }, capMs: 8_000 },
  { id: 'ai-never', notes: 'The AI DJ never answers (its client would hold 30 s).', runs: LONG_RUNS, ai: { mode: 'dj', answer: 'never' }, capMs: 8_000 },
];

it('evaluates next-song selection against the versioned fixtures', { timeout: 30 * 60_000 }, async () => {
  const fixtures = buildFixtures(NOW);
  const titles = Object.fromEntries(fixtures.map((f) => [f.id, f.title]));

  /* ---- quality: rules, repetition, coverage, discovery, fallbacks ---- */
  // The clock stands still so the run is bit-for-bit reproducible (decay,
  // rediscovery windows and the "this year" test all read Date.now()).
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  const sessions: SessionRecord[] = [];
  for (const fixture of fixtures) {
    for (let salt = 1; salt <= SALTS; salt += 1) sessions.push(await runSession(engine, fixture, salt, env));
  }
  // Determinism: the same fixture and salt, run again, must give the same songs.
  const repeat = await runSession(engine, fixtures[1], 1, env);
  const first = sessions.find((s) => s.fixture === fixtures[1].id && s.salt === 1);
  const deterministic = JSON.stringify(repeat.queueIds) === JSON.stringify(first?.queueIds);
  vi.useRealTimers();

  const quality = summarise(sessions, titles);

  /* ---- latency: wall time from the call to a queueable order ---- */
  const latency: Array<Record<string, unknown>> = [];
  const small = latencyFixture(Date.now());
  const large = largePoolFixture(Date.now());
  for (const condition of CONDITIONS) {
    if (condition.currentOnly && ENTRY !== 'planNextSongs') {
      latency.push({ id: condition.id, notes: condition.notes, skipped: 'the baseline has no deadline option' });
      continue;
    }
    const base = condition.largePool ? large : small;
    applyFixture({ ...base, ai: condition.ai ?? { mode: 'off' } });
    armFixture(base, base.seed.id, { suggestions: condition.suggestions, search: condition.search, searchNeverAfter: condition.searchNeverAfter ?? null, slow: condition.slow, ai: condition.ai ?? { mode: 'off' } });
    const options = {
      limit: LIMIT,
      excludeIds: [base.seed.id],
      excludeKeys: [songKey(base.seed)],
      ...(condition.deadlineMs ? { deadlineMs: condition.deadlineMs } : {}),
    };
    const capMs = Math.min(condition.capMs ?? LATENCY_CAP_MS, LATENCY_CAP_MS);
    const outcomes = [];
    for (let i = 0; i < condition.runs; i += 1) {
      // Re-arm before every run: a never-settling source and a scripted AI answer are per-run state.
      armFixture(base, base.seed.id, { suggestions: condition.suggestions, search: condition.search, searchNeverAfter: condition.searchNeverAfter ?? null, slow: condition.slow, ai: condition.ai ?? { mode: 'off' } });
      outcomes.push(await planOnce(engine, base.seed, buildContext(base, 7), options, capMs));
    }
    latency.push({
      id: condition.id,
      notes: condition.notes,
      runs: outcomes.length,
      capMs,
      poolSize: base.related.length + base.search.length,
      queueReadyP50: percentile(outcomes.map((o) => o.queueReadyMs), 50),
      queueReadyP95: percentile(outcomes.map((o) => o.queueReadyMs), 95),
      finalP50: percentile(outcomes.map((o) => o.finalMs), 50),
      finalP95: percentile(outcomes.map((o) => o.finalMs), 95),
      songsMean: round(outcomes.reduce((n, o) => n + o.final.length, 0) / Math.max(1, outcomes.length), 2),
      censored: outcomes.filter((o) => o.timedOut).length,
      fallbacks: outcomes.reduce<Record<string, number>>((acc, o) => ({ ...acc, [o.fallback ?? 'none']: (acc[o.fallback ?? 'none'] ?? 0) + 1 }), {}),
      refinements: outcomes.reduce<Record<string, number>>((acc, o) => ({ ...acc, [o.refinement]: (acc[o.refinement] ?? 0) + 1 }), {}),
    });
  }

  const report = {
    pipeline: PIPELINE,
    ref: process.env.EVAL_REF ?? '',
    entry: ENTRY,
    alg: typeof engine.algorithmVersion === 'function' ? engine.algorithmVersion() : 'unknown',
    fixturesVersion: EVAL_FIXTURES_VERSION,
    harnessVersion: EVAL_HARNESS_VERSION,
    salts: SALTS,
    fixtures: fixtures.map((f) => ({ id: f.id, title: f.title, notes: f.notes, batches: f.batches, related: f.related.length, search: f.search.length, mode: f.discoveryMode, ai: f.ai.mode === 'off' ? 'off' : `dj:${f.ai.answer}` })),
    deterministic,
    // When a repeat run differs, both orders are kept: a reproducible harness is the whole point.
    determinismDiff: deterministic ? null : { first: first?.queueIds ?? [], repeat: repeat.queueIds },
    quality,
    latency,
    generatedAt: new Date().toISOString(),
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);

  expect(quality.overall.batches).toBeGreaterThan(0);
  expect(deterministic).toBe(true);
  // The current pipeline is held to the rules; the baseline is measured, not judged.
  if (process.env.EVAL_ASSERT !== '0') {
    expect({ violations: quality.overall.violations, hard: quality.overall.hardViolations }).toEqual({ violations: quality.overall.violations, hard: 0 });
  }
});
