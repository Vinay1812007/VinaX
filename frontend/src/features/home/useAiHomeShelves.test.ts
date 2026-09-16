// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/native', () => ({ isNativePlatform: () => false, platformName: () => 'web', haptic: () => undefined }));

import { loadShownShelves, parseSections, recordShownShelves } from './useAiHomeShelves';

beforeEach(() => localStorage.clear());

describe('parseSections', () => {
  it('keeps 2–6 clean, unique sections and clips fields', () => {
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
    expect(out.map((s) => s.title)).toEqual(['Monsoon melodies', 'Sid Sriram at night', 'Folk energy', 'Rahman classics', 'Extra 1', 'Extra 2']);
  });
  it('needs at least two usable sections and tolerates junk', () => {
    expect(parseSections({ sections: [{ title: 'Only one', query: 'q' }] })).toEqual([]);
    expect(parseSections(null)).toEqual([]);
    expect(parseSections('nope')).toEqual([]);
  });
});

describe('shown-shelf memory', () => {
  it('remembers titles newest first, de-duplicated and capped', () => {
    recordShownShelves([{ title: 'A', query: 'qa', why: '' }, { title: 'B', query: 'qb', why: '' }]);
    recordShownShelves([{ title: 'a', query: 'qa2', why: '' }, { title: 'C', query: 'qc', why: '' }]);
    expect(loadShownShelves().map((s) => s.title)).toEqual(['a', 'C', 'B']);
    for (let i = 0; i < 40; i += 1) recordShownShelves([{ title: `T${i}`, query: `q${i}`, why: '' }]);
    expect(loadShownShelves()).toHaveLength(30);
  });
});
