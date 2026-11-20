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
const autoplayMock = vi.fn(async (_queue: readonly Song[], _index: number): Promise<Song[]> => []);
vi.mock('@/services/autoplay', () => ({
  findAutoplaySongs: (queue: readonly Song[], index: number) => autoplayMock(queue, index),
  pickAutoplay: (songs: readonly Song[], queue: readonly Song[]) => songs.filter((s) => !queue.some((q) => q.id === s.id)),
}));

import { audioEngine } from '@/services/audio/engine';
import { usePlayerStore } from './playerStore';
import { useSettingsStore } from './settingsStore';

const song = (id: string, explicit = false): Song => ({
  kind: 'song', id, title: id, subtitle: 'Artist', artists: [], album: null,
  images: [], audio: [], duration: 200, language: 'telugu', year: '2024',
  explicit, hasLyrics: false, playCount: null,
});
const st = () => usePlayerStore.getState();
const ids = () => st().queue.map((s) => s.id);
const now = () => st().queue[st().index]?.id;
/** What comes next, as "run:id". */
const next = () => st().queue.slice(st().index + 1).map((s, i) => `${st().runs[st().index + 1 + i]}:${s.id}`);

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  useSettingsStore.setState({ kidMode: false, crossfade: false, resumePlayback: false, autoplay: false });
  usePlayerStore.setState({ queue: [], runs: [], index: 0, repeat: 'off', shuffle: false, currentTime: 0, duration: 0, isPlaying: false, followMode: false, autoplayLoading: false });
  autoplayMock.mockReset();
  autoplayMock.mockResolvedValue([]);
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('playing a list', () => {
  it('keeps the full album and begins at the selected song; with Autoplay off it stops at the end', () => {
    const album = [song('a'), song('b'), song('c')];
    st().playQueue(album, 1);
    expect(st().queue).toEqual(album);
    expect(st().index).toBe(1);
    expect(audioEngine.load).toHaveBeenLastCalledWith(album[1], expect.any(String), true);
    st().next();
    expect(st().index).toBe(2);
    st().next();
    expect(audioEngine.pause).toHaveBeenCalledOnce();
    expect(st().queue).toEqual(album);
    expect(autoplayMock).not.toHaveBeenCalled();
  });

  it('Back restarts a song past 3 seconds, else steps to the song before in the list', () => {
    st().playQueue([song('a'), song('b'), song('c')], 1);
    st().prev();
    expect(now()).toBe('a');
    st().next();
    usePlayerStore.setState({ currentTime: 10 });
    st().prev();
    expect(now()).toBe('b');
    expect(audioEngine.seek).toHaveBeenCalledWith(0);
  });

  it('filters explicit album tracks without shifting the selected song', () => {
    useSettingsStore.setState({ kidMode: true });
    const album = [song('explicit', true), song('selected'), song('last')];
    st().playQueue(album, 1);
    expect(ids()).toEqual(['selected', 'last']);
    expect(st().index).toBe(0);
    st().playQueue(album, 0);
    expect(audioEngine.load).toHaveBeenCalledOnce();
  });

  it('a search hit (asSeed) plays alone', () => {
    st().playQueue([song('hit'), song('other')], 0, { asSeed: true });
    expect(ids()).toEqual(['hit']);
  });
});

describe('Next in queue (Add to queue)', () => {
  it('plays your adds right after the current song, in the order added, ahead of the rest of the list', () => {
    st().playQueue([song('a'), song('b'), song('c')], 0);
    st().enqueue(song('q1'));
    st().enqueue(song('q2'));
    expect(next()).toEqual(['queued:q1', 'queued:q2', 'context:b', 'context:c']);
    st().next();
    expect(now()).toBe('q1');
    // An add while a queued song plays still goes after the other adds.
    st().enqueue(song('q3'));
    expect(next()).toEqual(['queued:q2', 'queued:q3', 'context:b', 'context:c']);
  });

  it('survives starting another album, and plays right after its first song', () => {
    st().playQueue([song('a'), song('b')], 0);
    st().enqueue(song('mine'));
    st().playQueue([song('x'), song('y'), song('z')], 0);
    expect(now()).toBe('x');
    expect(next()).toEqual(['queued:mine', 'context:y', 'context:z']);
  });

  it('a song already waiting in Next in queue is not added twice; a list song can be added (it plays twice)', () => {
    st().playQueue([song('a'), song('b')], 0);
    st().enqueue(song('q'));
    st().enqueue(song('q'));
    st().enqueue(song('b'));
    expect(next()).toEqual(['queued:q', 'queued:b', 'context:b']);
  });

  it('Clear queue empties only Next in queue', () => {
    st().playQueue([song('a'), song('b')], 0);
    st().enqueueAll([song('q1'), song('q2')]);
    st().clearUserQueue();
    expect(next()).toEqual(['context:b']);
    expect(now()).toBe('a');
  });

  it('adding to an empty queue plays the song', () => {
    st().enqueue(song('first'));
    expect(now()).toBe('first');
  });
});

