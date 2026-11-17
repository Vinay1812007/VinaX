import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_RECOMMENDATION_WEIGHTS,
  RECOMMENDATION_WEIGHTS,
  activeWeightsVersion,
  applyWeightOverrides,
  resetWeightOverrides,
} from './weights';
import { scoreCandidate } from './scoring';
import { createEmptyProfile } from '../personalization/profile';
import type { RecommendationContext } from './types';
import type { Song } from '../../types';

/**
 * Weight overrides. Nothing publishes them any more (the owner's rec-config
 * rollout is gone), but the scorer still reads the live RECOMMENDATION_WEIGHTS
 * object and tests tune it through applyWeightOverrides, so an applied
 * override must change scores and a reset must put the exact defaults back.
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
