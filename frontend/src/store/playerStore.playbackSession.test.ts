// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';

/**
 * 7.1.1 — one playback-session measurement contract. What the taste profile,
 * transition memory and the listen clock learn from a play is what was HEARD:
 * seeks, pauses, buffering and failed playback add nothing. Review probe 1
 * (2026-09-19): seeking straight to 180 s of a 200 s track used to count as a
 * play, and reaching the end by seeking used to count as a completion.
 */
interface EngineHandlers {
  onTime(currentTime: number, duration: number): void;
  onEnded(): void;
  onFatalError(songId: string): void;
  onPlayState(playing: boolean): void;
}
const engine = vi.hoisted(() => ({ handlers: null as EngineHandlers | null }));
vi.mock('@/services/audio/engine', () => ({
  audioEngine: {
    init: vi.fn((h: EngineHandlers) => { engine.handlers = h; }),
    load: vi.fn(), preloadNext: vi.fn(), pause: vi.fn(), play: vi.fn(), seek: vi.fn(),
    setVolume: vi.fn(), setMuted: vi.fn(), setRate: vi.fn(), fadeIn: vi.fn(), fadeOut: vi.fn(), fadeOutAndPause: vi.fn(),
    reloadWithSources: vi.fn(() => true),
    currentSongId: null,
  },
  orderedSources: () => ['https://cdn.test/a.mp3'],
}));
vi.mock('@/services/media-session', () => ({ setMediaHandlers: vi.fn(), updateMediaMetadata: vi.fn(), updatePlaybackState: vi.fn(), updatePositionState: vi.fn() }));
vi.mock('@/services/personalization/updater', () => ({ recordComplete: vi.fn(), recordPlay: vi.fn(), recordQueueAdd: vi.fn(), recordSkip: vi.fn() }));
vi.mock('@/services/native', () => ({ checkNotificationOnFirstPlay: vi.fn(), haptic: vi.fn(), isNativePlatform: () => false, platformName: () => 'web' }));
vi.mock('@/services/cast', () => ({ useCastStore: { getState: () => ({ connected: false }) }, castInterceptPlayPause: () => false, castInterceptSeek: () => false, castInterceptVolume: () => false, castMime: vi.fn() }));
vi.mock('@/utils/streak', () => ({ bumpStreak: vi.fn() }));
vi.mock('@/services/analytics/telemetry', () => ({ trackSkip: vi.fn(), trackComplete: vi.fn() }));
vi.mock('@/services/recommendation/adaptive', () => ({ noteSkipAndMaybeReplan: vi.fn(), noteCompleted: vi.fn() }));
vi.mock('@/services/recommendation/transitions', () => ({ recordTransition: vi.fn(), transitionScore: () => 0 }));
const recommendMock = vi.fn(async (): Promise<Song[]> => []);
vi.mock('@/services/recommendation/engine', () => ({
  NEXT_URGENT_DEADLINE_MS: 3500,
  planNextSongs: async () => ({ songs: await recommendMock(), picker: 'local', fallback: null, latencyMs: 0, alg: 'test', relaxed: [], discoveryIds: new Set<string>(), language: null, commit: () => undefined, topUp: () => [], refinement: null }),
}));
const getSongMock = vi.fn<(id: string) => Promise<Song>>();
vi.mock('@/services/api', () => ({ getSong: (id: string) => getSongMock(id) }));

import { audioEngine } from '@/services/audio/engine';
import { recordComplete, recordPlay, recordSkip } from '@/services/personalization/updater';
import { recordTransition } from '@/services/recommendation/transitions';
import { initTransitionTracker } from '@/services/recommendation/transitionTracker';
import { usePlayerStore } from './playerStore';
import { useSettingsStore } from './settingsStore';
import { useHistoryStore } from './historyStore';
import { resetSessionIntent } from '@/services/personalization/sessionIntent';

