import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_RECOMMENDATION_WEIGHTS,
  RECOMMENDATION_WEIGHTS,
  activeWeightOverride,
  activeWeightsVersion,
  applyWeightOverrides,
  resetWeightOverrides,
} from './weights';
import { decideRecRollout } from './remoteWeights';
import { pickVariant } from '@/features/experiments/useExperiment';
import { scoreCandidate } from './scoring';
import { createEmptyProfile } from '../personalization/profile';
import type { RecommendationContext } from './types';
import type { Song } from '../../types';
import { syncRecConfig } from '@/features/home/useAppConfig';

/**
 * 7.2.0 — owner-published weight overrides. The scorer reads the live
 * RECOMMENDATION_WEIGHTS object, so an applied override must change scores
 * and a reset must put the exact defaults back. Rollout targeting is the
 * experiments hash: a device gets an experiment-staged config only in its
 * own variant.
 */

afterEach(() => resetWeightOverrides());

const song = (over: Partial<Song> = {}): Song => ({
  kind: 'song', id: 'id1', title: 'Title', subtitle: 'Artist', artists: [{ id: 'a1', name: 'Artist' }], album: null, images: [], audio: [],
  duration: 200, language: 'telugu', year: null, explicit: false, hasLyrics: false, playCount: 5_000_000, ...over,
});
const ctx = (): RecommendationContext => ({
  profile: createEmptyProfile(0), hour: 12, region: null, pinnedLanguages: [], mutedLanguages: [], intensity: 0.6, favorites: [], history: [], salt: 1,
});

describe('applyWeightOverrides', () => {
  it('starts on the defaults with the plain version', () => {
    expect({ ...RECOMMENDATION_WEIGHTS }).toEqual({ ...DEFAULT_RECOMMENDATION_WEIGHTS });
    expect(activeWeightsVersion()).toBe('1.3.0');
    expect(activeWeightOverride()).toBeNull();
  });

  it('applies known keys, clamps each to half … double its default, ignores the rest', () => {
    const keys = applyWeightOverrides({ mood: 0.2, diversity: 9, likes: 0, nonsense: 1, skips: 'x', __proto__: 5 } as Record<string, unknown>, { version: 7, variant: null });
    expect(keys.sort()).toEqual(['diversity', 'likes', 'mood']);
    expect(RECOMMENDATION_WEIGHTS.mood).toBe(0.2);
    expect(RECOMMENDATION_WEIGHTS.diversity).toBeCloseTo(0.4, 10);
    expect(RECOMMENDATION_WEIGHTS.likes).toBeCloseTo(0.05, 10);
    expect(RECOMMENDATION_WEIGHTS.skips).toBe(DEFAULT_RECOMMENDATION_WEIGHTS.skips);
    expect('nonsense' in RECOMMENDATION_WEIGHTS).toBe(false);
    expect(activeWeightsVersion()).toBe('1.3.0+rc7');
    expect(activeWeightOverride()).toMatchObject({ version: 7, variant: null });
  });

  it('never stacks: a second apply starts from the defaults again', () => {
    applyWeightOverrides({ mood: 0.3 }, { version: 1, variant: null });
    applyWeightOverrides({ tempo: 0.1 }, { version: 2, variant: 'treatment' });
    expect(RECOMMENDATION_WEIGHTS.mood).toBe(DEFAULT_RECOMMENDATION_WEIGHTS.mood);
    expect(RECOMMENDATION_WEIGHTS.tempo).toBe(0.1);
    expect(activeWeightsVersion()).toBe('1.3.0+rc2');
  });

  it('an empty override or a bad version leaves the defaults and the plain version', () => {
    expect(applyWeightOverrides({}, { version: 3, variant: null })).toEqual([]);
    expect(applyWeightOverrides({ mood: 0.2 }, { version: 0, variant: null })).toEqual([]);
    expect(RECOMMENDATION_WEIGHTS.mood).toBe(DEFAULT_RECOMMENDATION_WEIGHTS.mood);
    expect(activeWeightsVersion()).toBe('1.3.0');
  });

  it('reset restores the exact defaults', () => {
    applyWeightOverrides({ mood: 0.3, novelty: 0.2 }, { version: 4, variant: null });
    resetWeightOverrides();
    expect({ ...RECOMMENDATION_WEIGHTS }).toEqual({ ...DEFAULT_RECOMMENDATION_WEIGHTS });
    expect(activeWeightsVersion()).toBe('1.3.0');
  });

  it('the scorer reads the effective weights (popularity doubled → its term doubles)', () => {
    const before = scoreCandidate({ song: song(), source: 'trending' }, ctx());
    applyWeightOverrides({ popularity: 0.1 }, { version: 5, variant: null });
    const after = scoreCandidate({ song: song(), source: 'trending' }, ctx());
    const pop = (r: typeof before) => r.reasons.find((x) => x.kind === 'popularity')!.weight;
    expect(pop(after)).toBeCloseTo(pop(before) * 2, 10);
    expect(after.score).toBeGreaterThan(before.score);
  });
});

