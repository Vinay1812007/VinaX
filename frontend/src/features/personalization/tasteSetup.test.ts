// @vitest-environment jsdom
/**
 * The optional "pick languages & artists" step writes through the ordinary
 * taste profile: a picked artist counts as much as a like, the language it
 * came from counts half, and the list of artists offered never repeats one
 * or includes someone the listener already blocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSong } from '@/__fixtures__/songs';

vi.mock('@/services/storage/idb', () => ({ addEvent: vi.fn(async () => undefined), clearEvents: vi.fn(async () => undefined) }));

import { loadProfile, withProfile } from '@/services/personalization/storage';
import { EVENT_WEIGHTS } from '@/services/personalization/eventWeights';
import { declareArtists, leadArtists } from './tasteSetup';

beforeEach(() => {
  localStorage.clear();
  withProfile((p) => {
    p.artists = {};
    p.languages = {};
    return p;
  });
});

describe('leadArtists', () => {
  it('takes one entry per lead artist, in pool order, and leaves out the excluded', () => {
    const pool = [
      makeSong('a', { artist: 'సిద్ శ్రీరామ్' }),
      makeSong('b', { artist: 'సిద్ శ్రీరామ్' }),
      makeSong('c', { artist: 'అనురాగ్ కులకర్ణి' }),
      makeSong('d', { artist: 'Blocked One' }),
    ];
    const picked = leadArtists(pool, (a) => a.name === 'Blocked One');
    expect(picked.map((a) => a.name)).toEqual(['సిద్ శ్రీరామ్', 'అనురాగ్ కులకర్ణి']);
    expect(picked[0].language).toBe('telugu');
  });
});

describe('declareArtists', () => {
  it('counts a picked artist like a like, and their language half as much', () => {
    const n = declareArtists([{ id: 'ar-1', name: 'సిద్ శ్రీరామ్', language: 'telugu' }]);
    expect(n).toBe(1);
    const p = loadProfile();
    expect(p.artists['ar-1'].score).toBe(EVENT_WEIGHTS.FAVORITE);
    expect(p.artists['ar-1'].name).toBe('సిద్ శ్రీరామ్');
    expect(p.languages.telugu.score).toBe(EVENT_WEIGHTS.FAVORITE / 2);
    // Declaring is not listening: no play is counted.
    expect(p.totals.plays).toBe(0);
    expect(p.artists['ar-1'].plays).toBe(0);
  });

  it('is a no-op for an empty pick', () => {
    expect(declareArtists([])).toBe(0);
    expect(Object.keys(loadProfile().artists)).toHaveLength(0);
  });
});
