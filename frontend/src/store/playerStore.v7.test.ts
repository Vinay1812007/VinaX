// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';

/**
 * v7.0.0 — player lifecycle contracts added in 7.0: hand-queued songs outrank
 * automation, a play only counts toward taste once it was really heard,
 * skips are flagged in history, and a replaced sleep timer cannot fire.
 */
interface EngineHandlers { onTime(currentTime: number, duration: number): void; onEnded(): void }
const engine = vi.hoisted(() => ({ handlers: null as EngineHandlers | null }));
vi.mock('@/services/audio/engine', () => ({
  audioEngine: {
    init: vi.fn((h: EngineHandlers) => { engine.handlers = h; }),
    load: vi.fn(), preloadNext: vi.fn(), pause: vi.fn(), play: vi.fn(), seek: vi.fn(),
    setVolume: vi.fn(), setMuted: vi.fn(), setRate: vi.fn(), fadeIn: vi.fn(), fadeOut: vi.fn(), fadeOutAndPause: vi.fn(),
    currentSongId: null,
  },
  orderedSources: () => [],
}));
vi.mock('@/services/media-session', () => ({ setMediaHandlers: vi.fn(), updateMediaMetadata: vi.fn(), updatePlaybackState: vi.fn(), updatePositionState: vi.fn() }));
vi.mock('@/services/personalization/updater', () => ({ recordComplete: vi.fn(), recordPlay: vi.fn(), recordQueueAdd: vi.fn(), recordSkip: vi.fn() }));
vi.mock('@/services/native', () => ({ checkNotificationOnFirstPlay: vi.fn(), haptic: vi.fn(), isNativePlatform: () => false }));
vi.mock('@/services/cast', () => ({ useCastStore: { getState: () => ({ connected: false }) }, castInterceptPlayPause: () => false, castInterceptSeek: () => false, castInterceptVolume: () => false, castMime: vi.fn() }));
vi.mock('@/utils/streak', () => ({ bumpStreak: vi.fn() }));
vi.mock('@/services/analytics/telemetry', () => ({ trackSkip: vi.fn(), trackComplete: vi.fn() }));
vi.mock('@/services/recommendation/adaptive', () => ({ noteSkipAndMaybeReplan: vi.fn(), noteCompleted: vi.fn() }));
const recommendMock = vi.fn(async (): Promise<Song[]> => []);
vi.mock('@/services/recommendation/engine', () => ({ recommendNextSongs: () => recommendMock() }));

import { audioEngine } from '@/services/audio/engine';
import { recordPlay, recordSkip } from '@/services/personalization/updater';
import { usePlayerStore } from './playerStore';
import { useSettingsStore } from './settingsStore';
import { useHistoryStore } from './historyStore';
import { getSessionIntent, resetSessionIntent } from '@/services/personalization/sessionIntent';

