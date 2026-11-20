// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';

/**
 * v7.0.0 — player lifecycle contracts: a play only counts toward taste once it
 * was really heard, skips are flagged in history, a replaced sleep timer
 * cannot fire, and the queue (with who added what) survives a reload.
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
vi.mock('@/services/analytics/telemetry', () => ({ trackSkip: vi.fn(), trackComplete: vi.fn() }));
const recommendMock = vi.fn(async (): Promise<Song[]> => []);
vi.mock('@/services/autoplay', () => ({
  findAutoplaySongs: () => recommendMock(),
  pickAutoplay: (songs: Song[]) => songs,
}));

import { audioEngine } from '@/services/audio/engine';
import { recordPlay, recordSkip } from '@/services/personalization/updater';
import { usePlayerStore } from './playerStore';
import { useSettingsStore } from './settingsStore';
import { useHistoryStore } from './historyStore';
import { getSessionIntent, resetSessionIntent } from '@/services/personalization/sessionIntent';

const song = (id: string): Song => ({ kind: 'song', id, title: id, subtitle: 'Artist', artists: [{ id: `a-${id}`, name: `Artist ${id}` }], album: null, images: [], audio: [], duration: 200, language: 'telugu', year: '2024', explicit: false, hasLyrics: false, playCount: null });
/** 7.2.0 — listening is a run of quarter-second ticks; one jump of the playhead is a seek, not listening. */
const listen = (from: number, to: number, d = 200) => { for (let t = from; t <= to + 1e-9; t += 0.25) engine.handlers?.onTime(Math.round(t * 100) / 100, d); };

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  resetSessionIntent();
  useHistoryStore.setState({ entries: [] });
  useSettingsStore.setState({ kidMode: false, crossfade: false, resumePlayback: false, autoplay: false, mutedLanguages: [] });
  usePlayerStore.getState().clearQueue();
  usePlayerStore.setState({ queue: [], runs: [], index: 0, repeat: 'off', shuffle: false, currentTime: 0, duration: 0, isPlaying: false, sleepAt: null, sleepSongsLeft: 0, sleepAfterTrack: false, volume: 0.8, muted: false });
  usePlayerStore.getState().initEngine();
  recommendMock.mockReset();
  recommendMock.mockResolvedValue([]);
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('what counts as a play, and what counts as a skip', () => {
  it('flipping through songs teaches taste nothing, but reads as a restless sitting', () => {
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
    usePlayerStore.getState().playQueue([song('a'), song('b')], 0);
    listen(0, 20);
    usePlayerStore.getState().next(true);
    expect(recordSkip).toHaveBeenCalledTimes(1);
    expect(useHistoryStore.getState().entries.find((e) => e.song.id === 'a')?.skipped).toBe(true);
  });

  it('does not call leaving a song after the first third a skip', () => {
    usePlayerStore.getState().playQueue([song('a'), song('b')], 0);
    listen(0, 120);
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

describe('1.20 — the queue and who added what survive a reload', () => {
  it('restores the runs saved with the queue', async () => {
    const stored = [song('seed'), song('mine'), song('next'), song('auto1')];
    localStorage.setItem('vinax.player.v1', JSON.stringify({ state: { queue: stored, runs: ['context', 'queued', 'context', 'autoplay'], index: 0, repeat: 'off', shuffle: false, volume: 1, muted: false, rate: 1 }, version: 1 }));
    vi.resetModules();
    const { usePlayerStore: reloaded } = await import('./playerStore');
    reloaded.getState().initEngine();
    expect(reloaded.getState().queue.map((s) => s.id)).toEqual(['seed', 'mine', 'next', 'auto1']);
    expect(reloaded.getState().runs).toEqual(['context', 'queued', 'context', 'autoplay']);
  });

  it('turns a 1.19 queue’s saved owners into runs, once', async () => {
    const stored = [song('seed'), song('auto1'), song('mine')];
    localStorage.setItem('vinax.player.v1', JSON.stringify({ state: { queue: stored, index: 0, repeat: 'off', shuffle: false, volume: 1, muted: false, rate: 1 }, version: 1 }));
    localStorage.setItem('vinax.queue.ownership.v1', JSON.stringify({ v: 1, auto: ['auto1', 'left-the-queue'], manual: ['mine'], order: ['seed'] }));
    vi.resetModules();
    const { usePlayerStore: reloaded } = await import('./playerStore');
    reloaded.getState().initEngine();
    // Next in queue first, Autoplay last.
    expect(reloaded.getState().queue.map((s) => s.id)).toEqual(['seed', 'mine', 'auto1']);
    expect(reloaded.getState().runs).toEqual(['context', 'queued', 'autoplay']);
  });
});
