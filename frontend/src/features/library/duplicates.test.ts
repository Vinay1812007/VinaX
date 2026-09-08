import { describe, it, expect } from 'vitest';
import type { Song } from '@/types';
import { findDuplicates, normalizeText, songMatchKey } from './duplicates';

const song = (id: string, title: string, artist = 'Artist', extra: Partial<Song> = {}): Song => ({
  kind: 'song',
  id,
  title,
  subtitle: artist,
  artists: artist ? [{ id: `a-${artist}`, name: artist }] : [],
  album: null,
  images: [],
  audio: [],
  duration: 200,
  language: 'telugu',
  year: '2024',
  explicit: false,
  hasLyrics: false,
  playCount: null,
  ...extra,
});

describe('normalizeText', () => {
  it('lower-cases, strips accents and punctuation, collapses spaces', () => {
    expect(normalizeText('  Kesariyá  (From "Brahmāstra")! ')).toBe('kesariya from brahmastra');
  });
});

describe('findDuplicates', () => {
  it('reports nothing for a clean list', () => {
    const r = findDuplicates([song('1', 'A'), song('2', 'B')]);
    expect(r.duplicates).toEqual([]);
    expect(r.unique.map((s) => s.id)).toEqual(['1', '2']);
  });

  it('flags repeats by id and keeps the first occurrence', () => {
    const r = findDuplicates([song('1', 'A'), song('2', 'B'), song('1', 'A (Remaster)')]);
    expect(r.duplicates.map((s) => s.id)).toEqual(['1']);
    expect(r.unique.map((s) => s.id)).toEqual(['1', '2']);
  });

  it('flags repeats by normalised title + first artist across different ids', () => {
    const r = findDuplicates([song('1', 'Naatu Naatu', 'Rahul Sipligunj'), song('2', 'NAATU  naatu!', 'rahul sipligunj')]);
    expect(r.duplicates.map((s) => s.id)).toEqual(['2']);
    expect(r.unique.map((s) => s.id)).toEqual(['1']);
  });

  it('does not merge the same title by different artists', () => {
    const r = findDuplicates([song('1', 'Kesariya', 'X'), song('2', 'Kesariya', 'Y')]);
    expect(r.duplicates).toEqual([]);
  });

  it('falls back to the subtitle when no artist is credited', () => {
    const a = song('1', 'Srivalli', '', { subtitle: 'Sid Sriram, Devi Sri Prasad' });
    const b = song('2', 'Srivalli', '', { subtitle: 'Sid Sriram' });
    expect(songMatchKey(a)).toBe(songMatchKey(b));
    expect(findDuplicates([a, b]).duplicates.map((s) => s.id)).toEqual(['2']);
  });
});
