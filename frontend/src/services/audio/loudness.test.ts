// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  LOUDNESS_CACHE_MAX,
  LOUDNESS_KEY,
  MAX_LEVEL_DB,
  TARGET_LUFS,
  blockLoudness,
  cachedLoudness,
  dbToGain,
  integratedLoudness,
  levelGainDb,
  priorLoudness,
  resetLoudnessMemory,
  storeLoudness,
} from './loudness';
import { freezeLocalWrites, resetLocalGuardsForTests } from '@/services/storage/local';

/** The mean square whose block loudness is `lufs`. */
const ms = (lufs: number) => Math.pow(10, (lufs + 0.691 - 3.01) / 10);

beforeEach(() => {
  localStorage.clear();
  resetLoudnessMemory();
  resetLocalGuardsForTests();
});

describe('loudness maths', () => {
  it('a block mean square maps to a LUFS-like level; silence is -Infinity', () => {
    expect(blockLoudness(ms(-14))).toBeCloseTo(-14, 6);
    expect(blockLoudness(0)).toBe(-Infinity);
    expect(blockLoudness(NaN)).toBe(-Infinity);
  });

  it('a steady song measures at its own level', () => {
    expect(integratedLoudness(Array(10).fill(ms(-9)))!).toBeCloseTo(-9, 6);
  });

  it('silence and a quiet intro far below the rest do not pull the level down', () => {
    const blocks = [0, 0, ms(-80), ms(-40), ms(-40), ...Array(10).fill(ms(-10))];
    expect(integratedLoudness(blocks)!).toBeCloseTo(-10, 6);
  });

  it('nothing audible gives no measurement', () => {
    expect(integratedLoudness([])).toBeNull();
    expect(integratedLoudness([0, ms(-90)])).toBeNull();
  });

  it('gain moves a song to the target and is clamped to ±9 dB', () => {
    expect(TARGET_LUFS).toBe(-14);
    expect(levelGainDb(-8)).toBeCloseTo(-6);
    expect(levelGainDb(-20)).toBeCloseTo(6);
    expect(levelGainDb(-40)).toBe(MAX_LEVEL_DB);
    expect(levelGainDb(0)).toBe(-MAX_LEVEL_DB);
    expect(levelGainDb(null)).toBe(0);
    expect(dbToGain(0)).toBe(1);
    expect(dbToGain(-6)).toBeCloseTo(0.501, 3);
  });
});

describe('per-song cache', () => {
  it('stores and reads back a song, surviving a reload', () => {
    storeLoudness('a', -9.27);
    expect(cachedLoudness('a')).toBe(-9.3);
    resetLoudnessMemory();
    expect(cachedLoudness('a')).toBe(-9.3);
    expect(cachedLoudness('b')).toBeNull();
  });

  it(`keeps only the newest ${LOUDNESS_CACHE_MAX} songs, and a replay counts as new`, () => {
    for (let i = 0; i < LOUDNESS_CACHE_MAX; i += 1) storeLoudness(`s${i}`, -10);
    expect(cachedLoudness('s0')).toBe(-10); // touched: now the newest
    storeLoudness('extra', -11);
    expect(cachedLoudness('s1')).toBeNull(); // the oldest went
    expect(cachedLoudness('s0')).toBe(-10);
    expect(JSON.parse(localStorage.getItem(LOUDNESS_KEY)!)).toHaveLength(LOUDNESS_CACHE_MAX);
  });

  it('writes nothing while a restore or Clear all data reloads the page', () => {
    freezeLocalWrites();
    storeLoudness('a', -9);
    expect(localStorage.getItem(LOUDNESS_KEY)).toBeNull();
    expect(cachedLoudness('a')).toBe(-9); // this page still levels it
  });

  it('ignores corrupt storage', () => {
    localStorage.setItem(LOUDNESS_KEY, '{oops');
    expect(cachedLoudness('a')).toBeNull();
    resetLoudnessMemory();
    localStorage.setItem(LOUDNESS_KEY, JSON.stringify([['a', -9], ['b', 'x'], 5]));
    expect(cachedLoudness('a')).toBe(-9);
    expect(cachedLoudness('b')).toBeNull();
  });

  it('a first-time song starts from the median of known songs, once there are enough', () => {
    for (const [i, v] of [-8, -9, -10, -12].entries()) storeLoudness(`s${i}`, v);
    expect(priorLoudness()).toBeNull();
    storeLoudness('s4', -20);
    expect(priorLoudness()).toBe(-10);
  });
});
