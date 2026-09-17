import { describe, expect, it } from 'vitest';
import type { Song } from '@/types';
import { creditScore, matchTier, rerankSongs, suggestTitles } from './rerank';

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

const credited = (id: string, title: string, singer: string, extra: Partial<Song> = {}): Song => ({
  ...song(id, title),
  subtitle: singer,
  artists: [{ id: `ar-${id}`, name: singer, role: 'singer', image: [] }] as unknown as Song['artists'],
  ...extra,
});

describe('title + credits queries', () => {
  const dub = credited('dub', 'Kesariya', 'Sid Sriram', { language: 'telugu' });
  const filler = credited('filler', 'Arijit Singh Mashup', 'Various', { language: 'hindi' });
  const original = credited('orig', 'Kesariya (From "Brahmastra")', 'Arijit Singh', {
    language: 'hindi',
    album: { id: 'al', name: 'Brahmastra', images: [] } as unknown as Song['album'],
  });

  it('"title artist" ranks the credited original above a pinned-language dub', () => {
    const out = rerankSongs([dub, filler, original], 'kesariya arijit singh', ['telugu']);
    expect(ids(out)).toEqual(['orig', 'dub', 'filler']);
  });

  it('"artist - title" does the same, punctuation and all', () => {
    const out = rerankSongs([dub, filler, original], 'Arijit Singh - Kesariya', ['telugu']);
    expect(ids(out)[0]).toBe('orig');
  });

  it('matches the film / album name as a credit too', () => {
    expect(creditScore(original, ['kesariya', 'brahmastra'])).toBe(25);
    expect(creditScore(dub, ['kesariya', 'brahmastra'])).toBe(0);
  });

  it('gives the small nudge when the words are spread over title and credits', () => {
    const s = credited('x', 'Kesariya Dance Mix', 'Arijit Singh');
    expect(creditScore(s, ['kesariya', 'arijit'])).toBe(5);
    expect(creditScore(s, ['arijit', 'singh'])).toBe(0); // nothing in the title
    expect(creditScore(s, ['kesariya'])).toBe(0); // single word: the tiers handle it
  });

  it('never lifts a credits match above an exact title', () => {
    const exact = credited('exact', 'Kesariya Arijit Singh', 'Tribute Band');
    expect(ids(rerankSongs([original, exact], 'kesariya arijit singh', []))).toEqual(['exact', 'orig']);
  });
});

describe('punctuation never decides a tier', () => {
  it('"dont stop" matches "Don\'t Stop"', () => {
    expect(matchTier("Don't Stop", 'dont stop', ['dont', 'stop'])).toBe(3);
    expect(matchTier('Don’t Stop Believin', 'dont stop', ['dont', 'stop'])).toBe(2);
    expect(matchTier('Dont Stop', "don't stop", ["don't", 'stop'])).toBe(3);
  });

  it('ignores hyphens, commas and dots on both sides', () => {
    expect(matchTier('Ae Dil Hai Mushkil - Title Track', 'ae dil hai mushkil title track', [])).toBe(3);
    expect(matchTier('O.M.G.', 'omg', ['omg'])).toBe(0); // dots separate, they do not join
    expect(matchTier('Mr. Perfect', 'mr perfect', ['mr', 'perfect'])).toBe(3);
  });

  it('keeps Indic vowel signs and ignores joiners', () => {
    expect(matchTier('दिल', 'दाल', ['दाल'])).toBe(0);
    expect(matchTier('तुम ही हो', 'तुम ही हो', ['तुम', 'ही', 'हो'])).toBe(3);
    expect(matchTier('నువ్వే నువ్వే', 'నువ్\u200cవే నువ్వే', [])).toBe(3);
  });
});

describe('exact-title ties: the original, then the more played', () => {
  it('a pinned-language "(Karaoke)" cut does not take Top Result from the original', () => {
    const list = [
      song('karaoke', 'Tum Hi Ho (Karaoke)', 'hindi'),
      song('remaster', 'Tum Hi Ho (Remastered)', 'hindi'),
      song('orig', 'Tum Hi Ho', 'english'),
    ];
    expect(ids(rerankSongs(list, 'tum hi ho', ['hindi']))).toEqual(['orig', 'remaster', 'karaoke']);
  });

  it('prefers the more-played cut among equals, and leaves unknown counts in place', () => {
    const list = [
      { ...song('small', 'Naatu Naatu'), playCount: 10 },
      { ...song('unknown', 'Naatu Naatu') },
      { ...song('big', 'Naatu Naatu'), playCount: 9000 },
    ];
    expect(ids(rerankSongs(list, 'naatu naatu', []))).toEqual(['big', 'unknown', 'small']);
  });

  it('popularity does not reorder lower tiers', () => {
    const list = [
      { ...song('a', 'Naatu Naatu Returns'), playCount: 1 },
      { ...song('b', 'Naatu Naatu Forever'), playCount: 99 },
    ];
    expect(ids(rerankSongs(list, 'naatu naatu', []))).toEqual(['a', 'b']);
  });
});

describe('suggestTitles', () => {
  const songs = [song('1', 'Kesariya'), song('2', 'kesariya'), song('3', 'Kesariya Reprise'), song('4', ' ')];
  const settled = { resultsQuery: 'kesar', typedQuery: 'kesar', placeholder: false };

  it('offers deduped titles for the settled, current query', () => {
    expect(suggestTitles(songs, 'kesar', settled)).toEqual(['Kesariya', 'Kesariya Reprise']);
    expect(suggestTitles(songs, 'Kesariya ', { ...settled, resultsQuery: 'kesariya', typedQuery: 'kesariya' })).toEqual([
      'Kesariya Reprise',
    ]);
    expect(suggestTitles(songs, 'kesar', settled, 1)).toEqual(['Kesariya']);
  });

  it('offers nothing while the songs belong to another query', () => {
    expect(suggestTitles(songs, 'pushpa', { resultsQuery: 'pushpa', typedQuery: 'pushpa', placeholder: true })).toEqual([]);
    expect(suggestTitles(songs, 'pushpa', { resultsQuery: 'kesar', typedQuery: 'pushpa', placeholder: false })).toEqual([]);
  });
});
