// @vitest-environment jsdom
/**
 * Profile persistence: a stored record is normalised before use, a reset
 * cancels the pending debounced save, and nothing is written once a restore
 * has frozen local writes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KEYS } from '@/constants/storage-keys';
import { normalizeProfile } from './profile';

const load = async () => {
  vi.resetModules();
  const storage = await import('./storage');
  const local = await import('@/services/storage/local');
  return { ...storage, ...local };
};

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('normalizeProfile', () => {
  it('coerces every damaged part to a usable value', () => {
    const p = normalizeProfile({
      version: 1,
      createdAt: 'yesterday',
      updatedAt: 5,
      languages: ['telugu'],
      artists: { a1: { score: 'high', plays: 3, name: 7 }, junk: 'x', 'name:ilaiyaraaja': { score: 2, plays: 1, completes: 1, skips: 0, lastTs: 9 } },
      songs: null,
      hourHistogram: [1, 'two', Infinity],
      dayHistogram: { 0: 4 },
      totals: { plays: 12, completes: NaN, skips: '3' },
      recentSongIds: ['s1', 4, null, 's2'],
      skippedSongIds: 'nope',
      hourBuckets: { telugu: [1, 2], hindi: 'x' },
      energyPref: { sum: 'x', n: 1 },
      softMuted: { a1: { until: 10 }, a2: { until: 'later' } },
      sliders: { adventurous: 4, recency: 0.5, energy: 0.2, vocalness: 0.9 },
    });
    expect(p.version).toBe(1);
    expect(Number.isFinite(p.createdAt)).toBe(true);
    expect(p.updatedAt).toBe(5);
    expect(p.languages).toEqual({});
    expect(p.artists).toEqual({
      a1: { score: 0, plays: 3, completes: 0, skips: 0, lastTs: 0, name: 'a1' },
      'name:ilaiyaraaja': { score: 2, plays: 1, completes: 1, skips: 0, lastTs: 9, name: 'ilaiyaraaja' },
    });
    expect(p.songs).toEqual({});
    expect(p.hourHistogram).toHaveLength(24);
    expect(p.hourHistogram.slice(0, 3)).toEqual([1, 0, 0]);
    expect(p.dayHistogram).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(p.totals).toEqual({ plays: 12, completes: 0, skips: 0, favorites: 0, queueAdds: 0 });
    expect(p.recentSongIds).toEqual(['s1', 's2']);
    expect(p.skippedSongIds).toEqual([]);
    expect(p.hourBuckets).toEqual({ telugu: [1, 2, 0, 0] });
    expect(p.energyPref).toBeUndefined();
    expect(p.softMuted).toEqual({ a1: { until: 10 } });
    expect(p.sliders).toEqual({ adventurous: 1, recency: 0.5, energy: 0.2, vocalness: 0.9 });
  });

  it('leaves optional fields absent when the record never had them, and survives non-objects', () => {
    const p = normalizeProfile({ version: 1, totals: { plays: 1 } });
    expect(p.songs).toBeUndefined();
    expect(p.dayHistogram).toBeUndefined();
    expect(p.sliders).toBeUndefined();
    for (const junk of [null, undefined, 'x', 4, []]) expect(normalizeProfile(junk).totals.plays).toBe(0);
  });
});

describe('profile storage', () => {
  it('loadProfile normalises what it reads', async () => {
    localStorage.setItem(KEYS.profile, JSON.stringify({ version: 1, languages: [], hourHistogram: null, totals: { plays: 3 } }));
    const { loadProfile } = await load();
    const p = loadProfile();
    expect(p.totals.plays).toBe(3);
    expect(p.languages).toEqual({});
    expect(p.hourHistogram).toHaveLength(24);
    expect(p.recentSongIds).toEqual([]);
  });

  it('resetProfile cancels the pending debounced save', async () => {
    const { loadProfile, saveProfile, resetProfile } = await load();
    const p = loadProfile();
    p.totals.plays = 41;
    saveProfile(p);
    await resetProfile();
    vi.advanceTimersByTime(2000);
    expect(localStorage.getItem(KEYS.profile)).toBeNull();
    expect(loadProfile().totals.plays).toBe(0);
  });

  it('neither the debounce nor the pagehide flush writes once local writes are frozen', async () => {
    localStorage.setItem(KEYS.profile, JSON.stringify({ version: 1, totals: { plays: 7 } }));
    const { loadProfile, saveProfile, freezeLocalWrites } = await load();
    const p = loadProfile();
    p.totals.plays = 99;
    saveProfile(p);
    // A restore just wrote this key and is about to reload.
    localStorage.setItem(KEYS.profile, '{"version":1,"totals":{"plays":500}}');
    freezeLocalWrites();
    window.dispatchEvent(new Event('pagehide'));
    vi.advanceTimersByTime(2000);
    expect(localStorage.getItem(KEYS.profile)).toBe('{"version":1,"totals":{"plays":500}}');
  });
});
