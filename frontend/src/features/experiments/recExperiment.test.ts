// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pickVariant } from './useExperiment';
import { applyWeightOverrides, resetWeightOverrides } from '@/services/recommendation/weights';
import {
  activeRecVariants,
  claimExposure,
  decideRecVariant,
  EXP_REC_CONFIG,
  EXP_REC_NEXT_SONGS,
  exposureOf,
  loadRecExperiments,
  PENDING_DECISION_TTL_MS,
  recVariant,
  resetRecExperiments,
  setRecExperimentConfig,
} from './recExperiment';

/**
 * 7.2.0 — recommendation experiments: the pure-hash assignment shared with the
 * Worker, the active variant map, and exposure that is logged only when a
 * decision actually shaped a continuation that was served.
 */
const SPLIT = [{ name: 'control', pct: 50 }, { name: 'treatment', pct: 50 }];
const config = (variants = SPLIT) => [{ key: EXP_REC_NEXT_SONGS, variants }];
const NOW = 1_800_000_000_000;

/** An independent FNV-1a (BigInt, spec constants) to pin the assignment hash to the published algorithm. */
function fnvReference(s: string): number {
  let h = 0x811c9dc5n;
  for (const ch of s) {
    for (let i = 0; i < ch.length; i += 1) {
      h ^= BigInt(ch.charCodeAt(i));
      h = (h * 0x01000193n) % 0x1_0000_0000n;
    }
  }
  return Number(h);
}

beforeEach(() => {
  resetRecExperiments();
  localStorage.clear();
});

describe('assignment', () => {
  it('uses the published FNV-1a over "device:key" (the same hash the Worker re-derives)', () => {
    expect(fnvReference('')).toBe(0x811c9dc5);
    expect(fnvReference('a')).toBe(0xe40c292c);
    expect(fnvReference('foobar')).toBe(0xbf9cf968);
    for (let i = 0; i < 200; i += 1) {
      const device = `device-${i}`;
      const bucket = fnvReference(`${device}:${EXP_REC_NEXT_SONGS}`) % 100;
      setRecExperimentConfig(config(), device);
      expect(recVariant(EXP_REC_NEXT_SONGS)).toBe(bucket < 50 ? 'control' : 'treatment');
      expect(recVariant(EXP_REC_NEXT_SONGS)).toBe(pickVariant(device, EXP_REC_NEXT_SONGS, SPLIT));
    }
  });

  it('is outside the experiment (reads control, exposes nothing) before config, for other keys, and outside allocated traffic', () => {
    expect(recVariant(EXP_REC_NEXT_SONGS)).toBe('control');
    expect(activeRecVariants()).toEqual({});
    setRecExperimentConfig([{ key: 'home-shelf-order', variants: SPLIT }], 'device-1');
    expect(activeRecVariants()).toEqual({});
    // 0 % allocated: nobody is in it.
    setRecExperimentConfig(config([{ name: 'treatment', pct: 0 }]), 'device-1');
    expect(activeRecVariants()).toEqual({});
    expect(decideRecVariant(EXP_REC_NEXT_SONGS, NOW)).toBe('control');
    expect(claimExposure(1, { now: NOW })).toEqual({});
  });

  it('exposes the active variant map for enrolled experiments', () => {
    setRecExperimentConfig(config([{ name: 'treatment', pct: 100 }]), 'device-1');
    expect(activeRecVariants()).toEqual({ [EXP_REC_NEXT_SONGS]: 'treatment' });
  });

  it('loads the anonymous config once; a failed read leaves the device outside every experiment', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ experiments: config([{ name: 'treatment', pct: 100 }]) }) }) as unknown as Response);
    await loadRecExperiments(fetcher);
    await loadRecExperiments(fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String((fetcher.mock.calls[0] as unknown[])[0])).toMatch(/\/api\/experiments$/);
    expect(recVariant(EXP_REC_NEXT_SONGS)).toBe('treatment');
    resetRecExperiments();
    await loadRecExperiments(async () => { throw new Error('offline'); });
    expect(recVariant(EXP_REC_NEXT_SONGS)).toBe('control');
  });
});

describe('exposure', () => {
  beforeEach(() => setRecExperimentConfig(config([{ name: 'treatment', pct: 100 }]), 'device-1'));

  it('is logged only when a decision shaped a continuation that was served', () => {
    // Assigned, but no decision point read it: a served continuation exposes nothing.
    expect(claimExposure(1, { now: NOW })).toEqual({});
    expect(decideRecVariant(EXP_REC_NEXT_SONGS, NOW)).toBe('treatment');
    expect(claimExposure(2, { now: NOW + 1_000 })).toEqual({ [EXP_REC_NEXT_SONGS]: 'treatment' });
    // Consumed: the next continuation needs its own decision.
    expect(claimExposure(3, { now: NOW + 2_000 })).toEqual({});
    expect(exposureOf(2)).toEqual({ [EXP_REC_NEXT_SONGS]: 'treatment' });
    expect(exposureOf(1)).toEqual({});
    expect(exposureOf(99)).toEqual({});
  });

  it('a plan that was never served exposes nobody (its decision expires)', () => {
    decideRecVariant(EXP_REC_NEXT_SONGS, NOW);
    expect(claimExposure(1, { now: NOW + PENDING_DECISION_TTL_MS + 1 })).toEqual({});
  });

  it('a reserve top-up carries the exposure of the plan it came from', () => {
    decideRecVariant(EXP_REC_NEXT_SONGS, NOW);
    claimExposure(1, { now: NOW });
    expect(claimExposure(2, { reserve: true, now: NOW + 5_000 })).toEqual({ [EXP_REC_NEXT_SONGS]: 'treatment' });
  });

  it('control is exposed the same way, so the arms are comparable', () => {
    setRecExperimentConfig(config([{ name: 'control', pct: 100 }]), 'device-1');
    expect(decideRecVariant(EXP_REC_NEXT_SONGS, NOW)).toBe('control');
    expect(claimExposure(1, { now: NOW })).toEqual({ [EXP_REC_NEXT_SONGS]: 'control' });
  });
});

describe('the owner tuning rollout', () => {
  afterEach(() => resetWeightOverrides());

  it('an applied weight override shapes every continuation: rec-config is its variant, or all', () => {
    expect(claimExposure(1, { now: NOW })).toEqual({});
    applyWeightOverrides({ mood: 0.2 }, { version: 7, variant: 'warmer' });
    expect(activeRecVariants()).toEqual({ [EXP_REC_CONFIG]: 'warmer' });
    expect(claimExposure(2, { now: NOW })).toEqual({ [EXP_REC_CONFIG]: 'warmer' });
    applyWeightOverrides({ mood: 0.2 }, { version: 8, variant: null });
    expect(claimExposure(3, { now: NOW })).toEqual({ [EXP_REC_CONFIG]: 'all' });
    // An override with no valid key is not applied: nothing to report.
    applyWeightOverrides({ nonsense: 1 }, { version: 9, variant: 'x' });
    expect(claimExposure(4, { now: NOW })).toEqual({});
    // A served continuation keeps the rollout it was planned under.
    expect(exposureOf(2)).toEqual({ [EXP_REC_CONFIG]: 'warmer' });
  });
});