const song = (id: string): Song => ({ kind: 'song', id, title: id, subtitle: 'Artist', artists: [{ id: `a-${id}`, name: `Artist ${id}` }], album: null, images: [], audio: [], duration: 200, language: 'telugu', year: '2024', explicit: false, hasLyrics: false, playCount: null });
const flush = async () => { await vi.advanceTimersByTimeAsync(0); };
const tick = (t: number, d = 200) => engine.handlers?.onTime(t, d);
/** Realistic ticks: a quarter-second apart, like the element's timeupdate. */
const listen = (from: number, to: number, d = 200) => { for (let t = from; t <= to + 1e-9; t += 0.25) tick(Math.round(t * 100) / 100, d); };

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  resetSessionIntent();
  useHistoryStore.setState({ entries: [] });
  useSettingsStore.setState({ kidMode: false, crossfade: false, resumePlayback: false, djTakeover: false, autoplay: true, mutedLanguages: [] });
  usePlayerStore.getState().clearQueue();
  usePlayerStore.setState({ queue: [], index: 0, repeat: 'off', shuffle: false, currentTime: 0, duration: 0, isPlaying: false, tuneIntent: null, sleepAt: null, sleepSongsLeft: 0, sleepAfterTrack: false, volume: 0.8, muted: false });
  usePlayerStore.getState().initEngine();
  recommendMock.mockReset();
  recommendMock.mockResolvedValue([]);
  getSongMock.mockReset();
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('seeking is not listening', () => {
  it('a 200 s track seeked straight to 180 s has not been heard: no PLAY', () => {
    usePlayerStore.getState().playSong(song('a'));
    tick(0.25);
    usePlayerStore.getState().seek(180);
    tick(180);
    tick(180.25);
    expect(recordPlay).not.toHaveBeenCalled();
  });

  it('reaching the end by seeking is not a completion', () => {
    usePlayerStore.getState().playSong(song('a'));
    tick(0.25);
    usePlayerStore.getState().seek(199);
    tick(199);
    engine.handlers?.onEnded();
    expect(recordComplete).not.toHaveBeenCalled();
    expect(recordPlay).not.toHaveBeenCalled();
    expect(useHistoryStore.getState().entries[0]?.completed).toBe(false);
  });

  it('five seconds really heard is a PLAY, exactly once, even after a seek', () => {
    usePlayerStore.getState().playSong(song('a'));
    listen(0, 3);
    usePlayerStore.getState().seek(120);
    listen(120, 121.75);
    expect(recordPlay).not.toHaveBeenCalled(); // 3 + 1.75 heard so far
    listen(122, 124);
    expect(recordPlay).toHaveBeenCalledTimes(1);
    listen(124.25, 140);
    expect(recordPlay).toHaveBeenCalledTimes(1);
  });

  it('a skip verdict uses heard time: 10 s heard at the end of a track is still a skip', () => {
    usePlayerStore.getState().playQueue([song('a'), song('b')], 0);
    tick(0.25);
    usePlayerStore.getState().seek(185);
    listen(185, 195); // 10 s heard, at 97 % of the track
    usePlayerStore.getState().next(true);
    expect(recordSkip).toHaveBeenCalledTimes(1);
    expect(vi.mocked(recordSkip).mock.calls[0][1]).toBeLessThan(15);
  });

  it('a song heard for a third and then left is not a skip, wherever the playhead is', () => {
    usePlayerStore.getState().playQueue([song('a'), song('b')], 0);
    listen(0, 70);
    usePlayerStore.getState().seek(10);
    listen(10, 12);
    usePlayerStore.getState().next(true);
    expect(recordSkip).not.toHaveBeenCalled();
  });

  it('transition memory judges the hand-off by what was heard, not by the furthest position', () => {
    const stop = initTransitionTracker();
    usePlayerStore.getState().playQueue([song('a'), song('b'), song('c')], 0);
    listen(0, 190);
    usePlayerStore.getState().next(false); // a → b, a forward hand-off
    tick(0.25);
    usePlayerStore.getState().seek(190);
    tick(190);
    usePlayerStore.getState().next(false); // b → c: how did a → b go?
    const verdicts = vi.mocked(recordTransition).mock.calls.filter(([from, to]) => from.id === 'a' && to.id === 'b').map((c) => c[2]);
    expect(verdicts).not.toContain('completed');
    stop();
  });

  it('a completion needs most of the song heard; repeat-one credits each loop once', () => {
    usePlayerStore.getState().playSong(song('a'));
    usePlayerStore.setState({ repeat: 'one' });
    listen(0, 199.75);
    engine.handlers?.onEnded(); // loop 1, fully heard
    expect(recordComplete).toHaveBeenCalledTimes(1);
    expect(recordPlay).toHaveBeenCalledTimes(1);
    tick(0);
    usePlayerStore.getState().seek(190);
    listen(190, 199.75);
    engine.handlers?.onEnded(); // loop 2: only 10 s heard
    expect(recordComplete).toHaveBeenCalledTimes(1);
    expect(recordPlay).toHaveBeenCalledTimes(1);
  });
});

describe('failed playback and stale async work', () => {
  it('a stale song-detail failure never skips or pauses the song the listener chose next', async () => {
    let fail: (e: Error) => void = () => undefined;
    getSongMock.mockReturnValueOnce(new Promise<Song>((_, reject) => { fail = reject; }));
    usePlayerStore.getState().playSong(song('a'));
    engine.handlers?.onFatalError('a');
    await flush();
    usePlayerStore.getState().playSong(song('b'));
    usePlayerStore.setState({ isPlaying: true });
    vi.mocked(audioEngine.pause).mockClear();
    fail(new Error('offline'));
    await flush();
    await flush();
    expect(usePlayerStore.getState().queue[usePlayerStore.getState().index]?.id).toBe('b');
    expect(usePlayerStore.getState().isPlaying).toBe(true);
    expect(audioEngine.pause).not.toHaveBeenCalled();
  });

  it('a stale song-detail success never reloads sources over the song now playing', async () => {
    let ok: (s: Song) => void = () => undefined;
    getSongMock.mockReturnValueOnce(new Promise<Song>((resolve) => { ok = resolve; }));
    usePlayerStore.getState().playSong(song('a'));
    engine.handlers?.onFatalError('a');
    await flush();
    usePlayerStore.getState().playSong(song('b'));
    // The listener went back to the same song id by hand: a new playback instance.
    usePlayerStore.getState().playSong(song('a'));
    vi.mocked(audioEngine.reloadWithSources).mockClear();
    ok(song('a'));
    await flush();
    await flush();
    expect(audioEngine.reloadWithSources).not.toHaveBeenCalled();
  });
});

describe('one moment a play is a play', () => {
  it('emits a single counted event per run, after five seconds heard — never on start or on a seek', async () => {
    const { onPlaybackEvent } = await import('@/services/playback/session');
    const counted: string[] = [];
    const off = onPlaybackEvent((e) => { if (e.kind === 'counted') counted.push(e.song.id); });
    usePlayerStore.getState().playSong(song('a'));
    expect(counted).toEqual([]);
    tick(0.25);
    usePlayerStore.getState().seek(150);
    tick(150);
    expect(counted).toEqual([]);
    listen(150.25, 156);
    expect(counted).toEqual(['a']);
    listen(156.25, 170);
    expect(counted).toEqual(['a']);
    off();
  });
});