describe('rollout targeting on the device', () => {
  const split = [{ name: 'control', pct: 50 }, { name: 'treatment', pct: 50 }];
  const staged = (variant: string) => ({ version: 9, overrides: { mood: 0.2 }, rollout: { mode: 'experiment', experimentKey: 'rec-weights', variant, variants: split } });
  // Two device ids that the shared hash puts in different variants.
  const ids = Array.from({ length: 40 }, (_, i) => `device-${i}`);
  const inTreatment = ids.find((id) => pickVariant(id, 'rec-weights', split) === 'treatment')!;
  const inControl = ids.find((id) => pickVariant(id, 'rec-weights', split) === 'control')!;

  it('applies to every device for mode all', () => {
    expect(decideRecRollout({ version: 2, overrides: { mood: 0.2 }, rollout: { mode: 'all' } }, 'anyone')).toMatchObject({ apply: true, version: 2, variant: null });
  });

  it('applies an experiment-staged config only inside its variant', async () => {
    expect(inTreatment).toBeTruthy();
    expect(inControl).toBeTruthy();
    expect(decideRecRollout(staged('treatment'), inTreatment)).toMatchObject({ apply: true, variant: 'treatment' });
    await syncRecConfig(staged('treatment'), inTreatment);
    expect(RECOMMENDATION_WEIGHTS.mood).toBe(0.2);
    expect(activeWeightsVersion()).toBe('1.3.0+rc9');
    expect(activeWeightOverride()).toMatchObject({ version: 9, variant: 'treatment' });
    expect(decideRecRollout(staged('treatment'), inControl)).toEqual({ apply: false, reason: 'not-targeted' });
    await syncRecConfig(staged('treatment'), inControl);
    expect(RECOMMENDATION_WEIGHTS.mood).toBe(DEFAULT_RECOMMENDATION_WEIGHTS.mood);
    expect(activeWeightsVersion()).toBe('1.3.0');
  });

  it('treats a missing, malformed or off config as "defaults"', async () => {
    applyWeightOverrides({ mood: 0.3 }, { version: 1, variant: null });
    expect(decideRecRollout(null, 'x')).toEqual({ apply: false, reason: 'none' });
    await syncRecConfig({ version: 1, overrides: { mood: 0.2 }, rollout: { mode: 'off' } }, 'x');
    expect(RECOMMENDATION_WEIGHTS.mood).toBe(DEFAULT_RECOMMENDATION_WEIGHTS.mood);
    for (const bad of [
      'nope',
      { version: 1, overrides: { mood: 0.2 }, rollout: { mode: 'off' } },
      { version: 1.5, overrides: { mood: 0.2 }, rollout: { mode: 'all' } },
      { version: 1, overrides: [], rollout: { mode: 'all' } },
      { version: 1, overrides: { mood: 0.2 }, rollout: { mode: 'experiment', experimentKey: 'rec-weights', variant: 'treatment' } }, // no split
    ]) expect(decideRecRollout(bad, inTreatment)).toEqual({ apply: false, reason: 'malformed' });
  });
});

describe('syncRecConfig (the useClientConfig hook-up)', () => {
  it('loads nothing while nothing is published, applies a published config, clears it when withdrawn', async () => {
    await syncRecConfig(null);
    expect(activeWeightsVersion()).toBe('1.3.0');
    await syncRecConfig({ version: 3, overrides: { mood: 0.24 }, rollout: { mode: 'all' } });
    expect(RECOMMENDATION_WEIGHTS.mood).toBe(0.24);
    expect(activeWeightsVersion()).toBe('1.3.0+rc3');
    await syncRecConfig(null);
    expect(RECOMMENDATION_WEIGHTS.mood).toBe(DEFAULT_RECOMMENDATION_WEIGHTS.mood);
    expect(activeWeightsVersion()).toBe('1.3.0');
  });

  it('the newest sync wins: a decision arriving after a later withdrawal is dropped', async () => {
    const pending = syncRecConfig({ version: 4, overrides: { mood: 0.3 }, rollout: { mode: 'all' } });
    await syncRecConfig(null);
    await pending;
    expect(RECOMMENDATION_WEIGHTS.mood).toBe(DEFAULT_RECOMMENDATION_WEIGHTS.mood);
    expect(activeWeightsVersion()).toBe('1.3.0');
  });
});
