// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';

/**
 * 1.16 — crossfade overlaps the end of a song with the next one: the store
 * asks the engine to overlap inside the last crossfadeSeconds, credits the
 * outgoing song as ended and starts the next one fading in over the overlap.
 */
interface EngineHandlers { onTime(currentTime: number, duration: number): void; onEnded(): void }
const engine = vi.hoisted(() => ({ handlers: null as EngineHandlers | null }));
vi.mock('@/services/audio/engine', () => ({
  audioEngine: {
    init: vi.fn((h: EngineHandlers) => { engine.handlers = h; }),
    load: vi.fn(), preloadNext: vi.fn(), pause: vi.fn(), play: vi.fn(), seek: vi.fn(),
    setVolume: vi.fn(), setMuted: vi.fn(), setRate: vi.fn(), fadeIn: vi.fn(), fadeOut: vi.fn(), fadeOutAndPause: vi.fn(),
    overlap: vi.fn(() => true),
    currentSongId: null,
  },
  orderedSources: () => [],
}));
vi.mock('@/services/media-session', () => ({ setMediaHandlers: vi.fn(), updateMediaMetadata: vi.fn(), updatePlaybackState: vi.fn(), updatePositionState: vi.fn() }));
vi.mock('@/services/personalization/updater', () => ({ recordComplete: vi.fn(), recordPlay: vi.fn(), recordQueueAdd: vi.fn(), recordSkip: vi.fn() }));
vi.mock('@/services/native', () => ({ checkNotificationOnFirstPlay: vi.fn(), haptic: vi.fn(), isNativePlatform: () => false }));
const cast = vi.hoisted(() => ({ connected: false }));
vi.mock('@/services/cast', () => ({ useCastStore: { getState: () => cast }, castInterceptPlayPause: () => false, castInterceptSeek: () => false, castInterceptVolume: () => false, castMime: vi.fn(), castLoadSong: vi.fn() }));
vi.mock('@/services/analytics/telemetry', () => ({ trackSkip: vi.fn(), trackComplete: vi.fn() }));
vi.mock('@/services/recommendation/adaptive', () => ({ noteSkipAndMaybeReplan: vi.fn(), noteCompleted: vi.fn() }));
vi.mock('@/services/nextup/engine', () => ({
  warmNextUp: () => undefined,
  notePlayed: () => undefined,
  NEXT_URGENT_DEADLINE_MS: 3500,
  planNextSongs: async () => ({ songs: [], picker: 'local', fallback: null, latencyMs: 0, alg: 'test', relaxed: [], discoveryIds: new Set<string>(), language: null, commit: () => undefined, topUp: () => [], refinement: null }),
}));

import { audioEngine } from '@/services/audio/engine';
import { recordComplete } from '@/services/personalization/updater';
import { useTogether } from '@/services/together/session';
import { usePlayerStore } from './playerStore';
import { useSettingsStore } from './settingsStore';
import { useHistoryStore } from './historyStore';

const song = (id: string, quality = '320kbps'): Song => ({ kind: 'song', id, title: id, subtitle: 'Artist', artists: [{ id: `a-${id}`, name: `Artist ${id}` }], album: null, images: [], audio: [{ quality, url: `https://cdn.test/${id}_320.mp4` }], duration: 200, language: 'telugu', year: '2024', explicit: false, hasLyrics: false, playCount: null });
const listen = (from: number, to: number, d = 200) => { for (let t = from; t <= to + 1e-9; t += 0.25) engine.handlers?.onTime(Math.round(t * 100) / 100, d); };
const loaded = () => vi.mocked(audioEngine.load).mock.calls.map((c) => c[0].id);

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  cast.connected = false;
  useTogether.getState().reset();
  useHistoryStore.setState({ entries: [] });
  useSettingsStore.setState({ kidMode: false, crossfade: true, crossfadeSeconds: 5, resumePlayback: false, djTakeover: false, autoplay: false, mutedLanguages: [] });
  usePlayerStore.getState().clearQueue();
  usePlayerStore.setState({ queue: [], index: 0, repeat: 'off', shuffle: false, currentTime: 0, duration: 0, isPlaying: false, tuneIntent: null, sleepAt: null, sleepSongsLeft: 0, sleepAfterTrack: false, loopA: null, loopB: null, volume: 0.8, muted: false, rate: 1 });
  usePlayerStore.getState().initEngine();
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('crossfade overlap', () => {
  it('starts the next song crossfadeSeconds before the end, fading in over the overlap, and credits the song that ended', () => {
    usePlayerStore.getState().playQueue([song('a'), song('b')], 0);
    listen(0, 194);
    expect(audioEngine.overlap).not.toHaveBeenCalled();
    listen(194.25, 195);
    expect(audioEngine.overlap).toHaveBeenCalledTimes(1);
    expect(vi.mocked(audioEngine.overlap).mock.calls[0][0]).toBeCloseTo(5000);
    expect(usePlayerStore.getState().index).toBe(1);
    expect(loaded()).toEqual(['a', 'b']);
    expect(vi.mocked(audioEngine.fadeIn).mock.lastCall?.[0]).toBeCloseTo(5000);
    expect(recordComplete).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), expect.any(Number));
    expect(audioEngine.fadeOut).not.toHaveBeenCalled();
  });

  it('only fades the song out where the engine cannot overlap (iPhone Safari, the sound chain on)', () => {
    vi.mocked(audioEngine.overlap).mockReturnValueOnce(false);
    usePlayerStore.getState().playQueue([song('a'), song('b')], 0);
    listen(0, 196);
    expect(audioEngine.overlap).toHaveBeenCalledTimes(1);
    expect(audioEngine.fadeOut).toHaveBeenCalledTimes(1);
    expect(usePlayerStore.getState().index).toBe(0);
  });

  it('a manual skip keeps the short fade-in', () => {
    usePlayerStore.getState().playQueue([song('a'), song('b')], 0);
    listen(0, 30);
    usePlayerStore.getState().next(true);
    expect(vi.mocked(audioEngine.fadeIn).mock.lastCall?.[0]).toBe(1200);
    expect(audioEngine.overlap).not.toHaveBeenCalled();
  });

  it('does nothing with crossfade off, before a podcast episode, on repeat-one, while casting, in Listen Together or in karaoke', () => {
    const cases: Array<() => void> = [
      () => useSettingsStore.setState({ crossfade: false }),
      () => usePlayerStore.setState({ queue: [song('a'), song('ep', 'original')] }),
      () => usePlayerStore.setState({ repeat: 'one' }),
      () => { cast.connected = true; },
      () => useTogether.getState().begin('host', 'ABCD12'),
      () => window.history.pushState({}, '', '/karaoke'),
    ];
    for (const arrange of cases) {
      usePlayerStore.getState().playQueue([song('a'), song('b')], 0);
      arrange();
      listen(0, 199);
      expect(audioEngine.overlap).not.toHaveBeenCalled();
      expect(audioEngine.fadeOut).not.toHaveBeenCalled();
      useTogether.getState().reset();
      window.history.pushState({}, '', '/');
      cast.connected = false;
      useSettingsStore.setState({ crossfade: true });
      usePlayerStore.setState({ repeat: 'off' });
    }
  });

  it('with a sleep timer set the song only fades out', () => {
    usePlayerStore.getState().playQueue([song('a'), song('b')], 0);
    usePlayerStore.setState({ sleepAfterTrack: true });
    listen(0, 196);
    expect(audioEngine.overlap).not.toHaveBeenCalled();
    expect(audioEngine.fadeOut).toHaveBeenCalledTimes(1);
  });
});