describe('tapping a row', () => {
  it('a list row further down skips the list songs above it, keeps your adds, and Back reaches the skipped ones', () => {
    st().playQueue([song('a'), song('b'), song('c'), song('d')], 0);
    st().enqueue(song('q'));
    // a | q b c d → tap d
    st().playAt(4);
    expect(now()).toBe('d');
    expect(next()).toEqual(['queued:q']);
    st().prev();
    expect(now()).toBe('c');
  });

  it('a row in Next in queue drops the adds above it', () => {
    st().playQueue([song('a'), song('b')], 0);
    st().enqueueAll([song('q1'), song('q2')]);
    st().playAt(2);
    expect(now()).toBe('q2');
    expect(next()).toEqual(['context:b']);
  });

  it('dragging a list song among your adds makes it one of them', () => {
    st().playQueue([song('a'), song('b'), song('c')], 0);
    st().enqueue(song('q'));
    // a | q b c → drag c onto q
    st().moveInQueue(3, 1);
    expect(next()).toEqual(['queued:c', 'queued:q', 'context:b']);
  });

  it('removing the playing song plays the one that takes its place', () => {
    st().playQueue([song('a'), song('b')], 0);
    st().removeAt(0);
    expect(now()).toBe('b');
    expect(audioEngine.load).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'b' }), expect.any(String), false);
  });
});

describe('Autoplay', () => {
  it('when the list ends, similar songs follow — and the queue shows them as Autoplay', async () => {
    useSettingsStore.setState({ autoplay: true });
    autoplayMock.mockResolvedValue([song('sim1'), song('sim2')]);
    st().playQueue([song('a'), song('b'), song('c')], 0);
    // Nothing is asked for while plenty of the list is left…
    expect(autoplayMock).not.toHaveBeenCalled();
    st().next();
    // …and the songs are fetched ahead once two or fewer are left.
    await vi.advanceTimersByTimeAsync(0);
    expect(autoplayMock).toHaveBeenCalledOnce();
    expect(next()).toEqual(['context:c', 'autoplay:sim1', 'autoplay:sim2']);
    st().next();
    st().next();
    expect(now()).toBe('sim1');
  });

  it('waits at the end of the list, then carries on; says so when nothing comes back', async () => {
    useSettingsStore.setState({ autoplay: true });
    st().playSong(song('solo'));
    await vi.advanceTimersByTimeAsync(0);
    autoplayMock.mockClear();
    autoplayMock.mockResolvedValueOnce([song('more')]);
    st().next();
    expect(st().autoplayLoading).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(now()).toBe('more');
    expect(st().autoplayLoading).toBe(false);
  });

  it('your adds play before Autoplay', async () => {
    useSettingsStore.setState({ autoplay: true });
    autoplayMock.mockResolvedValue([song('sim')]);
    st().playSong(song('solo'));
    await vi.advanceTimersByTimeAsync(0);
    st().enqueue(song('mine'));
    expect(next()).toEqual(['queued:mine', 'autoplay:sim']);
  });

  it('a song you add that Autoplay already picked leaves Autoplay, so it plays once', async () => {
    useSettingsStore.setState({ autoplay: true });
    autoplayMock.mockResolvedValue([song('sim1'), song('sim2')]);
    st().playSong(song('solo'));
    await vi.advanceTimersByTimeAsync(0);
    st().enqueue(song('sim2'));
    expect(next()).toEqual(['queued:sim2', 'autoplay:sim1']);
  });

  it('is off with repeat on, and switching Autoplay off takes its songs out', async () => {
    useSettingsStore.setState({ autoplay: true });
    autoplayMock.mockResolvedValue([song('sim')]);
    st().playSong(song('solo'));
    await vi.advanceTimersByTimeAsync(0);
    expect(next()).toEqual(['autoplay:sim']);
    useSettingsStore.setState({ autoplay: false });
    expect(next()).toEqual([]);
    useSettingsStore.setState({ autoplay: true });
    st().cycleRepeat(); // all
    autoplayMock.mockClear();
    st().next();
    await vi.advanceTimersByTimeAsync(0);
    expect(autoplayMock).not.toHaveBeenCalled();
    expect(now()).toBe('solo'); // repeat all plays the list again
  });

  it('ignores songs that arrive after the listener started something else', async () => {
    useSettingsStore.setState({ autoplay: true });
    let resolve!: (s: Song[]) => void;
    autoplayMock.mockReturnValueOnce(new Promise<Song[]>((r) => (resolve = r)));
    st().playSong(song('solo'));
    st().playQueue([song('x'), song('y'), song('z'), song('w')], 0);
    resolve([song('late')]);
    await vi.advanceTimersByTimeAsync(0);
    expect(ids()).not.toContain('late');
  });
});

