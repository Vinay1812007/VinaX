import { describe, it, expect } from 'vitest';
import type { Song } from '@/types';
import { pruneTrash, trashDaysLeft, TRASH_MAX, TRASH_TTL_MS } from './trash';
import { shuffled, sortSongs } from './sort';
import { collectionToText, songLine } from './collectionText';
import { collageArt } from './CollageCover';
import { FALLBACK_ART } from '@/utils/images';

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
const col = (id: string) => ({ id, name: id, createdAt: 0, songs: [] });

describe('trash', () => {
  it('drops expired entries, sorts newest first and caps at TRASH_MAX', () => {
    const now = 1_000_000_000_000;
    const entries = [
      { collection: col('old'), deletedAt: now - TRASH_TTL_MS - 1 },
      ...Array.from({ length: TRASH_MAX + 3 }, (_, i) => ({ collection: col(`c${i}`), deletedAt: now - i })),
    ];
    const pruned = pruneTrash(entries, now);
    expect(pruned).toHaveLength(TRASH_MAX);
    expect(pruned[0].collection.id).toBe('c0');
    expect(pruned.some((e) => e.collection.id === 'old')).toBe(false);
  });

  it('ignores malformed persisted entries', () => {
    const now = Date.now();
    const bad = [null, {}, { collection: {} }, { collection: col('ok'), deletedAt: now }] as unknown as Parameters<typeof pruneTrash>[0];
    expect(pruneTrash(bad, now).map((e) => e.collection.id)).toEqual(['ok']);
  });

  it('counts whole days left, never below 1', () => {
    const now = Date.now();
    expect(trashDaysLeft(now, now)).toBe(7);
    expect(trashDaysLeft(now - TRASH_TTL_MS + 1000, now)).toBe(1);
  });
});

describe('sort', () => {
  const list = [
    song('1', 'Bravo', 'Zed', { duration: 100, year: '2020' }),
    song('2', 'alpha', 'Amy', { duration: 300, year: '2024' }),
    song('3', 'Charlie', 'Amy', { duration: null, year: null }),
  ];
  it('keeps added order and never mutates the input', () => {
    const copy = [...list];
    expect(sortSongs(list, 'added').map((s) => s.id)).toEqual(['1', '2', '3']);
    sortSongs(list, 'title');
    expect(list).toEqual(copy);
  });
  it('sorts by title, artist (then title), duration desc and newest year', () => {
    expect(sortSongs(list, 'title').map((s) => s.id)).toEqual(['2', '1', '3']);
    expect(sortSongs(list, 'artist').map((s) => s.id)).toEqual(['2', '3', '1']);
    expect(sortSongs(list, 'duration').map((s) => s.id)).toEqual(['2', '1', '3']);
    expect(sortSongs(list, 'newest').map((s) => s.id)).toEqual(['2', '1', '3']);
  });
  it('shuffles a copy with every element kept', () => {
    const out = shuffled(list, () => 0);
    expect(out).toHaveLength(3);
    expect(new Set(out.map((s) => s.id))).toEqual(new Set(['1', '2', '3']));
    expect(list.map((s) => s.id)).toEqual(['1', '2', '3']);
  });
});

describe('collectionText', () => {
  it('emits "Title — Artist" per line, bare title when no artist', () => {
    expect(songLine(song('1', 'Kesariya', 'Arijit Singh'))).toBe('Kesariya — Arijit Singh');
    expect(songLine(song('2', 'Solo', '', { subtitle: '' }))).toBe('Solo');
    expect(collectionToText([song('1', 'A', 'X'), song('2', 'B', 'Y')])).toBe('A — X\nB — Y');
  });
});

describe('collageArt', () => {
  const img = (n: string) => [{ quality: '150x150', url: `https://cdn/${n}-150.jpg` }];
  it('returns up to four distinct artworks and skips the placeholder', () => {
    const songs = [
      song('1', 'a', 'x', { images: img('a') }),
      song('2', 'b', 'x', { images: img('a') }),
      song('3', 'c', 'x'),
      song('4', 'd', 'x', { images: img('b') }),
      song('5', 'e', 'x', { images: img('c') }),
      song('6', 'f', 'x', { images: img('d') }),
      song('7', 'g', 'x', { images: img('e') }),
    ];
    const art = collageArt(songs);
    expect(art).toHaveLength(4);
    expect(new Set(art).size).toBe(4);
    expect(art).not.toContain(FALLBACK_ART);
    expect(collageArt([])).toEqual([]);
  });
});
