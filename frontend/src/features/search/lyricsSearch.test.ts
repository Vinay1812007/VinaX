import { describe, expect, it } from 'vitest';
import type { Song } from '@/types';
import type { LyricsSearchHit } from '@/services/lyrics/lrclib';
import { looksLikeLyric, pickBest, queryWords, resolveLyricsHits, splitHighlight } from './lyricsSearch';

const song = (id: string, title: string, subtitle = 'Artist', extra: Partial<Song> = {}): Song => ({
  kind: 'song',
  id,
  title,
  subtitle,
  artists: [],
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

const hit = (title: string, artist = '', duration: number | null = null): LyricsSearchHit => ({
  title,
  artist,
  album: '',
  duration,
  snippet: '',
});

describe('pickBest (search by lyrics)', () => {
  it('prefers the exact title over a partial one', () => {
    const exact = song('1', 'Tum Hi Ho');
    const partial = song('2', 'Tum Hi Ho (Reprise)');
    expect(pickBest(hit('Tum Hi Ho'), [partial, exact])).toBe(exact);
  });

  it('never returns a song whose title does not resemble the hit', () => {
    expect(pickBest(hit('Kesariya'), [song('1', 'Deva Deva'), song('2', 'Rasiya')])).toBeNull();
  });

  it('ignores film-soundtrack noise in catalogue titles', () => {
    const s = song('1', 'Chikiri Chikiri (From "Peddi")');
    expect(pickBest(hit('Chikiri Chikiri'), [s])).toBe(s);
  });

  it('breaks ties with a shared artist word and a close duration', () => {
    const a = song('a', 'Samajavaragamana', 'Sid Sriram', { duration: 240 });
    const b = song('b', 'Samajavaragamana', 'Cover Band', { duration: 400 });
    expect(pickBest(hit('Samajavaragamana', 'Sid Sriram', 241), [b, a])).toBe(a);
  });

  it('returns null for an empty candidate list', () => {
    expect(pickBest(hit('Anything'), [])).toBeNull();
  });
});

describe('resolveLyricsHits', () => {
  it('resolves each hit, drops misses, and de-duplicates songs', async () => {
    const found = song('x', 'Kesariya', 'Arijit');
    const search = async (q: string): Promise<Song[]> => (q.startsWith('Kesariya') ? [found] : [song('z', 'Unrelated')]);
    const out = await resolveLyricsHits([hit('Kesariya', 'Arijit'), hit('Kesariya', 'Arijit (Lofi)'), hit('Nothing here')], search);
    expect(out.map((m) => m.song.id)).toEqual(['x']);
  });

  it('survives a failed catalogue lookup', async () => {
    const search = async (): Promise<Song[]> => {
      throw new Error('offline');
    };
    expect(await resolveLyricsHits([hit('Kesariya')], search)).toEqual([]);
  });
});

describe('query helpers', () => {
  it('splits a query into matchable words (inner apostrophes stay, quotes drop)', () => {
    expect(queryWords("Tum hi ho, aashiqui's I 'kesariya'")).toEqual(['tum', 'hi', 'ho', "aashiqui's", 'kesariya']);
  });

  it('treats five or more words as a lyric line', () => {
    expect(looksLikeLyric('tum hi ho')).toBe(false);
    expect(looksLikeLyric('meri aashiqui ab tum hi ho')).toBe(true);
  });

  it('splits a snippet into highlightable runs, case-insensitively', () => {
    const runs = splitHighlight('…Kyunki tum hi ho, ab TUM hi ho…', 'tum hi ho');
    expect(runs.filter((r) => r.hit).map((r) => r.text)).toEqual(['tum', 'hi', 'ho', 'TUM', 'hi', 'ho']);
    expect(runs.map((r) => r.text).join('')).toBe('…Kyunki tum hi ho, ab TUM hi ho…');
  });

  it('returns the whole snippet as one run when nothing matches', () => {
    expect(splitHighlight('la la la', 'zz')).toEqual([{ text: 'la la la', hit: false }]);
    expect(splitHighlight('', 'zz')).toEqual([]);
  });
});
