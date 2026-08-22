import { describe, it, expect, beforeEach } from 'vitest';
import type { Song } from '@/types';
import { dedupeSongs, isValidSong, normTitle, noteUnavailable, queueAfterClearFrom, reorderQueue, resetSkipGuard, sortQueueTail } from './playerGuards';

const song = (id: string, title: string): Song => ({
  kind: 'song',
  id,
  title,
  subtitle: 'Artist',
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
});

describe('skip guard (DQA-01)', () => {
  beforeEach(() => resetSkipGuard());

  it('trips on the 4th consecutive unavailable track, then starts over', () => {
    expect(noteUnavailable()).toBe(false);
    expect(noteUnavailable()).toBe(false);
    expect(noteUnavailable()).toBe(false);
    expect(noteUnavailable()).toBe(true); // 4-strike stop
    expect(noteUnavailable()).toBe(false); // trip self-resets
  });

  it('resetSkipGuard() starts the count over (track finished / manual play)', () => {
    noteUnavailable();
    noteUnavailable();
    noteUnavailable();
    resetSkipGuard();
    expect(noteUnavailable()).toBe(false);
    expect(noteUnavailable()).toBe(false);
    expect(noteUnavailable()).toBe(false);
    expect(noteUnavailable()).toBe(true);
  });

  it('queue de-dupe/normalization must NOT reset the guard (regression: DQA-01)', () => {
    noteUnavailable();
    noteUnavailable();
    noteUnavailable();
    // The original bug: a stray reset inside normTitle() fired on every
    // dedupe/append and silently defeated the 4-strike stop.
    normTitle(song('a', 'Tum Hi Ho'));
    dedupeSongs([song('a', 'Tum Hi Ho'), song('b', 'tum  hi ho '), song('c', 'Vaseegara')]);
    expect(noteUnavailable()).toBe(true); // still the 4th strike
  });
});

describe('dedupeSongs', () => {
  it('drops repeated ids and normalized-title duplicates', () => {
    const out = dedupeSongs([song('a', 'Tum Hi Ho'), song('a', 'Other'), song('b', 'TUM  HI HO'), song('c', 'Vaseegara')]);
    expect(out.map((s) => s.id)).toEqual(['a', 'c']);
  });

  it('keeps songs with empty titles (id-only de-dupe)', () => {
    const out = dedupeSongs([song('a', ''), song('b', ''), song('a', '')]);
    expect(out.map((s) => s.id)).toEqual(['a', 'b']);
  });
});

describe('isValidSong (persist rehydrate guard — DQA-06)', () => {
  it('accepts a complete song', () => {
    expect(isValidSong(song('a', 'Tum Hi Ho'))).toBe(true);
  });

  it('rejects malformed persisted entries', () => {
    expect(isValidSong(null)).toBe(false);
    expect(isValidSong('song')).toBe(false);
    expect(isValidSong({})).toBe(false);
    expect(isValidSong({ id: 'a' })).toBe(false);
    expect(isValidSong({ id: 'a', title: 'T', images: 'not-an-array', audio: [], artists: [] })).toBe(false);
    expect(isValidSong({ id: '', title: 'T', images: [], audio: [], artists: [] })).toBe(false);
  });

  it('accepts minimal-but-safe legacy entries', () => {
    expect(isValidSong({ id: 'a', title: 'T', images: [], audio: [], artists: [] })).toBe(true);
  });
});

describe('queueAfterClearFrom (D5)', () => {
  const q = ['a', 'b', 'c', 'd', 'e'];

  it('sweeps from a future row down, keeping the playing song and history', () => {
    expect(queueAfterClearFrom(q, 1, 3)).toEqual(['a', 'b', 'c']);
    expect(queueAfterClearFrom(q, 0, 1)).toEqual(['a']);
  });

  it('refuses to sweep the playing row, the past, or out-of-range rows', () => {
    expect(queueAfterClearFrom(q, 2, 2)).toBeNull(); // the playing row itself
    expect(queueAfterClearFrom(q, 2, 1)).toBeNull(); // history
    expect(queueAfterClearFrom(q, 2, 5)).toBeNull(); // past the end
    expect(queueAfterClearFrom([], 0, 0)).toBeNull();
  });
});

describe('sortQueueTail (D5)', () => {
  const mk = (id: string, title: string, year: string | null): Song => ({ ...song(id, title), year });
  const list = [
    mk('a', 'Sad Lonely Tears', '2010'),
    mk('b', 'Party Dance Blast', '2024'),
    mk('c', 'Chill Lofi Rain', '2018'),
    mk('d', 'Plain Track', '2001'),
  ];

  it('energy puts bangers first, calm puts them last', () => {
    expect(sortQueueTail(list, 'energy').map((s) => s.id)).toEqual(['b', 'd', 'c', 'a']);
    expect(sortQueueTail(list, 'calm').map((s) => s.id)).toEqual(['a', 'c', 'd', 'b']);
  });

  it('new/old sort by release year with stable ties', () => {
    expect(sortQueueTail(list, 'new').map((s) => s.id)).toEqual(['b', 'c', 'a', 'd']);
    expect(sortQueueTail(list, 'old').map((s) => s.id)).toEqual(['d', 'a', 'c', 'b']);
  });

  it('mood clusters run high-energy to melancholy and never drop songs', () => {
    const out = sortQueueTail(list, 'mood');
    expect(out.map((s) => s.id)).toEqual(['b', 'd', 'c', 'a']);
    expect(out).toHaveLength(list.length);
  });
});

describe('reorderQueue (drag-to-reorder)', () => {
  const q = ['a', 'b', 'c', 'd', 'e'];

  it('moves an upcoming song and leaves the playing index alone', () => {
    // playing 'a' (0); drag 'd' (3) up to slot 1
    const r = reorderQueue(q, 0, 3, 1);
    expect(r?.queue).toEqual(['a', 'd', 'b', 'c', 'e']);
    expect(r?.index).toBe(0);
  });

  it('keeps the index pinned to the SAME song when rows cross it', () => {
    // playing 'c' (2); move 'a' (0) below it → c shifts left
    const down = reorderQueue(q, 2, 0, 3);
    expect(down?.queue).toEqual(['b', 'c', 'd', 'a', 'e']);
    expect(down?.queue[down.index]).toBe('c');
    // playing 'c' (2); move 'e' (4) above it → c shifts right
    const up = reorderQueue(q, 2, 4, 0);
    expect(up?.queue).toEqual(['e', 'a', 'b', 'c', 'd']);
    expect(up?.queue[up.index]).toBe('c');
    // moving the playing song itself follows it
    const self = reorderQueue(q, 2, 2, 0);
    expect(self?.queue[self.index]).toBe('c');
    expect(self?.index).toBe(0);
  });

  it('returns null on no-ops and out-of-range moves (caller skips set())', () => {
    expect(reorderQueue(q, 0, 2, 2)).toBeNull();
    expect(reorderQueue(q, 0, -1, 2)).toBeNull();
    expect(reorderQueue(q, 0, 1, 5)).toBeNull();
    expect(reorderQueue([], 0, 0, 0)).toBeNull();
  });
});
