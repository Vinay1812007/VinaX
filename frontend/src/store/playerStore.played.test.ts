// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';

vi.mock('@/services/audio/engine', () => ({
  audioEngine: { load: vi.fn(), preloadNext: vi.fn(), pause: vi.fn(), play: vi.fn(), seek: vi.fn(), fadeIn: vi.fn(), fadeOut: vi.fn() },
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
const recommendMock = vi.fn(async (_seed: Song): Promise<Song[]> => []);
vi.mock('@/services/nextup/engine', () => ({
  warmNextUp: () => undefined,
  NEXT_URGENT_DEADLINE_MS: 3500,
  planNextSongs: async (seed: Song) => ({ songs: await recommendMock(seed), picker: 'local', fallback: null, latencyMs: 0, alg: 'test', relaxed: [], discoveryIds: new Set<string>(), language: null, commit: () => undefined, topUp: () => [], refinement: null }),
}));

import { usePlayerStore } from './playerStore';
import { useSettingsStore } from './settingsStore';
import { useToastStore } from './toastStore';

const song = (id: string): Song => ({
  kind: 'song', id, title: id, subtitle: 'Artist', artists: [], album: null,
  images: [], audio: [], duration: 200, language: 'telugu', year: '2024',
  explicit: false, hasLyrics: false, playCount: null,
});
const ids = () => usePlayerStore.getState().queue.map((s) => s.id);
const current = () => usePlayerStore.getState().queue[usePlayerStore.getState().index]?.id;
const lastToast = (): string | undefined => { const t = useToastStore.getState().toasts; return t[t.length - 1]?.message; };

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  useSettingsStore.setState({ kidMode: false, crossfade: false, resumePlayback: false, djTakeover: false, autoplay: false });
  usePlayerStore.setState({ queue: [], index: 0, repeat: 'off', shuffle: false, currentTime: 0, duration: 0, isPlaying: false, tuneIntent: null, followMode: false });
  useToastStore.setState({ toasts: [] });
  recommendMock.mockReset();
  recommendMock.mockResolvedValue([]);
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('1.16 — the played part of the queue', () => {
  it('clearPlayed drops only the past and keeps the playing song current', () => {
    usePlayerStore.getState().playQueue(['a', 'b', 'c', 'd'].map(song), 2);
    usePlayerStore.getState().clearPlayed();
    expect(ids()).toEqual(['c', 'd']);
    expect(current()).toBe('c');
    expect(lastToast()).toBe('Cleared 2 played songs');
    usePlayerStore.getState().next();
    usePlayerStore.getState().clearPlayed();
    expect(ids()).toEqual(['d']);
    expect(lastToast()).toBe('Cleared 1 played song');
  });

  it('a song already played can be queued again; one still to come cannot', () => {
    usePlayerStore.getState().playQueue(['a', 'b', 'c'].map(song), 1);
    usePlayerStore.getState().enqueue(song('a'));
    expect(ids()).toEqual(['a', 'b', 'a', 'c']);
    expect(current()).toBe('b');
    usePlayerStore.getState().enqueue(song('c'));
    expect(lastToast()).toBe('Already in queue');
    expect(ids()).toEqual(['a', 'b', 'a', 'c']);
  });

  it('Undo of a removed upcoming song still lands in its place after the played songs are cleared', () => {
    usePlayerStore.getState().playQueue(['a', 'b', 'c', 'd', 'e'].map(song), 2);
    usePlayerStore.getState().removeAt(4); // e
    usePlayerStore.getState().clearPlayed();
    expect(usePlayerStore.getState().undoRemove()).toBe(true);
    expect(ids()).toEqual(['c', 'd', 'e']);
    expect(current()).toBe('c');
  });

  it('clearing the played songs while Up next waits for more starts the right song', async () => {
    useSettingsStore.setState({ autoplay: true });
    usePlayerStore.getState().playQueue(['a', 'b', 'c'].map(song), 2);
    await vi.advanceTimersByTimeAsync(10); // the first, empty top-up settles
    let resolve: (songs: Song[]) => void = () => undefined;
    recommendMock.mockImplementation(() => new Promise<Song[]>((r) => { resolve = r; }));
    usePlayerStore.getState().next();
    await vi.advanceTimersByTimeAsync(0);
    expect(current()).toBe('c'); // still waiting
    usePlayerStore.getState().clearPlayed();
    // Four new songs: the old code jumped to row 3 (where the queue used to end), i.e. n3.
    resolve(['n1', 'n2', 'n3', 'n4'].map(song));
    await vi.advanceTimersByTimeAsync(10);
    expect(ids()).toEqual(['c', 'n1', 'n2', 'n3', 'n4']);
    expect(current()).toBe('n1');
  });
});