describe('repeat', () => {
  it('repeat all plays the list again from its top; your adds play once', () => {
    st().playQueue([song('a'), song('b')], 0);
    st().enqueue(song('q'));
    st().cycleRepeat();
    expect(st().repeat).toBe('all');
    st().next(); // q
    st().next(); // b
    st().next(); // a again
    expect(now()).toBe('a');
    expect(next()).toEqual(['context:b']);
  });

  it('repeat all with shuffle gives the list a fresh order, never the song that just ended first', () => {
    st().playQueue([song('a'), song('b'), song('c')], 0);
    usePlayerStore.setState({ repeat: 'all' });
    st().toggleShuffle();
    st().next();
    st().next();
    const ended = now();
    st().next();
    expect(now()).not.toBe(ended);
    expect(new Set(ids().slice(-3))).toEqual(new Set(['a', 'b', 'c']));
  });
});

describe('1.15 — Spotify-style shuffle, queue order and Playing from', () => {
  const ids = () => usePlayerStore.getState().queue.map((s) => s.id);
  const album = () => ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => song(id));

  it('shuffle on reorders what is still to come, and the queue order is the play order', () => {
    usePlayerStore.getState().playQueue(album(), 1);
    usePlayerStore.getState().enqueue(song('mine'));
    usePlayerStore.getState().toggleShuffle();
    const q = ids();
    expect(q.slice(0, 3)).toEqual(['a', 'b', 'mine']); // history, the song playing, then your adds
    expect([...q.slice(3)].sort()).toEqual(['c', 'd', 'e', 'f']);
    usePlayerStore.getState().next();
    usePlayerStore.getState().next();
    expect(usePlayerStore.getState().queue[usePlayerStore.getState().index].id).toBe(q[3]);
    // Back is the song before, not a random one.
    usePlayerStore.getState().prev();
    expect(usePlayerStore.getState().queue[usePlayerStore.getState().index].id).toBe('mine');
  });

  it('shuffle off puts the list back in its order, carrying on from the song playing', () => {
    usePlayerStore.getState().playQueue(album(), 0);
    usePlayerStore.getState().toggleShuffle();
    usePlayerStore.getState().next();
    const playing = usePlayerStore.getState().queue[1].id;
    usePlayerStore.getState().toggleShuffle();
    const rest = ids().slice(2);
    const order = ['a', 'b', 'c', 'd', 'e', 'f'];
    const after = order.slice(order.indexOf(playing) + 1);
    const before = order.slice(1, order.indexOf(playing));
    expect(rest).toEqual([...after, ...before]);
  });

  it('a list started with shuffle on begins with the tapped song; Shuffle play starts anywhere and turns shuffle on', () => {
    usePlayerStore.setState({ shuffle: true });
    usePlayerStore.getState().playQueue(album(), 3);
    expect(ids()[0]).toBe('d');
    expect(usePlayerStore.getState().index).toBe(0);
    usePlayerStore.setState({ shuffle: false });
    usePlayerStore.getState().playQueue(album(), 0, { shuffle: true });
    expect(usePlayerStore.getState().shuffle).toBe(true);
    expect(usePlayerStore.getState().index).toBe(0);
    expect([...ids()].sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    // Turning it off still restores the album's real order.
    usePlayerStore.getState().toggleShuffle();
    const order = ['a', 'b', 'c', 'd', 'e', 'f'];
    const first = ids()[0];
    expect(ids().slice(1)).toEqual([...order.slice(order.indexOf(first) + 1), ...order.slice(0, order.indexOf(first))]);
  });

  it('remembers what it is playing from: the caller, else the page', () => {
    usePlayerStore.getState().playQueue(album(), 0, { from: { kind: 'album', label: 'Pushpa 2', path: '/album/1' } });
    expect(usePlayerStore.getState().context).toEqual({ kind: 'album', label: 'Pushpa 2', path: '/album/1' });
    window.history.pushState({}, '', '/favorites');
    usePlayerStore.getState().playQueue(album(), 0);
    expect(usePlayerStore.getState().context).toMatchObject({ kind: 'liked', label: 'Liked songs' });
    window.history.pushState({}, '', '/');
    usePlayerStore.getState().startRadio(song('seed'));
    expect(usePlayerStore.getState().context).toMatchObject({ kind: 'radio', label: 'seed radio' });
    usePlayerStore.getState().clearQueue();
    expect(usePlayerStore.getState().context).toBeNull();
  });
});
