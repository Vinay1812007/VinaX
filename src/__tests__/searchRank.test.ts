/**
 * Phase 6–8 search quality (delta audit P0-6, P1-11, P2-28): search mode must
 * never junk-filter or collapse versions, relevance must beat position, and
 * query normalization/relaxation must behave for Indic + Latin input.
 *
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import type { Song } from '@/types';
import { normalizeQuery, rankSongs, relaxedQuery } from '../features/search/useSearch';

let seq = 0;
function song(title: string, extra: Partial<Song> = {}): Song {
  seq += 1;
  return {
    kind: 'song',
    id: `s${seq}`,
    title,
    subtitle: 'Test Artist',
    artists: [],
    album: null,
    images: [],
    audio: [],
    duration: 180,
    language: null,
    year: '2024',
    explicit: false,
    hasLyrics: false,
    playCount: null,
    ...extra,
  };
}

describe('rankSongs — search mode vs shelf mode', () => {
  it('search mode keeps titles the junk filter would eat (P0-6a)', () => {
    const songs = [song('Naatu Naatu (Lyrical Video)'), song('Some Other Track')];
    const shelf = rankSongs(songs);
    const search = rankSongs(songs, { query: 'naatu naatu lyrical', searchMode: true });
    expect(shelf.some((s) => s.title.includes('Lyrical'))).toBe(false); // shelves stay clean
    expect(search.some((s) => s.title.includes('Lyrical'))).toBe(true); // search finds it
  });

  it('search mode keeps every version of a song; shelves diversify (P0-6b)', () => {
    const album = { id: 'a1', name: 'One Album', images: [] };
    const songs = [1, 2, 3, 4, 5].map((n) =>
      song(`Track ${n}`, { album: album as Song['album'] }),
    );
    expect(rankSongs(songs).length).toBeLessThanOrEqual(2); // shelf: 2-per-album cap
    expect(rankSongs(songs, { searchMode: true })).toHaveLength(5); // search: all of them
  });

  it('an exact title match outranks upstream position (P2-28)', () => {
    const songs = [song('Trending Filler One'), song('Trending Filler Two'), song('Tum Hi Ho')];
    const ranked = rankSongs(songs, { query: 'tum hi ho', searchMode: true });
    expect(ranked[0]?.title).toBe('Tum Hi Ho');
  });
});

describe('query normalization (P1-11)', () => {
  it('case and whitespace variants share one canonical form', () => {
    expect(normalizeQuery('  Arijit   SINGH ')).toBe('arijit singh');
    expect(normalizeQuery('Arijit Singh')).toBe(normalizeQuery('arijit singh'));
  });

  it('never mangles Indic scripts', () => {
    expect(normalizeQuery('तुम ही हो')).toBe('तुम ही हो');
    expect(normalizeQuery('సామజవరగమన')).toBe('సామజవరగమన');
  });

  it('relaxes typos: repeated letters and stray punctuation', () => {
    expect(relaxedQuery('arijittt singh!!')).toBe('arijit singh');
    expect(relaxedQuery('"tum hi ho"')).toBe('tum hi ho');
    expect(relaxedQuery('clean query')).toBeNull(); // nothing to relax → no retry
  });
});
