// @vitest-environment jsdom
/**
 * 8.5.0 — the two listening signals the profile did not learn from before:
 * "Not interested" on one song, and a song filed into the listener's own
 * playlist.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';

vi.mock('@/services/storage/idb', () => ({ addEvent: vi.fn(async () => undefined), clearEvents: vi.fn(async () => undefined) }));

import { EVENT_WEIGHTS } from './eventWeights';
import { loadProfile, resetProfile } from './storage';
import { recordDislike, recordFavorite, recordPlay, recordPlaylistAdd } from './updater';
import { getSessionIntent } from './sessionIntent';
import { addEvent } from '@/services/storage/idb';

const song = (id: string, artist = 'Artist One', language = 'telugu'): Song => ({
  kind: 'song',
  id,
  title: `Song ${id}`,
  subtitle: artist,
  artists: [{ id: `a-${artist}`, name: artist }],
  album: null,
  images: [],
  audio: [],
  duration: 200,
  language,
  year: '2024',
  explicit: false,
  hasLyrics: false,
  playCount: null,
});

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  await resetProfile();
  vi.mocked(addEvent).mockClear();
});

describe('recordDislike', () => {
  it('costs the song and its artist two skips’ worth but never touches the language', () => {
    const s = song('s1');
    for (let i = 0; i < 4; i += 1) recordPlay(s);
    const before = loadProfile();
    const artistBefore = before.artists['a-Artist One'].score;
    const languageBefore = before.languages.telugu.score;
    const songBefore = before.songs?.s1.score ?? 0;

    recordDislike(s, true);

    const p = loadProfile();
    expect(p.artists['a-Artist One'].score).toBeCloseTo(artistBefore + EVENT_WEIGHTS.DISLIKE);
    expect(p.songs?.s1.score).toBeCloseTo(Math.max(0, songBefore + EVENT_WEIGHTS.DISLIKE));
    expect(p.languages.telugu.score).toBe(languageBefore);
    expect(p.dislikedSongIds).toEqual(['s1']);
    expect(p.totals.dislikes).toBe(1);
    // A dislike is not a skip: the skip counters that feed the skip-rate stay put.
    expect(p.totals.skips).toBe(0);
    expect(p.artists['a-Artist One'].skips).toBe(0);
    expect(addEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'dislike', songId: 's1' }));
  });

  it('drops the song from the liked list, and pushes the artist away for this sitting', () => {
    const s = song('s2', 'Artist Two');
    recordFavorite(s, true);
    expect(loadProfile().likedSongIds).toContain('s2');
    recordDislike(s, true);
    expect(loadProfile().likedSongIds).not.toContain('s2');
    const intent = getSessionIntent();
    expect(intent.artistPull['artist two']).toBeLessThan(0);
    expect(intent.skippedSongIds.has('s2')).toBe(true);
    // Not a verdict on the language, and not a skip streak.
    expect(intent.languagePull.telugu ?? 0).toBeGreaterThanOrEqual(0);
    expect(intent.skipStreak).toBe(0);
  });

  it('undo forgets the song without handing points back (scores are floored at zero)', () => {
    const s = song('s3', 'Brand New Artist');
    recordDislike(s, true);
    const scored = loadProfile().artists['a-Brand New Artist'].score;
    expect(scored).toBe(0);
    recordDislike(s, false);
    const p = loadProfile();
    expect(p.dislikedSongIds).toEqual([]);
    expect(p.artists['a-Brand New Artist'].score).toBe(0); // never net positive
    expect(p.totals.dislikes).toBe(1);
  });

  it('keeps the newest 200 dislikes without duplicates', () => {
    for (let i = 0; i < 205; i += 1) recordDislike(song(`d${i}`), true);
    recordDislike(song('d204'), true);
    const ids = loadProfile().dislikedSongIds ?? [];
    expect(ids).toHaveLength(200);
    expect(ids[0]).toBe('d204');
    expect(new Set(ids).size).toBe(200);
  });
});

describe('recordPlaylistAdd', () => {
  it('is worth a play for the song, its artists and its language', () => {
    recordPlaylistAdd(song('p1', 'Artist Three', 'hindi'));
    const p = loadProfile();
    expect(p.artists['a-Artist Three'].score).toBeCloseTo(EVENT_WEIGHTS.PLAYLIST_ADD);
    expect(p.languages.hindi.score).toBeCloseTo(EVENT_WEIGHTS.PLAYLIST_ADD);
    expect(p.songs?.p1.score).toBeCloseTo(EVENT_WEIGHTS.PLAYLIST_ADD);
    expect(p.totals.playlistAdds).toBe(1);
    // A signal, not a play: play counts are for real listening.
    expect(p.totals.plays).toBe(0);
    expect(p.artists['a-Artist Three'].plays).toBe(0);
    expect(addEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'playlist_add', songId: 'p1' }));
  });
});

describe('profile persistence', () => {
  it('a reload keeps the 8.5.0 fields', async () => {
    recordDislike(song('k1'), true);
    recordPlaylistAdd(song('k2'));
    vi.resetModules();
    // Force the debounced write to land, then read the stored record through a fresh module.
    window.dispatchEvent(new Event('pagehide'));
    const fresh = await import('./storage');
    const p = fresh.loadProfile();
    expect(p.dislikedSongIds).toEqual(['k1']);
    expect(p.totals.dislikes).toBe(1);
    expect(p.totals.playlistAdds).toBe(1);
  });
});

describe('one sitting’s share of the long-term profile (9.0.0)', () => {
  it('a party night of forty plays by one artist teaches about as much as fourteen ordinary plays — never forty', async () => {
    const { resetSittingDamping } = await import('./updater');
    resetSittingDamping();
    for (let i = 0; i < 40; i += 1) recordPlay(song(`p${i}`, 'Party Voice', 'punjabi'));
    const p = loadProfile();
    // 8 in full, 12 at half, 20 at a quarter = 8 + 6 + 5 = 19 play-weights (8.x: 40).
    expect(p.artists['a-Party Voice'].score).toBeCloseTo(EVENT_WEIGHTS.PLAY * 19, 5);
    // The language allowance is larger: 12 in full, 18 at half, 10 at a quarter = 23.5.
    expect(p.languages.punjabi.score).toBeCloseTo(EVENT_WEIGHTS.PLAY * 23.5, 5);
    // Each song still counts once, in full.
    expect(p.songs?.p39.score).toBeCloseTo(EVENT_WEIGHTS.PLAY, 5);
  });

  it('explicit signals always count in full, and a new sitting starts the allowance again', async () => {
    const { resetSittingDamping } = await import('./updater');
    resetSittingDamping();
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_000_000);
    const s = song('fav', 'Loved Voice');
    for (let i = 0; i < 25; i += 1) recordPlay(song(`q${i}`, 'Loved Voice'));
    const before = loadProfile().artists['a-Loved Voice'].score;
    recordFavorite(s, true);
    expect(loadProfile().artists['a-Loved Voice'].score - before).toBeCloseTo(EVENT_WEIGHTS.FAVORITE, 5);
    // An hour of silence later, plays count in full again.
    vi.setSystemTime(1_800_000_000_000 + 60 * 60_000);
    const again = loadProfile().artists['a-Loved Voice'].score;
    recordPlay(song('next', 'Loved Voice'));
    expect(loadProfile().artists['a-Loved Voice'].score - again).toBeGreaterThan(EVENT_WEIGHTS.PLAY * 0.9);
    vi.useRealTimers();
  });
});