const song = (id: string): Song => ({ kind: 'song', id, title: id, subtitle: 'Artist', artists: [{ id: `a-${id}`, name: `Artist ${id}` }], album: null, images: [], audio: [], duration: 200, language: 'telugu', year: '2024', explicit: false, hasLyrics: false, playCount: null });
const ids = () => usePlayerStore.getState().queue.map((s) => s.id);
const flush = async () => { await vi.advanceTimersByTimeAsync(0); };

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  resetSessionIntent();
  useHistoryStore.setState({ entries: [] });
  useSettingsStore.setState({ kidMode: false, crossfade: false, resumePlayback: false, djTakeover: true, autoplay: true, mutedLanguages: [] });
  usePlayerStore.getState().clearQueue();
  usePlayerStore.setState({ queue: [], index: 0, repeat: 'off', shuffle: false, currentTime: 0, duration: 0, isPlaying: false, tuneIntent: null, sleepAt: null, sleepSongsLeft: 0, sleepAfterTrack: false, volume: 0.8, muted: false });
  usePlayerStore.getState().initEngine();
  recommendMock.mockReset();
  recommendMock.mockResolvedValue([]);
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('manual actions outrank automation', () => {
  it('queues a hand-added song ahead of the recommender tail, after earlier hand-added songs', async () => {
    recommendMock.mockResolvedValueOnce([song('auto1'), song('auto2'), song('auto3')]);
    usePlayerStore.getState().playSong(song('seed'));
    await flush();
    expect(ids()).toEqual(['seed', 'auto1', 'auto2', 'auto3']);
    usePlayerStore.getState().enqueue(song('mine1'));
    usePlayerStore.getState().enqueue(song('mine2'));
    expect(ids()).toEqual(['seed', 'mine1', 'mine2', 'auto1', 'auto2', 'auto3']);
    usePlayerStore.getState().enqueueAll([song('mine3'), song('mine4')]);
    expect(ids()).toEqual(['seed', 'mine1', 'mine2', 'mine3', 'mine4', 'auto1', 'auto2', 'auto3']);
    expect(usePlayerStore.getState().autoTail().map((s) => s.id)).toEqual(['auto1', 'auto2', 'auto3']);
  });

  it('keeps an album in order and appends hand-added songs after it', () => {
    useSettingsStore.setState({ djTakeover: false });
    usePlayerStore.getState().playQueue([song('a'), song('b'), song('c')], 0);
    usePlayerStore.getState().enqueue(song('mine'));
    expect(ids()).toEqual(['a', 'b', 'c', 'mine']);
  });

  it('"Tune this queue" rebuilds the automatic tail but never drops what the listener queued by hand', async () => {
    recommendMock.mockResolvedValueOnce([song('auto1'), song('auto2')]);
    usePlayerStore.getState().playSong(song('seed'));
    await flush();
    usePlayerStore.getState().enqueue(song('mine'));
    usePlayerStore.getState().enqueueNext(song('next-up'));
    recommendMock.mockResolvedValueOnce([song('tuned1'), song('tuned2')]);
    usePlayerStore.getState().tuneQueue('energetic');
    await flush();
    expect(ids()).toEqual(['seed', 'next-up', 'mine', 'tuned1', 'tuned2']);
  });

  it('an adaptive re-plan replaces only the recommender tail', async () => {
    recommendMock.mockResolvedValueOnce([song('auto1'), song('auto2')]);
    usePlayerStore.getState().playSong(song('seed'));
    await flush();
    usePlayerStore.getState().enqueue(song('mine'));
    usePlayerStore.getState().replaceAutoTail([song('sure1'), song('auto2')]);
    expect(ids()).toEqual(['seed', 'mine', 'sure1', 'auto2']);
  });

  it('ignores a continuation that arrives after the listener started something else', async () => {
    let release: (songs: Song[]) => void = () => undefined;
    recommendMock.mockReturnValueOnce(new Promise<Song[]>((resolve) => { release = resolve; }));
    usePlayerStore.getState().playSong(song('first'));
    usePlayerStore.getState().playSong(song('second'));
    release([song('stale1'), song('stale2')]);
    await flush();
    expect(ids()).not.toContain('stale1');
    expect(ids()[0]).toBe('second');
  });
});

describe('what counts as a play, and what counts as a skip', () => {
  it('flipping through songs teaches taste nothing, but reads as a restless sitting', () => {
    useSettingsStore.setState({ djTakeover: false });
    usePlayerStore.getState().playQueue([song('a'), song('b'), song('c'), song('d')], 0);
    usePlayerStore.getState().next(true);
    usePlayerStore.getState().next(true);
    usePlayerStore.getState().next(true);
    expect(recordPlay).not.toHaveBeenCalled();
    expect(recordSkip).not.toHaveBeenCalled();
    expect(getSessionIntent().skipStreak).toBe(3);
    expect(useHistoryStore.getState().entries.filter((e) => e.skipped).map((e) => e.song.id)).toEqual(['c', 'b', 'a']);
  });

  it('counts the play once five seconds were heard, exactly once', () => {
    usePlayerStore.getState().playSong(song('a'));
    engine.handlers?.onTime(2, 200);
    expect(recordPlay).not.toHaveBeenCalled();
    engine.handlers?.onTime(5.2, 200);
    engine.handlers?.onTime(9, 200);
    expect(recordPlay).toHaveBeenCalledTimes(1);
  });

  it('records a real skip (heard, then left inside the first third) and flags it in history', () => {
    useSettingsStore.setState({ djTakeover: false });
    usePlayerStore.getState().playQueue([song('a'), song('b')], 0);
    engine.handlers?.onTime(20, 200);
    usePlayerStore.getState().next(true);
    expect(recordSkip).toHaveBeenCalledTimes(1);
    expect(useHistoryStore.getState().entries.find((e) => e.song.id === 'a')?.skipped).toBe(true);
  });

  it('does not call leaving a song after the first third a skip', () => {
    useSettingsStore.setState({ djTakeover: false });
    usePlayerStore.getState().playQueue([song('a'), song('b')], 0);
    engine.handlers?.onTime(120, 200);
    usePlayerStore.getState().next(true);
    expect(recordSkip).not.toHaveBeenCalled();
    expect(useHistoryStore.getState().entries.find((e) => e.song.id === 'a')?.skipped).toBeUndefined();
  });

  it('a finished song is a play and never a skip, even a very short one', () => {
    usePlayerStore.getState().playSong(song('a'));
    engine.handlers?.onTime(3, 4);
    engine.handlers?.onEnded();
    expect(recordPlay).toHaveBeenCalledTimes(1);
    expect(useHistoryStore.getState().entries[0]).toMatchObject({ completed: true });
    expect(useHistoryStore.getState().entries[0].skipped).toBeUndefined();
  });
});

