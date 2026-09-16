import { describe, expect, it } from 'vitest';
import type { HistoryEntry, Song } from '@/types';
import {
  EMPTY_RULES,
  collectLocalSongs,
  describeRules,
  evaluateSmartCollection,
  migrateSmartCollection,
  sanitizeRules,
  sanitizeSmartCollections,
} from './smartCollections';

const song = (id: string, title: string, artist: string, extra: Partial<Song> = {}): Song => ({
  kind: 'song', id, title, subtitle: artist, artists: [{ id: `a-${artist}`, name: artist }], album: null, images: [], audio: [],
  duration: 200, language: 'telugu', year: '2020', explicit: false, hasLyrics: false, playCount: null, ...extra,
});
const NOW = Date.UTC(2026, 8, 16);
const DAY = 86_400_000;
const play = (s: Song, daysAgo: number): HistoryEntry => ({ song: s, ts: NOW - daysAgo * DAY, completed: true });

const tel1 = song('t1', 'Samajavaragamana', 'Sid Sriram', { duration: 240, year: '2019' });
const tel2 = song('t2', 'Naatu Naatu', 'Rahul Sipligunj', { duration: 220, year: '2022' });
const hin1 = song('h1', 'Kesariya', 'Arijit Singh', { language: 'hindi', duration: 268, year: '2022' });
const long1 = song('l1', 'Long Raga', 'Ilaiyaraaja', { duration: 900, year: '1990' });
const src = {
  favorites: [tel1, hin1],
  collections: [{ songs: [tel2, long1] }],
  later: [],
  history: [play(tel1, 2), play(tel1, 40), play(hin1, 1), play(tel2, 100)],
};

describe('collectLocalSongs', () => {
  it('unions every local source by id and counts plays', () => {
    const items = collectLocalSongs(src);
    expect(items.map((i) => i.song.id).sort()).toEqual(['h1', 'l1', 't1', 't2']);
    const t1 = items.find((i) => i.song.id === 't1')!;
    expect(t1.favorite).toBe(true);
    expect(t1.plays).toBe(2);
    expect(t1.lastPlayedTs).toBe(NOW - 2 * DAY);
    expect(items.find((i) => i.song.id === 'l1')!.plays).toBe(0);
  });
});

describe('evaluateSmartCollection', () => {
  const ev = (rules: Partial<typeof EMPTY_RULES>, sort: 'recent' | 'title' | 'artist' | 'duration' | 'newest' | 'plays' = 'title', limit = 0) =>
    evaluateSmartCollection({ rules: { ...EMPTY_RULES, ...rules }, sort, limit }, src, NOW).map((s) => s.id);

  it('language rule', () => {
    expect(ev({ languages: ['hindi'] })).toEqual(['h1']);
    expect(ev({ languages: ['telugu'] })).toEqual(['l1', 't2', 't1']);
  });
  it('artist rule is accent/case-insensitive contains', () => {
    expect(ev({ artists: ['sid sriram'] })).toEqual(['t1']);
    expect(ev({ artists: ['ILAIYARAAJA', 'arijit'] })).toEqual(['h1', 'l1']);
  });
  it('duration, favourites, played-within and never-played rules', () => {
    expect(ev({ minDuration: 250 })).toEqual(['h1', 'l1']);
    expect(ev({ maxDuration: 230 })).toEqual(['t2']);
    expect(ev({ favoritesOnly: true })).toEqual(['h1', 't1']);
    expect(ev({ playedWithinDays: 7 })).toEqual(['h1', 't1']);
    expect(ev({ neverPlayed: true })).toEqual(['l1']);
  });
  it('year bounds and free text', () => {
    expect(ev({ yearFrom: 2022 })).toEqual(['h1', 't2']);
    expect(ev({ yearTo: 2000 })).toEqual(['l1']);
    expect(ev({ text: 'naatu' })).toEqual(['t2']);
  });
  it('rules combine with AND; sort and limit apply', () => {
    expect(ev({ languages: ['telugu'], favoritesOnly: true })).toEqual(['t1']);
    expect(ev({}, 'plays')).toEqual(['t1', 'h1', 't2', 'l1']);
    expect(ev({}, 'duration', 2)).toEqual(['l1', 'h1']);
    expect(ev({}, 'recent')[0]).toBe('h1');
  });
  it('an empty rule set means the whole local library', () => {
    expect(ev({})).toHaveLength(4);
    expect(describeRules(EMPTY_RULES)).toBe('Every song in your library');
  });
});

describe('definitions are sanitised and migrated', () => {
  it('drops junk fields, clamps numbers, keeps ids', () => {
    const def = migrateSmartCollection({
      id: 'x', name: '  Drive  ', rules: { languages: ['Telugu', 5, ''], artists: ['Sid'], minDuration: -4, maxDuration: 99_999_999, playedWithinDays: 0.4, text: 'a'.repeat(200), yearFrom: 'nope' },
      sort: 'bogus', limit: 5000, emoji: '🚗', extra: 'ignored',
    });
    expect(def).toMatchObject({ id: 'x', name: 'Drive', version: 1, sort: 'recent', limit: 1000, emoji: '🚗' });
    expect(def!.rules).toMatchObject({ languages: ['telugu'], artists: ['Sid'], minDuration: 0, maxDuration: 86_400, playedWithinDays: 1, yearFrom: null });
    expect(def!.rules.text).toHaveLength(80);
    expect('extra' in def!).toBe(false);
  });
  it('rejects definitions without id or name and de-duplicates by id', () => {
    expect(migrateSmartCollection({ name: 'no id' })).toBeNull();
    expect(migrateSmartCollection(null)).toBeNull();
    const list = sanitizeSmartCollections([{ id: 'a', name: 'A' }, { id: 'a', name: 'A again' }, 'junk', { id: 'b', name: 'B' }]);
    expect(list.map((c) => c.id)).toEqual(['a', 'b']);
  });
  it('sanitizeRules fills every field from a partial or missing object', () => {
    expect(sanitizeRules(undefined)).toEqual(EMPTY_RULES);
    expect(sanitizeRules({ favoritesOnly: 'yes' }).favoritesOnly).toBe(false);
  });
  it('describeRules reads naturally', () => {
    expect(describeRules({ ...EMPTY_RULES, languages: ['telugu'], favoritesOnly: true, playedWithinDays: 30, minDuration: 300 }, (l) => l.toUpperCase())).toBe('TELUGU · favourites · played in 30 days · over 5 min');
  });
});
