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
  castInterceptPlayPause: () => false, castInterceptSeek: () => false, castMime: vi.fn(),
}));
vi.mock('@/utils/streak', () => ({ bumpStreak: vi.fn() }));

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
  useSettingsStore.setState({ kidMode: false, crossfade: false, resumePlayback: false });
  usePlayerStore.setState({ queue: [], index: 0, repeat: 'off', shuffle: false, currentTime: 0, duration: 0, isPlaying: false });
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
