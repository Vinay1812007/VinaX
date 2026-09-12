import { describe, expect, it } from 'vitest';
import type { Song } from '@/types';
import { DEFAULT_FILTERS, refineSongs, resultsCsv, sanitizeFilters } from './workspace';
import { filterSongsLocally } from './sortSongs';
import { rerankSongs } from './rerank';
const song = (id: string, extra: Partial<Song> = {}): Song => ({
  kind: 'song',
  id,
  title: 'Café Melody',
  subtitle: 'Singer',
  artists: [],
  album: { id: 'album', name: 'Summer' },
  images: [],
  audio: [],
  duration: 200,
  language: 'telugu',
  year: '2024',
  explicit: false,
  hasLyrics: true,
  playCount: 10,
  ...extra,
});

describe('search workspace filters', () => {
  it('combines filters, rejects unknown metadata and respects boundary lengths', () => {
    const songs = [
      song('short', { duration: 179 }),
      song('edge', { duration: 180 }),
      song('long', { duration: 301 }),
      song('unknown', { year: null }),
      song('explicit', { explicit: true }),
    ];
    expect(
      refineSongs(
        songs,
        { ...DEFAULT_FILTERS, decade: '2020', duration: 'medium', clean: true },
        new Set(),
        new Set(),
      ).map((s) => s.id),
    ).toEqual(['edge']);
  });
  it('uses local favorite/history indexes without removing from the input', () => {
    const songs = [song('a'), song('b'), song('c')];
    expect(
      refineSongs(
        songs,
        { ...DEFAULT_FILTERS, favorites: true, unheard: true },
        new Set(['a', 'b']),
        new Set(['a']),
      ).map((s) => s.id),
    ).toEqual(['b']);
    expect(songs).toHaveLength(3);
  });
  it('treats persisted data as untrusted', () => {
    expect(
      sanitizeFilters({ decade: 'NaN', duration: 'forever', clean: 'false', lyrics: true }),
    ).toEqual({ ...DEFAULT_FILTERS, lyrics: true });
  });
  it('matches words across album and artist fields with accent folding', () => {
    expect(filterSongsLocally([song('a')], 'cafe summer singer')).toHaveLength(1);
    expect(filterSongsLocally([song('a')], 'cafe winter')).toHaveLength(0);
  });
  it('ranks accented exact titles before prefix matches and preserves Indic vowels', () => {
    expect(
      rerankSongs(
        [song('prefix', { title: 'Cafe Melody Reprise' }), song('exact')],
        'cafe melody',
        [],
      ).map((s) => s.id),
    ).toEqual(['exact', 'prefix']);
    expect(filterSongsLocally([song('te', { title: 'మాట' })], 'మాట')).toHaveLength(1);
    expect(filterSongsLocally([song('te', { title: 'మాట' })], 'మట')).toHaveLength(0);
  });
  it('escapes CSV quotes/newlines and neutralizes spreadsheet formulas', () => {
    const csv = resultsCsv([
      song('x', { title: '=HYPERLINK("bad")', subtitle: 'Singer, "Name"\nSecond line' }),
    ]);
    expect(csv).toContain('"\'=HYPERLINK(""bad"")"');
    expect(csv).toContain('"Singer, ""Name""\nSecond line"');
  });
});
