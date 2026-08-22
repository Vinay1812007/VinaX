import { describe, it, expect, beforeEach } from 'vitest';
import type { Song } from '@/types';
import { dedupeSongs, isValidSong, normTitle, noteUnavailable, resetSkipGuard } from './playerGuards';

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
