// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';

vi.mock('@/services/audio/engine', () => ({
  audioEngine: { load: vi.fn(), preloadNext: vi.fn(), pause: vi.fn(), play: vi.fn(), seek: vi.fn() },
  orderedSources: () => [],
}));
vi.mock('@/services/media-session', () => ({
  setMediaHandlers: vi.fn(), updateMediaMetadata: vi.fn(), updatePlaybackState: vi.fn(), updatePositionState: vi.fn(),
}));
vi.mock('@/services/personalization/updater', () => ({
  recordComplete: vi.fn(), recordPlay: vi.fn(), recordQueueAdd: vi.fn(), recordSkip: vi.fn(),
}));
vi.mock('@/services/native', () => ({ checkNotificationOnFirstPlay: vi.fn(), haptic: vi.fn(), isNativePlatform: () => false }));
vi.mock('@/services/cast', () => ({
  useCastStore: { getState: () => ({ connected: false }) },
  castInterceptPlayPause: () => false, castInterceptSeek: () => false, castInterceptVolume: () => false, castMime: vi.fn(),
}));
vi.mock('@/utils/streak', () => ({ bumpStreak: vi.fn() }));
const recommendMock = vi.fn(async (_seed: Song, _ctx: unknown, _opts?: { tune?: string | null }): Promise<Song[]> => []);
vi.mock('@/services/nextup/engine', () => ({
  warmNextUp: () => undefined,
  NEXT_URGENT_DEADLINE_MS: 3500,
  planNextSongs: async (seed: Song, ctx: unknown, opts?: { tune?: string | null }) => ({ songs: await recommendMock(seed, ctx, opts), picker: 'local', fallback: null, latencyMs: 0, alg: 'test', relaxed: [], discoveryIds: new Set<string>(), language: null, commit: () => undefined, topUp: () => [], refinement: null }),
}));

import { audioEngine } from '@/services/audio/engine';
import { usePlayerStore } from './playerStore';
import { useSettingsStore } from './settingsStore';

