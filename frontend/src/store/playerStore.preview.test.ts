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
const recommendMock = vi.fn(async (): Promise<Song[]> => []);
vi.mock('@/services/recommendation/engine', () => ({
  NEXT_URGENT_DEADLINE_MS: 3500,
  planNextSongs: async () => ({ songs: await recommendMock(), picker: 'local', fallback: null, latencyMs: 0, alg: 'test', relaxed: [], discoveryIds: new Set<string>(), language: null, commit: () => undefined, topUp: () => [], refinement: null }),
}));

import { audioEngine } from '@/services/audio/engine';
import { usePlayerStore } from './playerStore';
import { useSettingsStore } from './settingsStore';
import { useHistoryStore } from './historyStore';

const song = (id: string, explicit = false): Song => ({
  kind: 'song', id, title: id, subtitle: 'Artist', artists: [], album: null,
  images: [], audio: [], duration: 200, language: 'telugu', year: '2024',
  explicit, hasLyrics: false, playCount: null,
});
const ids = (songs: Song[]) => songs.map((s) => s.id);
const persisted = () => JSON.parse(localStorage.getItem('vinax.player.v1') ?? '{}')?.state as { queue: Song[]; index: number };
const st = () => usePlayerStore.getState();

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  useSettingsStore.setState({ kidMode: false, crossfade: false, resumePlayback: false, djTakeover: false, autoplay: true });
  usePlayerStore.setState({ queue: [], index: 0, repeat: 'off', shuffle: false, currentTime: 0, duration: 0, isPlaying: false, tuneIntent: null, followMode: false });
  st().exitPreview();
  recommendMock.mockReset();
  recommendMock.mockResolvedValue([]);
});
afterEach(() => {
  st().exitPreview();
  vi.clearAllTimers();
  vi.useRealTimers();
});

/** The listener's queue: an album, playing its second song, 42 s in. */
function listenerQueue(): Song[] {
  const album = [song('a'), song('b'), song('c')];
  st().playQueue(album, 1, { keepList: true });
  usePlayerStore.setState({ currentTime: 42, isPlaying: true });
  return album;
}

describe('Flow preview mode: the queue snapshot', () => {
  it('sets the queue aside, previews from the hook point and never extends the preview', async () => {
    const album = listenerQueue();
    expect(st().enterPreview()).toBe(true);
    expect(st().previewMode).toBe(true);
    expect(audioEngine.pause).toHaveBeenCalled();

    st().previewSong(song('p1'), 60);
    expect(ids(st().queue)).toEqual(['p1']);
    expect(audioEngine.load).toHaveBeenLastCalledWith(song('p1'), expect.any(String), true, 60);
    // Autoplay is on, the queue is one song long — and still nothing is planned after it.
    await vi.runAllTimersAsync();
    expect(recommendMock).not.toHaveBeenCalled();
    expect(ids(st().queue)).toEqual(['p1']);
    // A reload in the middle of Flow finds the listener's own queue, not the preview.
    expect(ids(persisted().queue)).toEqual(ids(album));
    expect(persisted().index).toBe(1);
  });

  it('restores the queue on leaving, paused where it was', () => {
    const album = listenerQueue();
    st().enterPreview();
    st().previewSong(song('p1'), 60);
    st().previewSong(song('p2'), 45);
    st().exitPreview();
    expect(st().previewMode).toBe(false);
    expect(ids(st().queue)).toEqual(ids(album));
    expect(st().index).toBe(1);
    expect(st().isPlaying).toBe(false);
    expect(st().currentTime).toBe(42);
    // The song comes back loaded, NOT playing, at its old position.
    expect(audioEngine.load).toHaveBeenLastCalledWith(album[1], expect.any(String), false, 42);
  });

  it('keeps previews out of history', () => {
    listenerQueue();
    const before = useHistoryStore.getState().entries.length;
    st().enterPreview();
    st().previewSong(song('p1'), 60);
    expect(useHistoryStore.getState().entries.length).toBe(before);
  });

  it('"Add to queue" while previewing goes to the listener\'s queue', () => {
    listenerQueue();
    st().enterPreview();
    st().previewSong(song('p1'), 60);
    st().enqueue(song('p1'));
    expect(ids(st().queue)).toEqual(['p1']); // the preview itself is untouched
    st().exitPreview();
    expect(ids(st().queue)).toEqual(['a', 'b', 'c', 'p1']);
    expect(st().isManualQueued('p1')).toBe(true);
  });

  it('"Add to queue" with nothing queued before Flow leaves that song waiting, paused', () => {
    st().enterPreview();
    st().previewSong(song('p1'), 60);
    st().enqueue(song('p1'));
    st().exitPreview();
    expect(ids(st().queue)).toEqual(['p1']);
    expect(st().isPlaying).toBe(false);
  });

  it('"Play full song" hands the song to the real queue, next to what was playing, from the top', () => {
    listenerQueue();
    st().enterPreview();
    st().previewSong(song('p1'), 60);
    st().commitPreview(song('p1'));
    expect(st().previewMode).toBe(false);
    expect(ids(st().queue)).toEqual(['a', 'b', 'p1', 'c']);
    expect(st().index).toBe(2);
    expect(audioEngine.load).toHaveBeenLastCalledWith(song('p1'), expect.any(String), true);
    // Leaving Flow now changes nothing: the listener chose this.
    st().exitPreview();
    expect(ids(st().queue)).toEqual(['a', 'b', 'p1', 'c']);
  });

  it('a real play while previewing lets the snapshot go', () => {
    listenerQueue();
    st().enterPreview();
    st().previewSong(song('p1'), 60);
    st().startRadio(song('r1'));
    expect(st().previewMode).toBe(false);
    st().exitPreview();
    expect(st().queue[0].id).toBe('r1');
  });

  it('never takes over while following a Listen Together host', () => {
    listenerQueue();
    st().setFollowMode(true);
    expect(st().enterPreview()).toBe(false);
    st().previewSong(song('p1'), 60);
    expect(ids(st().queue)).toEqual(['a', 'b', 'c']);
    st().setFollowMode(false);
  });

  it('a session that starts mid-Flow gets the listener\'s queue back first', () => {
    const album = listenerQueue();
    st().enterPreview();
    st().previewSong(song('p1'), 60);
    st().setFollowMode(true);
    expect(st().previewMode).toBe(false);
    expect(ids(st().queue)).toEqual(ids(album));
    st().setFollowMode(false);
  });

  it('a preview that ends stops instead of moving through a queue', () => {
    listenerQueue();
    st().enterPreview();
    st().previewSong(song('p1'), 60);
    st().next(true);
    expect(ids(st().queue)).toEqual(['p1']);
  });

  it('Kid mode: an explicit song is never previewed', () => {
    useSettingsStore.setState({ kidMode: true });
    st().enterPreview();
    st().previewSong(song('x', true), 60);
    expect(st().queue.some((s) => s.id === 'x')).toBe(false);
    expect(st().previewError).toBe('x');
  });
});
