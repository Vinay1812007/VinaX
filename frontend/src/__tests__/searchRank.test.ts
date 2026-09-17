/**
 * Phase 6–8 search quality (delta audit P0-6, P1-11, P2-28): search mode must
 * never junk-filter or collapse versions, relevance must beat position, and
 * query normalization/relaxation must behave for Indic + Latin input.
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';
import type { TasteProfile } from '@/services/personalization/profile';

// The taste profile is swappable per test; null = the real (empty) one.
const taste = vi.hoisted(() => ({ profile: null as TasteProfile | null }));
vi.mock('@/services/personalization/storage', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/services/personalization/storage')>();
  return { ...real, loadProfile: () => taste.profile ?? real.loadProfile() };
});

import { createEmptyProfile } from '@/services/personalization/profile';
import { useSettingsStore } from '@/store/settingsStore';
import {
  normalizeQuery,
  rankSettingsKey,
  rankSongs,
  relaxedQuery,
} from '../features/search/useSearch';

afterEach(() => {
  taste.profile = null;
});

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

describe('invisible characters and compatibility forms', () => {
  it('drops a pasted zero-width space, word joiner, BOM and soft hyphen', () => {
    expect(normalizeQuery('\u200bkesariya')).toBe('kesariya');
    expect(normalizeQuery('kesa\u00adriya\ufeff')).toBe('kesariya');
    expect(normalizeQuery('\u2060tum hi ho\u200b')).toBe('tum hi ho');
    expect(normalizeQuery('\u200b')).toBe('');
  });

  it('folds fullwidth Latin to what a keyboard types', () => {
    expect(normalizeQuery('ＡＲＩＪＩＴ　Ｓｉｎｇｈ')).toBe('arijit singh');
  });

  it('keeps ZWJ / ZWNJ in the query sent upstream', () => {
    expect(normalizeQuery('నువ్\u200cవే')).toBe('నువ్\u200cవే');
    expect(normalizeQuery('क्\u200dष')).toBe('क्\u200dष');
  });

  it('ignores joiners when comparing a title with the query', () => {
    const songs = [song('Filler One'), song('Filler Two'), song('నువ్వే')];
    const ranked = rankSongs(songs, { query: 'నువ్\u200cవే', searchMode: true });
    expect(ranked[0]?.title).toBe('నువ్వే');
  });
});

describe('shelf mode leans towards the listener\'s artists', () => {
  const loved = { id: 'ar1', name: 'Loved Singer' } as unknown as Song['artists'][number];
  const other = { id: 'ar2', name: 'Someone Else' } as unknown as Song['artists'][number];
  const withLovedArtist = (): void => {
    const profile = createEmptyProfile();
    profile.artists.ar1 = { name: 'Loved Singer', score: 10, plays: 10, completes: 10, skips: 0, lastTs: Date.now() };
    taste.profile = profile;
  };

  it('lifts a loved artist over an upstream neighbour, but only on shelves', () => {
    const songs = [
      song('First', { artists: [other] }),
      song('Second', { artists: [other] }),
      song('Third', { artists: [other] }),
      song('Fourth', { artists: [loved] }),
    ];
    const titles = (list: Song[]) => list.map((s) => s.title);
    expect(titles(rankSongs(songs))).toEqual(['First', 'Second', 'Third', 'Fourth']);
    withLovedArtist();
    // +0.3 is worth one upstream step here (0.25), not two: a nudge, not a takeover.
    expect(titles(rankSongs(songs))).toEqual(['First', 'Second', 'Fourth', 'Third']);
    expect(titles(rankSongs(songs, { searchMode: true }))).toEqual(['First', 'Second', 'Third', 'Fourth']);
  });
});

describe('rankSettingsKey (shelf cache keys follow the ranking settings)', () => {
  it('changes with muted languages, pinned languages and kid mode', () => {
    const base = rankSettingsKey(['tamil'], ['telugu', 'hindi'], false);
    expect(rankSettingsKey(['tamil', 'english'], ['telugu', 'hindi'], false)).not.toBe(base);
    expect(rankSettingsKey(['tamil'], ['hindi', 'telugu'], false)).not.toBe(base); // pin order ranks
    expect(rankSettingsKey(['tamil'], ['telugu', 'hindi'], true)).not.toBe(base);
    expect(rankSettingsKey(['tamil'], ['telugu', 'hindi'], false)).toBe(base);
    expect(rankSettingsKey(['b', 'a'], [], false)).toBe(rankSettingsKey(['a', 'b'], [], false));
  });

  it('a muted language is excluded from a command-palette style search ranking', () => {
    const before = useSettingsStore.getState().mutedLanguages;
    useSettingsStore.setState({ mutedLanguages: ['tamil'] });
    try {
      const out = rankSongs([song('A', { language: 'tamil' }), song('B', { language: 'hindi' })], {
        query: 'a',
        searchMode: true,
      });
      expect(out.map((s) => s.title)).toEqual(['B']);
    } finally {
      useSettingsStore.setState({ mutedLanguages: before });
    }
  });
});