const song = (id: string, explicit = false): Song => ({
  kind: 'song', id, title: id, subtitle: 'Artist', artists: [], album: null,
  images: [], audio: [], duration: 200, language: 'telugu', year: '2024',
  explicit, hasLyrics: false, playCount: null,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  // The list-playback contract below is exercised with the DJ takeover off; its own tests follow.
  useSettingsStore.setState({ kidMode: false, crossfade: false, resumePlayback: false, djTakeover: false, autoplay: true });
  usePlayerStore.setState({ queue: [], index: 0, repeat: 'off', shuffle: false, currentTime: 0, duration: 0, isPlaying: false, tuneIntent: null });
  recommendMock.mockReset();
  recommendMock.mockResolvedValue([]);
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('selected queue playback', () => {
  it('keeps the full album and begins at the selected song', () => {
    const album = [song('a'), song('b'), song('c')];
    usePlayerStore.getState().playQueue(album, 1);
    expect(usePlayerStore.getState().queue).toEqual(album);
    expect(usePlayerStore.getState().index).toBe(1);
    expect(audioEngine.load).toHaveBeenLastCalledWith(album[1], expect.any(String), true);
    usePlayerStore.getState().next();
    expect(usePlayerStore.getState().index).toBe(2);
    usePlayerStore.getState().next();
    expect(audioEngine.pause).toHaveBeenCalledOnce();
    expect(usePlayerStore.getState().queue).toEqual(album);
  });

  it('stops after a single song without appending suggestions', async () => {
    usePlayerStore.getState().playSong(song('solo'));
    usePlayerStore.setState({ isPlaying: true });
    usePlayerStore.getState().next();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(usePlayerStore.getState().queue.map(s => s.id)).toEqual(['solo']);
    expect(usePlayerStore.getState().isPlaying).toBe(false);
    expect(audioEngine.load).toHaveBeenCalledOnce();
  });

  it('keeps manually queued tracks next and supports repeat all', () => {
    usePlayerStore.getState().playQueue([song('a'), song('b')]);
    usePlayerStore.getState().enqueueNext(song('manual'));
    usePlayerStore.getState().next();
    expect(usePlayerStore.getState().queue[usePlayerStore.getState().index].id).toBe('manual');
    usePlayerStore.getState().next();
    usePlayerStore.setState({ repeat: 'all' });
    usePlayerStore.getState().next();
    expect(usePlayerStore.getState().index).toBe(0);
  });

  it('filters explicit album tracks without shifting the selected song', () => {
    useSettingsStore.setState({ kidMode: true });
    const album = [song('explicit', true), song('selected'), song('last')];
    usePlayerStore.getState().playQueue(album, 1);
    expect(usePlayerStore.getState().queue.map(s => s.id)).toEqual(['selected', 'last']);
    expect(usePlayerStore.getState().index).toBe(0);
    usePlayerStore.getState().playQueue(album, 0);
    expect(audioEngine.load).toHaveBeenCalledOnce();
  });

  it('exhausts a shuffled queue and starts a fresh session when replayed', () => {
    const album = [song('a'), song('b'), song('c')];
    usePlayerStore.setState({ shuffle: true });
    usePlayerStore.getState().playQueue(album);
    usePlayerStore.getState().next();
    usePlayerStore.getState().next();
    expect(new Set(vi.mocked(audioEngine.load).mock.calls.map(call => call[0].id)).size).toBe(3);
    usePlayerStore.getState().next();
    expect(audioEngine.pause).toHaveBeenCalledOnce();
    usePlayerStore.getState().playQueue(album);
    usePlayerStore.getState().next();
    expect(audioEngine.load).toHaveBeenCalledTimes(5);
  });
});

describe('v6.5.0 — DJ takeover and Tune this queue', () => {
  it('V2 — with the takeover on, a tapped list still plays in full; Up Next continues after its last song', async () => {
    useSettingsStore.setState({ djTakeover: true });
    recommendMock.mockResolvedValue([song('dj1'), song('dj2')]);
    const album = [song('a'), song('b'), song('c'), song('d'), song('e'), song('f')];
    usePlayerStore.getState().playQueue(album, 1);
    expect(usePlayerStore.getState().queue.map((s) => s.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(usePlayerStore.getState().index).toBe(1);
    await vi.advanceTimersByTimeAsync(10);
    // Four songs of the list are still to come: nothing automatic yet.
    expect(recommendMock).not.toHaveBeenCalled();
    usePlayerStore.getState().playAt(4);
    await vi.advanceTimersByTimeAsync(10);
    expect(recommendMock).toHaveBeenCalledOnce();
    expect(usePlayerStore.getState().queue.map((s) => s.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'dj1', 'dj2']);
    expect(usePlayerStore.getState().isAutoQueued('dj1')).toBe(true);
    expect(usePlayerStore.getState().isAutoQueued('f')).toBe(false);
  });

  it('V2 — a single tapped song is still a seed the DJ continues from', async () => {
    useSettingsStore.setState({ djTakeover: true });
    recommendMock.mockResolvedValue([song('dj1')]);
    usePlayerStore.getState().playQueue([song('solo')], 0);
    await vi.advanceTimersByTimeAsync(10);
    expect(usePlayerStore.getState().queue.map((s) => s.id)).toEqual(['solo', 'dj1']);
  });

  it('V2 — under shuffle the whole list plays before any automatic song', async () => {
    recommendMock.mockResolvedValue([song('dj1'), song('dj2')]);
    usePlayerStore.setState({ shuffle: true });
    usePlayerStore.getState().playQueue([song('a'), song('b'), song('c'), song('d')], 0);
    await vi.advanceTimersByTimeAsync(10);
    expect(recommendMock).not.toHaveBeenCalled();
    const heard = new Set([usePlayerStore.getState().queue[usePlayerStore.getState().index].id]);
    for (let i = 0; i < 3; i += 1) {
      usePlayerStore.getState().next(true);
      await vi.advanceTimersByTimeAsync(10);
      heard.add(usePlayerStore.getState().queue[usePlayerStore.getState().index].id);
    }
    expect([...heard].sort()).toEqual(['a', 'b', 'c', 'd']);
    usePlayerStore.getState().next(true);
    await vi.advanceTimersByTimeAsync(10);
    expect(usePlayerStore.getState().queue[usePlayerStore.getState().index].id).toMatch(/^dj/);
    usePlayerStore.setState({ shuffle: false });
  });

  it('keeps the list when the caller insists (Queue Builder plans) or when autoplay is off', async () => {
    useSettingsStore.setState({ djTakeover: true });
    const album = [song('a'), song('b'), song('c')];
    usePlayerStore.getState().playQueue(album, 0, { keepList: true });
    expect(usePlayerStore.getState().queue).toEqual(album);
    useSettingsStore.setState({ autoplay: false });
    usePlayerStore.getState().playQueue(album, 2);
    expect(usePlayerStore.getState().queue).toEqual(album);
    expect(usePlayerStore.getState().index).toBe(2);
    await vi.advanceTimersByTimeAsync(10);
    expect(recommendMock).not.toHaveBeenCalled();
  });

  it('tuneQueue keeps what played, the current song and the list the listener started, and rebuilds the automatic picks', async () => {
    usePlayerStore.getState().playQueue([song('a'), song('b'), song('c'), song('d')], 1);
    recommendMock.mockResolvedValue([song('t1'), song('t2')]);
    usePlayerStore.getState().tuneQueue('chill');
    expect(usePlayerStore.getState().tuneIntent).toBe('chill');
    // 7.2.0 — c and d came from the list the listener started, not from the
    // recommender: a rebuild replaces the DJ's picks only.
    expect(usePlayerStore.getState().queue.map((s) => s.id)).toEqual(['a', 'b', 'c', 'd']);
    await vi.advanceTimersByTimeAsync(10);
    expect(recommendMock).toHaveBeenCalledOnce();
    expect(recommendMock.mock.calls[0][2]).toMatchObject({ tune: 'chill' });
    expect(usePlayerStore.getState().queue.map((s) => s.id)).toEqual(['a', 'b', 'c', 'd', 't1', 't2']);
    // "Surprise me" resolves to a concrete intent.
    usePlayerStore.getState().tuneQueue('surprise');
    expect(usePlayerStore.getState().tuneIntent).not.toBe('surprise');
    expect(usePlayerStore.getState().tuneIntent).not.toBeNull();
    usePlayerStore.getState().playQueue([song('z')], 0);
    expect(usePlayerStore.getState().tuneIntent).toBeNull();
  });
});
