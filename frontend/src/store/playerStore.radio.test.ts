// @vitest-environment jsdom
/**
 * 8.2.0 — AI Radio entry point: startRadio(song, { seeds, tune }). The seeds
 * play first, the DJ continues forever after them (radio mode, whatever the
 * autoplay setting), and the tune steers every continuation.
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
const recommendMock = vi.fn(async (_seed: Song, _ctx: unknown, _opts?: { tune?: string | null; previous?: Song | null }): Promise<Song[]> => []);
vi.mock('@/services/nextup/engine', () => ({
  warmNextUp: () => undefined,
  NEXT_URGENT_DEADLINE_MS: 3500,
  planNextSongs: async (seed: Song, ctx: unknown, opts?: { tune?: string | null }) => ({ songs: await recommendMock(seed, ctx, opts), picker: 'local', fallback: null, latencyMs: 0, alg: 'test', relaxed: [], discoveryIds: new Set<string>(), language: null, commit: () => undefined, topUp: () => [], refinement: null }),
}));

import { audioEngine } from '@/services/audio/engine';
import { RADIO_SEED_MAX, usePlayerStore } from './playerStore';
import { useSettingsStore } from './settingsStore';

const song = (id: string, explicit = false): Song => ({
  kind: 'song', id, title: id, subtitle: 'Artist', artists: [], album: null,
  images: [], audio: [], duration: 200, language: 'telugu', year: '2024',
  explicit, hasLyrics: false, playCount: null,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  useSettingsStore.setState({ kidMode: false, crossfade: false, resumePlayback: false, djTakeover: true, autoplay: true });
  usePlayerStore.setState({ queue: [], index: 0, repeat: 'off', shuffle: false, currentTime: 0, duration: 0, isPlaying: false, tuneIntent: null });
  recommendMock.mockReset();
  recommendMock.mockResolvedValue([]);
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('startRadio — AI Radio', () => {
  it('one song: the song plays and the DJ plans the continuation at once (unchanged behaviour)', async () => {
    recommendMock.mockResolvedValue([song('dj1'), song('dj2')]);
    usePlayerStore.getState().startRadio(song('seed'));
    expect(audioEngine.load).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'seed' }), expect.any(String), true);
    await vi.advanceTimersByTimeAsync(10);
    expect(usePlayerStore.getState().queue.map((s) => s.id)).toEqual(['seed', 'dj1', 'dj2']);
    expect(usePlayerStore.getState().isAutoQueued('dj1')).toBe(true);
    expect(usePlayerStore.getState().tuneIntent).toBeNull();
  });

  it('seeds play first (distinct, capped), then the DJ continues after the last seed with the tune applied', async () => {
    recommendMock.mockResolvedValue([song('dj1')]);
    const seeds = [song('a'), song('b'), song('a'), song('c'), song('d'), song('e'), song('f')];
    usePlayerStore.getState().startRadio(song('seed'), { seeds, tune: 'melody' });
    const s = usePlayerStore.getState();
    expect(s.queue.map((x) => x.id)).toEqual(['seed', 'a', 'b', 'c', 'd'].slice(0, RADIO_SEED_MAX));
    expect(s.index).toBe(0);
    expect(s.tuneIntent).toBe('melody');
    // Seeds are the radio's own list, not DJ picks: a refresh keeps them.
    expect(s.isAutoQueued('a')).toBe(false);
    await vi.advanceTimersByTimeAsync(10);
    expect(recommendMock).toHaveBeenCalledOnce();
    expect(recommendMock.mock.calls[0][0].id).toBe('d');
    expect(recommendMock.mock.calls[0][2]?.tune).toBe('melody');
    expect(usePlayerStore.getState().queue.map((x) => x.id)).toEqual(['seed', 'a', 'b', 'c', 'd', 'dj1']);
  });

  it('is endless even with autoplay off', async () => {
    useSettingsStore.setState({ autoplay: false });
    recommendMock.mockResolvedValue([song('dj1')]);
    usePlayerStore.getState().startRadio(song('seed'));
    await vi.advanceTimersByTimeAsync(10);
    expect(usePlayerStore.getState().queue.map((x) => x.id)).toEqual(['seed', 'dj1']);
  });

  it('Kid mode drops explicit seeds; malformed seeds are ignored; an unknown tune is dropped', () => {
    useSettingsStore.setState({ kidMode: true });
    usePlayerStore.getState().startRadio(song('bad', true), { seeds: [song('ok'), { id: 'broken' } as unknown as Song], tune: 'nonsense' as never });
    const s = usePlayerStore.getState();
    expect(s.queue.map((x) => x.id)).toEqual(['ok']);
    expect(s.tuneIntent).toBeNull();
  });

  it('"surprise" resolves to a concrete tune', () => {
    usePlayerStore.getState().startRadio(song('seed'), { tune: 'surprise' });
    const t = usePlayerStore.getState().tuneIntent;
    expect(t).not.toBeNull();
    expect(t).not.toBe('surprise');
  });

  it('does nothing without a song', () => {
    usePlayerStore.getState().startRadio();
    expect(usePlayerStore.getState().queue).toEqual([]);
    expect(audioEngine.load).not.toHaveBeenCalled();
  });
});

describe('startRadio — 1.3 catalogue station feed', () => {
  const feedOf = (...batches: Array<Song[] | Error>) => {
    const fn = vi.fn(async (_limit: number, _signal: AbortSignal): Promise<Song[]> => {
      const b = batches.shift() ?? [];
      if (b instanceof Error) throw b;
      return b;
    });
    return fn;
  };

  it('tops the radio up from the station, not the DJ; its songs count as automatic', async () => {
    recommendMock.mockResolvedValue([song('dj1')]);
    const feed = feedOf([song('st1'), song('st2')]);
    usePlayerStore.getState().startRadio(song('seed'), { seeds: [song('a')], feed });
    await vi.advanceTimersByTimeAsync(10);
    expect(feed).toHaveBeenCalledOnce();
    expect(feed.mock.calls[0][0]).toBe(5);
    expect(recommendMock).not.toHaveBeenCalled();
    const s = usePlayerStore.getState();
    expect(s.queue.map((x) => x.id)).toEqual(['seed', 'a', 'st1', 'st2']);
    expect(s.isAutoQueued('st1')).toBe(true);
  });

  it('a station that answers nothing (or fails) is covered by the DJ; two misses in a row end it', async () => {
    recommendMock.mockResolvedValue([song('dj1')]);
    const feed = feedOf(new Error('down'), [], [song('late')]);
    usePlayerStore.getState().startRadio(song('seed'), { feed });
    await vi.advanceTimersByTimeAsync(10);
    expect(usePlayerStore.getState().queue.map((x) => x.id)).toEqual(['seed', 'dj1']);
    // The next top-up (the listener reached the end) asks the station again: a second miss.
    recommendMock.mockResolvedValue([song('dj2')]);
    usePlayerStore.getState().next();
    await vi.advanceTimersByTimeAsync(10);
    expect(feed).toHaveBeenCalledTimes(2);
    expect(usePlayerStore.getState().queue.map((x) => x.id)).toContain('dj2');
    // After two misses the DJ alone keeps the radio going.
    recommendMock.mockResolvedValue([song('dj3')]);
    usePlayerStore.getState().next();
    await vi.advanceTimersByTimeAsync(10);
    expect(feed).toHaveBeenCalledTimes(2);
  });

  it('a slow station gives way to the DJ at the deadline', async () => {
    recommendMock.mockResolvedValue([song('dj-slow')]);
    const feed = vi.fn(() => new Promise<Song[]>(() => undefined));
    usePlayerStore.getState().startRadio(song('seed'), { feed });
    await vi.advanceTimersByTimeAsync(7_000);
    expect(recommendMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(usePlayerStore.getState().queue.map((x) => x.id)).toEqual(['seed', 'dj-slow']);
  });

  it('station songs pass the same gate (hidden, already queued)', async () => {
    const feed = feedOf([song('seed'), song('x', true), song('fine')]);
    useSettingsStore.setState({ kidMode: true });
    usePlayerStore.getState().startRadio(song('seed'), { feed });
    await vi.advanceTimersByTimeAsync(10);
    expect(usePlayerStore.getState().queue.map((x) => x.id)).toEqual(['seed', 'fine']);
  });

  it('a new list, a new radio without a feed, or a tune ends the station', async () => {
    const feed = feedOf([song('st1')], [song('st2')], [song('st3')]);
    usePlayerStore.getState().startRadio(song('seed'), { feed });
    await vi.advanceTimersByTimeAsync(10);
    expect(feed).toHaveBeenCalledTimes(1);

    usePlayerStore.getState().tuneQueue('melody');
    await vi.advanceTimersByTimeAsync(10);
    expect(feed).toHaveBeenCalledTimes(1);
    expect(recommendMock).toHaveBeenCalled();

    usePlayerStore.getState().startRadio(song('seed2'), { feed });
    await vi.advanceTimersByTimeAsync(10);
    expect(feed).toHaveBeenCalledTimes(2);
    usePlayerStore.getState().playQueue([song('p1'), song('p2')], 0);
    usePlayerStore.getState().next();
    await vi.advanceTimersByTimeAsync(10);
    usePlayerStore.getState().next();
    await vi.advanceTimersByTimeAsync(10);
    expect(feed).toHaveBeenCalledTimes(2);

    usePlayerStore.getState().startRadio(song('seed3'));
    await vi.advanceTimersByTimeAsync(10);
    expect(feed).toHaveBeenCalledTimes(2);
  });
});
