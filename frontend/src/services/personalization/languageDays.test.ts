// @vitest-environment jsdom
/**
 * 7.2 — plays per weekday, per language: the one additive profile field the
 * candidate-specific weekday term learns from. Old profiles load unchanged;
 * a stored record keeps it; a play bumps it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSong } from '@/__fixtures__/songs';
import { createEmptyProfile, normalizeProfile } from './profile';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe('languageDays', () => {
  it('survives a load, is coerced when damaged, and stays absent on a profile that predates it', () => {
    const kept = normalizeProfile({ ...createEmptyProfile(1), languageDays: { telugu: [1, 2, 3, 4, 5, 6, 7], hindi: [1, 'x', -2], junk: 'nope' } });
    expect(kept.languageDays).toEqual({ telugu: [1, 2, 3, 4, 5, 6, 7], hindi: [1, 0, 0, 0, 0, 0, 0] });
    expect('languageDays' in normalizeProfile(createEmptyProfile(1))).toBe(false);
  });

  it('a play counts toward its language on today’s weekday', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date(2026, 8, 19, 12)); // a Saturday
    vi.resetModules();
    const { recordPlay } = await import('./updater');
    const { loadProfile } = await import('./storage');
    recordPlay(makeSong('s1', { language: 'telugu' }));
    recordPlay(makeSong('s2', { language: 'telugu' }));
    recordPlay(makeSong('s3', { language: 'hindi' }));
    recordPlay(makeSong('s4', { language: null }));
    const p = loadProfile();
    expect(p.languageDays?.telugu).toEqual([0, 0, 0, 0, 0, 0, 2]);
    expect(p.languageDays?.hindi).toEqual([0, 0, 0, 0, 0, 0, 1]);
    expect(Object.keys(p.languageDays ?? {})).toEqual(['telugu', 'hindi']);
  });
});
