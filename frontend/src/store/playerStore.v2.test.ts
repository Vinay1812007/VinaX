// @vitest-environment jsdom
/**
 * VinaX V2 — how the player uses Up Next: a reserve planned for one session
 * is never served to the next one.
 */
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

const song = (id: string, language = 'telugu'): Song => ({
  kind: 'song', id, title: id, subtitle: 'Artist', artists: [], album: null,
  images: [], audio: [], duration: 200, language, year: '2024', explicit: false, hasLyrics: false, playCount: null,
});
const plans: Array<{ songs: Song[]; reserve: Song[] }> = [];
const planMock = vi.fn(async () => {
  const next = plans.shift() ?? { songs: [], reserve: [] };
  return { songs: next.songs, picker: 'local', fallback: null, latencyMs: 0, alg: 'test', relaxed: [], discoveryIds: new Set<string>(), language: null, commit: () => undefined, topUp: () => next.reserve, refinement: null };
});
vi.mock('@/services/nextup/engine', () => ({ warmNextUp: () => undefined, planNextSongs: () => planMock() }));

import { usePlayerStore } from './playerStore';
import { useSettingsStore } from './settingsStore';

beforeEach(() => {
  vi.useFakeTimers();
  plans.length = 0;
  planMock.mockClear();
  useSettingsStore.setState({ kidMode: false, crossfade: false, resumePlayback: false, djTakeover: true, autoplay: true, mutedLanguages: [] });
  usePlayerStore.getState().clearQueue();
  usePlayerStore.setState({ queue: [], index: 0, repeat: 'off', shuffle: false, currentTime: 0, duration: 0, isPlaying: false, tuneIntent: null });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('V2 — the reserve belongs to its session', () => {
  it('a new album never ends on the old session’s reserve', async () => {
    plans.push({ songs: [song('t1')], reserve: [song('t-reserve')] });
    usePlayerStore.getState().playSong(song('telugu-seed'));
    await vi.advanceTimersByTimeAsync(10);
    expect(usePlayerStore.getState().queue.map((s) => s.id)).toEqual(['telugu-seed', 't1']);
    // A Hindi album starts; its plans come back empty (a slow network).
    plans.push({ songs: [], reserve: [] }, { songs: [], reserve: [] }, { songs: [], reserve: [] });
    usePlayerStore.getState().playQueue([song('h1', 'hindi'), song('h2', 'hindi')], 0);
    await vi.advanceTimersByTimeAsync(10);
    usePlayerStore.getState().next(true);
    await vi.advanceTimersByTimeAsync(10);
    usePlayerStore.getState().next(true);
    await vi.advanceTimersByTimeAsync(10);
    usePlayerStore.getState().next(true);
    await vi.advanceTimersByTimeAsync(10);
    const ids = usePlayerStore.getState().queue.map((s) => s.id);
    expect(ids).toEqual(['h1', 'h2']);
    expect(ids).not.toContain('t-reserve');
  });
});
