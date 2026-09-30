// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';

vi.mock('@/services/audio/engine', () => ({
  audioEngine: { load: vi.fn(), preloadNext: vi.fn(), pause: vi.fn(), play: vi.fn(), seek: vi.fn(), setVolume: vi.fn() },
  orderedSources: () => [],
}));
vi.mock('@/services/media-session', () => ({ setMediaHandlers: vi.fn(), updateMediaMetadata: vi.fn(), updatePlaybackState: vi.fn(), updatePositionState: vi.fn() }));
vi.mock('@/services/personalization/updater', () => ({ recordComplete: vi.fn(), recordPlay: vi.fn(), recordQueueAdd: vi.fn(), recordSkip: vi.fn(), recordFavorite: vi.fn() }));
vi.mock('@/services/native', () => ({ checkNotificationOnFirstPlay: vi.fn(), haptic: vi.fn(), isNativePlatform: () => false, platformName: () => 'web' }));
vi.mock('@/services/cast', () => ({ useCastStore: { getState: () => ({ connected: false }) }, castInterceptPlayPause: () => false, castInterceptSeek: () => false, castInterceptVolume: () => false, castMime: vi.fn() }));
vi.mock('@/utils/streak', () => ({ bumpStreak: vi.fn() }));

import { usePlayerStore } from '@/store/playerStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useHistoryStore } from '@/store/historyStore';
import { useSettingsStore } from '@/store/settingsStore';
import { noteCompleted, noteLikeAndMaybeReplan, noteSkipAndMaybeReplan, resetAdaptive, shapeForSession, sureSongIds } from './adaptive';

const song = (id: string, artist = 'Artist', extra: Partial<Song> = {}): Song => ({
  kind: 'song', id, title: `Song ${id}`, subtitle: artist, artists: [{ id: `a-${artist}`, name: artist }], album: null,
  images: [], audio: [], duration: 200, language: 'telugu', year: '2024', explicit: false, hasLyrics: false, playCount: null, ...extra,
});

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetAdaptive();
  useSettingsStore.setState({ kidMode: false, crossfade: false, resumePlayback: false, mutedLanguages: [], djTakeover: false });
  useLibraryStore.setState({ favorites: [], collections: [], saved: [], hiddenSongIds: [], later: [], hiddenArtists: [], trash: [] });
  useHistoryStore.setState({ entries: [] });
  usePlayerStore.setState({ queue: [], index: 0, repeat: 'off', shuffle: false, currentTime: 0, duration: 0, isPlaying: false });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('player store auto tail', () => {
  it('replaceAutoTail keeps the current song and hand-queued songs, swaps only the recommender tail', () => {
    const p = usePlayerStore.getState();
    p.playQueue([song('cur'), song('hand1')], 0);
    p.replaceAutoTail([song('auto1'), song('auto2')]); // first fill = marks these as auto
    expect(usePlayerStore.getState().queue.map((s) => s.id)).toEqual(['cur', 'hand1', 'auto1', 'auto2']);
    expect(usePlayerStore.getState().isAutoQueued('auto1')).toBe(true);
    expect(usePlayerStore.getState().isAutoQueued('hand1')).toBe(false);
    usePlayerStore.getState().replaceAutoTail([song('new1'), song('hand1'), song('new2')]);
    expect(usePlayerStore.getState().queue.map((s) => s.id)).toEqual(['cur', 'hand1', 'new1', 'new2']);
    expect(usePlayerStore.getState().autoTail().map((s) => s.id)).toEqual(['new1', 'new2']);
  });

  it('applyPlan replaces the queue or appends after the current song without duplicates', () => {
    const p = usePlayerStore.getState();
    p.playQueue([song('cur'), song('later')], 0);
    usePlayerStore.getState().applyPlan([song('a'), song('cur'), song('b')], 'append');
    expect(usePlayerStore.getState().queue.map((s) => s.id)).toEqual(['cur', 'a', 'b']);
    usePlayerStore.getState().applyPlan([song('x'), song('y')], 'replace');
    expect(usePlayerStore.getState().queue.map((s) => s.id)).toEqual(['x', 'y']);
    expect(usePlayerStore.getState().index).toBe(0);
  });
});

