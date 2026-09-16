// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/native', () => ({ isNativePlatform: () => false, platformName: () => 'web', haptic: () => undefined }));

import { loadShownShelves, loadShownSongIds, parseSections, recordShownShelves, recordShownSongs } from '@/services/ai/home';

beforeEach(() => localStorage.clear());

describe('parseSections', () => {
  it('keeps 2–8 clean, unique sections, accepts description/type, and clips fields', () => {
    const out = parseSections({
      sections: [
        { title: 'Monsoon melodies', query: 'telugu monsoon melody songs', why: 'Rain outside, slow songs inside.' },
        { title: 'Monsoon melodies', query: 'different query' }, // duplicate title
        { title: 'Same query twice', query: 'telugu monsoon melody songs' }, // duplicate query
        { title: '<b>Markup</b>', query: 'x', why: 'y' },
        { title: 'Linked', query: 'best of https://example.test', why: 'no' },
        { title: 'Sid Sriram at night', query: 'sid sriram night songs', why: 'Your most played voice this week' },
        { title: 'Folk energy', query: 'telugu folk beats', why: 'w' },
        { title: 'Rahman classics', query: 'ar rahman telugu classics', why: 'w' },
        { title: 'Extra 1', query: 'q1', why: 'w' },
        { title: 'Extra 2', query: 'q2', why: 'w' },
        { title: 'Extra 3', query: 'q3', why: 'w' },
      ],
    });
    expect(out.map((s) => s.title)).toEqual(['Monsoon melodies', 'Sid Sriram at night', 'Folk energy', 'Rahman classics', 'Extra 1', 'Extra 2', 'Extra 3']);
    expect(out[0].type).toBe('other');
    const typed = parseSections({ sections: [{ title: 'Late Night Telugu', description: 'Smooth Telugu tracks for a late-night session', query: 'telugu romantic melody', reason: 'Based on recent late-night listening', type: 'mood' }, { title: 'B', query: 'b', type: 'bogus' }] });
    expect(typed[0]).toEqual({ title: 'Late Night Telugu', description: 'Smooth Telugu tracks for a late-night session', query: 'telugu romantic melody', reason: 'Based on recent late-night listening', type: 'mood' });
    expect(typed[1].type).toBe('other');
  });
  it('needs at least two usable sections and tolerates junk', () => {
    expect(parseSections({ sections: [{ title: 'Only one', query: 'q' }] })).toEqual([]);
    expect(parseSections(null)).toEqual([]);
    expect(parseSections('nope')).toEqual([]);
  });
});

describe('shown-shelf memory', () => {
  it('remembers titles newest first, de-duplicated and capped', () => {
    recordShownShelves([{ title: 'A', query: 'qa' }, { title: 'B', query: 'qb' }]);
    recordShownShelves([{ title: 'a', query: 'qa2' }, { title: 'C', query: 'qc' }]);
    expect(loadShownShelves().map((s) => s.title)).toEqual(['a', 'C', 'B']);
    for (let i = 0; i < 40; i += 1) recordShownShelves([{ title: `T${i}`, query: `q${i}` }]);
    expect(loadShownShelves()).toHaveLength(30);
  });
});

describe('shown-song memory', () => {
  it('remembers song ids newest first, de-duplicated and capped at 200', () => {
    const mk = (id: string) => ({ id }) as unknown as import('@/types').Song;
    recordShownSongs([mk('a'), mk('b')]);
    recordShownSongs([mk('c'), mk('a')]);
    expect(loadShownSongIds()).toEqual(['c', 'a', 'b']);
    recordShownSongs(Array.from({ length: 250 }, (_, i) => mk(`s${i}`)));
    expect(loadShownSongIds()).toHaveLength(200);
  });
});
