// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';
import type { Candidate, RecommendationContext } from './types';
import { makeContext, makeSong, warmProfile } from '@/__fixtures__/songs';

/**
 * 13.1 — the next-song experiment's decision point (`rec-next-songs`). The
 * planner reads it on every plan, in every arm; a named arm sets the taste-fit
 * weight, and control — or a variant name this build does not know — scores
 * exactly as shipped.
 */
let pool: Candidate[] = [];
const seen: Array<number | undefined> = [];
vi.mock('./candidates', () => ({
  gatherCandidates: vi.fn(async () => pool),
  generateNextCandidates: vi.fn(async (_seed: Song, ctx: RecommendationContext) => {
    seen.push(ctx.tasteFitWeight);
    return pool;
  }),
}));
vi.mock('@/services/queryClient', () => ({ queryClient: { getQueryData: () => undefined } }));

import { planNextSongs, REC_TASTE_ARMS } from './engine';
import { scoreCandidate } from './scoring';
import { claimExposure, EXP_REC_NEXT_SONGS, setRecExperimentConfig } from '@/features/experiments/recExperiment';
import { useSettingsStore } from '@/store/settingsStore';
import { TASTE_WEIGHTS } from './weights';

const NOW = 1_800_000_000_000;
const seed = makeSong('seed', { title: 'Seed', artist: 'Sid Sriram' });
const cands = (n: number): Candidate[] => Array.from({ length: n }, (_, i) => ({ song: makeSong(`te${i}`, { artist: `Artist ${i}` }), source: 'related' as const }));
const ctx = () => makeContext({ profile: warmProfile(NOW), pinnedLanguages: ['telugu'], surface: 'next' });

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  seen.length = 0;
  pool = cands(12);
  setRecExperimentConfig([]);
  useSettingsStore.setState({ kidMode: false, mutedLanguages: [] });
});

describe('rec-next-songs decision point', () => {
  it('outside the experiment the plan carries no override: the shipped weight applies', async () => {
    await planNextSongs(seed, ctx(), { limit: 5 });
    expect(seen).toEqual([undefined]);
  });

  it('a named arm sets the taste-fit weight for the plan and records the decision for exposure', async () => {
    setRecExperimentConfig([{ key: EXP_REC_NEXT_SONGS, variants: [{ name: 'taste-0.18', pct: 100 }] }], 'device-a');
    await planNextSongs(seed, ctx(), { limit: 5 });
    expect(seen).toEqual([0.18]);
    expect(claimExposure(1)).toMatchObject({ [EXP_REC_NEXT_SONGS]: 'taste-0.18' });
  });

  it('control is read (and exposed) too, and an unknown variant name means no change', async () => {
    setRecExperimentConfig([{ key: EXP_REC_NEXT_SONGS, variants: [{ name: 'control', pct: 100 }] }], 'device-b');
    await planNextSongs(seed, ctx(), { limit: 5 });
    expect(claimExposure(2)).toMatchObject({ [EXP_REC_NEXT_SONGS]: 'control' });
    setRecExperimentConfig([{ key: EXP_REC_NEXT_SONGS, variants: [{ name: 'taste-typo', pct: 100 }] }], 'device-c');
    await planNextSongs(seed, ctx(), { limit: 5 });
    expect(seen).toEqual([undefined, undefined]);
  });

  it('the arms stay inside a sane band around the shipped weight', () => {
    for (const w of Object.values(REC_TASTE_ARMS)) {
      expect(w).toBeGreaterThanOrEqual(TASTE_WEIGHTS.tasteFit * 0.5);
      expect(w).toBeLessThanOrEqual(TASTE_WEIGHTS.tasteFit * 2);
    }
  });
});

describe('scoring honours the plan weight', () => {
  it('a higher taste-fit weight raises the taste term, nothing else', () => {
    const c: Candidate = { song: makeSong('x', { artist: 'Artist 1' }), source: 'related' };
    const base = { ...ctx(), favorites: [makeSong('f', { artist: 'Artist 1' })] };
    const taste = (r: ReturnType<typeof scoreCandidate>) => r.reasons.filter((x) => x.kind === 'taste').reduce((a, x) => a + x.weight, 0);
    const shipped = scoreCandidate(c, base);
    const higher = scoreCandidate(c, { ...base, tasteFitWeight: TASTE_WEIGHTS.tasteFit * 2 });
    expect(taste(shipped)).toBeGreaterThan(0);
    expect(taste(higher)).toBeCloseTo(taste(shipped) * 2, 6);
    expect(higher.score - shipped.score).toBeCloseTo(taste(higher) - taste(shipped), 6);
  });
});