describe('adaptive re-plan', () => {
  it('two skips inside the auto tail re-sequence it with a sure favourite first; hand-queued skips do not', () => {
    const fav = song('fav', 'Loved', { energy: 0.6 });
    useLibraryStore.setState({ favorites: [fav] });
    const p = usePlayerStore.getState();
    p.playQueue([song('cur', 'Seed', { energy: 0.5 })], 0);
    usePlayerStore.getState().replaceAutoTail([song('t1', 'X', { energy: 0.2 }), song('t2', 'Y', { energy: 0.9 }), song('t3', 'Z', { energy: 0.3 }), song('t4', 'W', { energy: 0.5 })]);
    expect(noteSkipAndMaybeReplan(song('t1', 'X'))).toBe(false);
    expect(noteSkipAndMaybeReplan(song('t2', 'Y'))).toBe(true);
    const tail = usePlayerStore.getState().autoTail().map((s) => s.id);
    expect(tail[0]).toBe('fav');
    expect(usePlayerStore.getState().queue[0].id).toBe('cur');
    // A hand-queued skip resets the streak.
    usePlayerStore.getState().enqueue(song('hand'));
    expect(noteSkipAndMaybeReplan(song('hand'))).toBe(false);
    noteCompleted();
    expect(noteSkipAndMaybeReplan(song('t3', 'Z'))).toBe(false);
  });

  it('shapeForSession and sureSongIds read the local signals', () => {
    expect(['steady', 'wind-down', 'lift']).toContain(shapeForSession(new Date('2026-09-16T14:00:00')));
    useLibraryStore.setState({ favorites: [song('f1')] });
    useHistoryStore.setState({ entries: [{ song: song('h1'), ts: 1, completed: true }, { song: song('h1'), ts: 2, completed: true }, { song: song('h2'), ts: 3, completed: true }] });
    const sure = sureSongIds();
    expect(sure.has('f1')).toBe(true);
    expect(sure.has('h1')).toBe(true);
    expect(sure.has('h2')).toBe(false);
  });
});

describe('8.5.0 — a like on the playing song re-plans the automatic tail', () => {
  const setup = () => {
    const regenerate = vi.fn();
    const p = usePlayerStore.getState();
    p.playQueue([song('cur', 'Loved'), song('hand1')], 0);
    p.replaceAutoTail([song('a1', 'X'), song('a2', 'Y'), song('a3', 'Z')]);
    usePlayerStore.setState({ regenerateAutoTail: regenerate });
    return regenerate;
  };

  it('rebuilds once, then waits out the cooldown', () => {
    const regenerate = setup();
    const now = Date.now();
    expect(noteLikeAndMaybeReplan(song('cur', 'Loved'), now)).toBe(true);
    expect(regenerate).toHaveBeenCalledTimes(1);
    expect(noteLikeAndMaybeReplan(song('cur', 'Loved'), now + 30_000)).toBe(false);
    expect(noteLikeAndMaybeReplan(song('cur', 'Loved'), now + 91_000)).toBe(true);
    expect(regenerate).toHaveBeenCalledTimes(2);
  });

  it('ignores a like on a song that is not playing, and a queue with no automatic tail to rebuild', () => {
    const regenerate = setup();
    expect(noteLikeAndMaybeReplan(song('a2', 'Y'))).toBe(false);
    usePlayerStore.getState().playQueue([song('solo')], 0);
    expect(noteLikeAndMaybeReplan(song('solo'))).toBe(false);
    expect(regenerate).not.toHaveBeenCalled();
  });

  it('shares the cooldown with the skip re-plan, so likes and skips never churn the queue', () => {
    setup();
    const now = Date.now();
    expect(noteLikeAndMaybeReplan(song('cur', 'Loved'), now)).toBe(true);
    const tail = usePlayerStore.getState().autoTail();
    expect(noteSkipAndMaybeReplan(tail[0], now + 1_000)).toBe(false);
    expect(noteSkipAndMaybeReplan(tail[1], now + 2_000)).toBe(false);
  });
});
