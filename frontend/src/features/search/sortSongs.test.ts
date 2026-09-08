import { describe, expect, it } from 'vitest';
import type { Song } from '@/types';
import { filterSongsLocally, sortSongs } from './sortSongs';

const song = (id: string, extra: Partial<Song> = {}): Song => ({
  kind: 'song',
  id,
  title: id,
  subtitle: 'Artist',
  artists: [],
  album: null,
  images: [],
  audio: [],
  duration: 200,
  language: null,
  year: null,
  explicit: false,
  hasLyrics: false,
  playCount: null,
  ...extra,
});

const ids = (list: Song[]) => list.map((s) => s.id);

describe('sortSongs', () => {
  const list = [
    song('b', { title: 'Beta', playCount: 10, year: '2001', duration: 300 }),
    song('a', { title: 'alpha', playCount: 50, year: '2020', duration: 100 }),
    song('c', { title: 'Gamma', playCount: null, year: null, duration: null }),
  ];

  it('keeps the ranked order for relevance (and returns the same array)', () => {
    expect(sortSongs(list, 'relevance')).toBe(list);
  });

  it('popular / newest / longest are descending with unknowns last', () => {
    expect(ids(sortSongs(list, 'popular'))).toEqual(['a', 'b', 'c']);
    expect(ids(sortSongs(list, 'newest'))).toEqual(['a', 'b', 'c']);
    expect(ids(sortSongs(list, 'longest'))).toEqual(['b', 'a', 'c']);
  });

  it('shortest is ascending but still sinks unknown durations', () => {
    expect(ids(sortSongs(list, 'shortest'))).toEqual(['a', 'b', 'c']);
  });

  it('A→Z is case-insensitive', () => {
    expect(ids(sortSongs(list, 'az'))).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the input', () => {
    const before = ids(list);
    sortSongs(list, 'az');
    expect(ids(list)).toEqual(before);
  });
});

describe('filterSongsLocally', () => {
  const list = [
    song('1', { title: 'Kesariya', subtitle: 'Arijit Singh' }),
    song('2', { title: 'Deva Deva', subtitle: 'Pritam', artists: [{ id: 'x', name: 'Arijit Singh' }] as Song['artists'] }),
    song('3', { title: 'Rasiya', subtitle: 'Shreya' }),
  ];

  it('matches title, subtitle or any credited artist, case-insensitively', () => {
    expect(ids(filterSongsLocally(list, 'arijit'))).toEqual(['1', '2']);
    expect(ids(filterSongsLocally(list, 'RASIYA'))).toEqual(['3']);
  });

  it('is a no-op for a blank filter', () => {
    expect(filterSongsLocally(list, '   ')).toBe(list);
  });
});
