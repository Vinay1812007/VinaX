// @vitest-environment jsdom
/**
 * 8.2.0 — Radio entry point: startRadio(song, { seeds, feed }). The seeds
 * play first, then a catalogue station's own next songs (`feed`) or Autoplay
 * keep it going forever (whatever the Autoplay setting).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
const recommendMock = vi.fn(async (_queue: readonly Song[], _index: number): Promise<Song[]> => []);
// The real Autoplay filter; only the network fetch is stubbed.
vi.mock('@/services/autoplay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/autoplay')>()),
  findAutoplaySongs: (queue: readonly Song[], index: number) => recommendMock(queue, index),
}));

import { audioEngine } from '@/services/audio/engine';
import { RADIO_SEED_MAX, usePlayerStore } from './playerStore';
import { useSettingsStore } from './settingsStore';

const song = (id: string, explicit = false): Song => ({
  kind: 'song', id, title: id, subtitle: 'Artist', artists: [], album: null,
  images: [], audio: [], duration: 200, language: 'telugu', year: '2024',
  explicit, hasLyrics: false, playCount: null,
});

// The store loads Autoplay on demand; load it once up front so a top-up is not waiting on a module import.
beforeAll(async () => {
  await import('@/services/autoplay');
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  useSettingsStore.setState({ kidMode: false, crossfade: false, resumePlayback: false, autoplay: true, mutedLanguages: [] });
  usePlayerStore.setState({ queue: [], runs: [], index: 0, repeat: 'off', shuffle: false, currentTime: 0, duration: 0, isPlaying: false });
  recommendMock.mockReset();
  recommendMock.mockResolvedValue([]);
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

const runOf = (id: string) => {
  const s = usePlayerStore.getState();
  return s.runs[s.queue.findIndex((x) => x.id === id)];
};

describe('startRadio — Radio', () => {
  it('one song: the song plays and Autoplay fills in what follows at once', async () => {
    recommendMock.mockResolvedValue([song('dj1'), song('dj2')]);
    usePlayerStore.getState().startRadio(song('seed'));
    expect(audioEngine.load).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'seed' }), expect.any(String), true);
    await vi.advanceTimersByTimeAsync(10);
    expect(usePlayerStore.getState().queue.map((s) => s.id)).toEqual(['seed', 'dj1', 'dj2']);
    expect(runOf('dj1')).toBe('autoplay');
  });

  it('seeds play first (distinct, capped) as the radio’s list, then Autoplay continues after the last seed', async () => {
    recommendMock.mockResolvedValue([song('dj1')]);
    const seeds = [song('a'), song('b'), song('a'), song('c'), song('d'), song('e'), song('f')];
    usePlayerStore.getState().startRadio(song('seed'), { seeds });
    const s = usePlayerStore.getState();
    expect(s.queue.map((x) => x.id)).toEqual(['seed', 'a', 'b', 'c', 'd'].slice(0, RADIO_SEED_MAX));
    expect(s.index).toBe(0);
    expect(runOf('a')).toBe('context');
    await vi.advanceTimersByTimeAsync(10);
    expect(recommendMock).toHaveBeenCalledOnce();
    const [queue, index] = recommendMock.mock.calls[0];
    expect(queue[index].id).toBe('d');
    expect(usePlayerStore.getState().queue.map((x) => x.id)).toEqual(['seed', 'a', 'b', 'c', 'd', 'dj1']);
  });

  it('is endless even with autoplay off', async () => {
    useSettingsStore.setState({ autoplay: false });
    recommendMock.mockResolvedValue([song('dj1')]);
    usePlayerStore.getState().startRadio(song('seed'));
    await vi.advanceTimersByTimeAsync(10);
    expect(usePlayerStore.getState().queue.map((x) => x.id)).toEqual(['seed', 'dj1']);
  });

  it('Kid mode drops explicit seeds; malformed seeds are ignored', () => {
    useSettingsStore.setState({ kidMode: true });
    usePlayerStore.getState().startRadio(song('bad', true), { seeds: [song('ok'), { id: 'broken' } as unknown as Song] });
    expect(usePlayerStore.getState().queue.map((x) => x.id)).toEqual(['ok']);
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

  it('tops the radio up from the station, not Autoplay; its songs show as Autoplay', async () => {
    recommendMock.mockResolvedValue([song('dj1')]);
    const feed = feedOf([song('st1'), song('st2')]);
    usePlayerStore.getState().startRadio(song('seed'), { seeds: [song('a')], feed });
    await vi.advanceTimersByTimeAsync(10);
    expect(feed).toHaveBeenCalledOnce();
    expect(feed.mock.calls[0][0]).toBe(5);
    expect(recommendMock).not.toHaveBeenCalled();
    const s = usePlayerStore.getState();
    expect(s.queue.map((x) => x.id)).toEqual(['seed', 'a', 'st1', 'st2']);
    expect(runOf('st1')).toBe('autoplay');
  });

  it('a station that answers nothing (or fails) is covered by Autoplay; two misses in a row end it', async () => {
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
    // After two misses Autoplay alone keeps the radio going.
    recommendMock.mockResolvedValue([song('dj3')]);
    usePlayerStore.getState().next();
    await vi.advanceTimersByTimeAsync(10);
    expect(feed).toHaveBeenCalledTimes(2);
  });

  it('a slow station gives way to Autoplay at the deadline', async () => {
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

  it('a new list or a new radio without a feed ends the station', async () => {
    const feed = feedOf([song('st1')], [song('st2')], [song('st3')]);
    usePlayerStore.getState().startRadio(song('seed'), { feed });
    await vi.advanceTimersByTimeAsync(10);
    expect(feed).toHaveBeenCalledTimes(1);

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