describe('sleep timer', () => {
  it('a minutes timer replaced by "after N songs" can no longer fire', () => {
    usePlayerStore.getState().playSong(song('a'));
    usePlayerStore.getState().setSleepTimer(1);
    usePlayerStore.getState().setSleepSongs(3);
    vi.advanceTimersByTime(61_000);
    expect(audioEngine.fadeOutAndPause).not.toHaveBeenCalled();
    expect(usePlayerStore.getState()).toMatchObject({ sleepAt: null, sleepSongsLeft: 3 });
  });

  it('cancelling inside the final fade puts the volume back', () => {
    usePlayerStore.getState().playSong(song('a'));
    usePlayerStore.getState().setSleepTimer(1);
    vi.advanceTimersByTime(45_000);
    engine.handlers?.onTime(45, 200); // 15 s left: the fade is lowering the engine volume
    expect(vi.mocked(audioEngine.setVolume).mock.lastCall?.[0]).toBeLessThan(0.8);
    usePlayerStore.getState().setSleepTimer(null);
    expect(vi.mocked(audioEngine.setVolume).mock.lastCall?.[0]).toBe(0.8);
  });

  it('stops once at the deadline: the playing path disarms the wall-clock fallback', () => {
    usePlayerStore.getState().playSong(song('a'));
    usePlayerStore.setState({ isPlaying: true });
    usePlayerStore.getState().setSleepTimer(1);
    vi.advanceTimersByTime(59_900);
    vi.setSystemTime(Date.now() + 200);
    engine.handlers?.onTime(60, 200);
    expect(audioEngine.pause).toHaveBeenCalled();
    vi.advanceTimersByTime(5_000);
    expect(audioEngine.fadeOutAndPause).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().sleepAt).toBeNull();
  });
});

describe('persistence', () => {
  it('does not rewrite the queue on progress ticks — only when a persisted field changes', () => {
    useSettingsStore.setState({ djTakeover: false });
    usePlayerStore.getState().playQueue([song('a'), song('b')], 0);
    const spy = vi.spyOn(Storage.prototype, 'setItem');
    const playerWrites = () => spy.mock.calls.filter(([key]) => key === 'vinax.player.v1').length;
    for (let t = 1; t <= 40; t += 1) engine.handlers?.onTime(t * 0.25, 200);
    expect(playerWrites()).toBe(0);
    usePlayerStore.getState().toggleShuffle();
    expect(playerWrites()).toBe(1);
    spy.mockRestore();
  });

  it('keeps playing when the device refuses the write', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    expect(() => usePlayerStore.getState().playSong(song('a'))).not.toThrow();
    expect(usePlayerStore.getState().queue[0]?.id).toBe('a');
    spy.mockRestore();
  });
});

describe('v7.1.0 — un-tuning and the batch of five', () => {
  it('tuneQueue(null) clears the intent and rebuilds the automatic tail, keeping hand-queued songs', async () => {
    recommendMock.mockResolvedValueOnce([song('auto1'), song('auto2')]);
    usePlayerStore.getState().playSong(song('seed'));
    await flush();
    usePlayerStore.getState().enqueue(song('mine'));
    recommendMock.mockResolvedValueOnce([song('dev1')]);
    usePlayerStore.getState().tuneQueue('devotional');
    await flush();
    expect(usePlayerStore.getState().tuneIntent).toBe('devotional');
    recommendMock.mockResolvedValueOnce([song('usual1'), song('usual2')]);
    usePlayerStore.getState().tuneQueue(null);
    await flush();
    expect(usePlayerStore.getState().tuneIntent).toBeNull();
    expect(ids()).toEqual(['seed', 'mine', 'usual1', 'usual2']);
  });
});
