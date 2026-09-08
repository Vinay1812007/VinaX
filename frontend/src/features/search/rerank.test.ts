import { describe, expect, it } from 'vitest';
import type { Song } from '@/types';
import { matchTier, rerankSongs } from './rerank';

const song = (id: string, title: string, language: string | null = null): Song => ({
  kind: 'song',
  id,
  title,
  subtitle: 'Artist',
  artists: [],
  album: null,
  images: [],
  audio: [],
  duration: 200,
  language,
  year: null,
  explicit: false,
  hasLyrics: false,
  playCount: null,
});

const ids = (list: Song[]) => list.map((s) => s.id);

describe('rerankSongs (v5.19.0 literal-match boosts)', () => {
  it('puts the exact title first, then starts-with, then all-words, then the rest', () => {
    const list = [
      song('rest', 'Something Else'),
      song('words', 'Ho Tum Hi'),
      song('starts', 'Tum Hi Ho Reprise'),
      song('exact', 'Tum Hi Ho'),
    ];
    expect(ids(rerankSongs(list, 'tum hi ho', []))).toEqual(['exact', 'starts', 'words', 'rest']);
  });

  it('treats a "(From …)" suffix as part of an exact match', () => {
    const list = [song('a', 'Kesariya Reprise'), song('b', 'Kesariya (From "Brahmastra")')];
    expect(ids(rerankSongs(list, 'Kesariya', []))).toEqual(['b', 'a']);
  });

  it('is stable within a tier and case/whitespace-insensitive', () => {
    const list = [song('1', 'Naatu Naatu'), song('2', 'Naatu Naatu'), song('3', 'Naatu Naatu (Slowed)')];
    expect(ids(rerankSongs(list, '  NAATU   naatu ', []))).toEqual(['1', '2', '3']);
  });

  it('nudges pinned-language songs up within a tier but never across tiers', () => {
    const list = [song('en', 'Butta Bomma', 'english'), song('te', 'Butta Bomma', 'telugu'), song('exact', 'butta bomma remix', 'hindi')];
    expect(ids(rerankSongs(list, 'butta bomma', ['telugu']))).toEqual(['te', 'en', 'exact']);
    // A pinned language cannot lift a non-match above a literal match.
    const mixed = [song('x', 'Unrelated', 'telugu'), song('y', 'Butta Bomma', 'hindi')];
    expect(ids(rerankSongs(mixed, 'butta bomma', ['telugu']))).toEqual(['y', 'x']);
  });

  it('returns the input untouched when there is nothing to boost by', () => {
    const list = [song('a', 'A'), song('b', 'B')];
    expect(rerankSongs(list, '', [])).toBe(list);
    expect(rerankSongs([list[0]], 'a', [])).toEqual([list[0]]);
  });

  it('matchTier reports the tiers directly', () => {
    expect(matchTier('Samajavaragamana', 'samajavaragamana', ['samajavaragamana'])).toBe(3);
    expect(matchTier('Samajavaragamana (Reprise)', 'samajavaragamana', ['samajavaragamana'])).toBe(3);
    expect(matchTier('Samajavaragamana Lofi', 'samajavaragamana', ['samajavaragamana'])).toBe(2);
    expect(matchTier('Ala Vaikunthapurramuloo Samajavaragamana', 'samajavaragamana ala', ['samajavaragamana', 'ala'])).toBe(1);
    expect(matchTier('Ramuloo Ramulaa', 'samajavaragamana', ['samajavaragamana'])).toBe(0);
  });
});
