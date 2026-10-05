// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { Album, Artist, SearchResults, Song } from '@/types';

const { searchAll } = vi.hoisted(() => ({ searchAll: vi.fn() }));
vi.mock('@/services/api/saavn', () => ({ searchAll }));

import { QUICK_DEBOUNCE_MS, useQuickResults } from './useQuickResults';
import {
  clearQuickCache,
  fetchQuickResults,
  getCachedQuick,
  putCachedQuick,
  QUICK_ALBUMS,
  QUICK_ARTISTS,
  QUICK_CACHE_MAX,
  QUICK_LIMIT,
  QUICK_TTL_MS,
  quickCacheSize,
} from './quickResults';

const song = (id: string): Song => ({
  kind: 'song',
  id,
  title: id,
  subtitle: '',
  artists: [],
  album: null,
  images: [],
  audio: [],
  duration: null,
  language: null,
  year: null,
  explicit: false,
  hasLyrics: false,
  playCount: null,
});

const artist = (id: string): Artist => ({ kind: 'artist', id, name: id, subtitle: 'Artist', images: [], bio: null, topSongs: [], albums: [] });
const album = (id: string): Album => ({ kind: 'album', id, title: id, subtitle: '', images: [], artists: [], songs: [], songCount: null, year: null, language: null });
const all = (songs: Song[], artists: Artist[] = [], albums: Album[] = []): SearchResults => ({ songs, artists, albums, playlists: [] });

describe('quick results cache (v5.19.0)', () => {
  beforeEach(() => clearQuickCache());

  it('caps entries at QUICK_LIMIT and expires them after the TTL', () => {
    const many = Array.from({ length: 10 }, (_, i) => song(`s${i}`));
    putCachedQuick('kesariya', { songs: many, artists: many.map((s) => artist(s.id)), albums: many.map((s) => album(s.id)) }, 1000);
    const hit = getCachedQuick('kesariya', 1000);
    expect(hit?.songs.length).toBe(QUICK_LIMIT);
    expect(hit?.artists.length).toBe(QUICK_ARTISTS);
    expect(hit?.albums.length).toBe(QUICK_ALBUMS);
    expect(getCachedQuick('kesariya', 1000 + QUICK_TTL_MS + 1)).toBeNull();
    expect(quickCacheSize()).toBe(0);
  });

  it('evicts the least recently used entry past QUICK_CACHE_MAX', () => {
    for (let i = 0; i < QUICK_CACHE_MAX; i += 1) putCachedQuick(`q${i}`, { songs: [song('x')] });
    getCachedQuick('q0'); // touch → q1 becomes the oldest
    putCachedQuick('overflow', { songs: [song('y')] });
    expect(quickCacheSize()).toBe(QUICK_CACHE_MAX);
    expect(getCachedQuick('q0')).not.toBeNull();
    expect(getCachedQuick('q1')).toBeNull();
  });

  it('fetches once per key, serves repeats from cache, and asks as an interactive call', async () => {
    const search = vi.fn(async () => all([song('a'), song('b')], [artist('x')], [album('y')]));
    const first = await fetchQuickResults('tum hi ho', undefined, search);
    expect(first.songs.map((s) => s.id)).toEqual(['a', 'b']);
    expect(first.artists.map((a) => a.id)).toEqual(['x']);
    expect(first.albums.map((a) => a.id)).toEqual(['y']);
    expect((await fetchQuickResults('tum hi ho', undefined, search)).songs.map((s) => s.id)).toEqual(['a', 'b']);
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith('tum hi ho', { signal: undefined, priority: 'interactive' });
  });

  it('never caches a result that arrived after its request was aborted', async () => {
    const ctrl = new AbortController();
    const search = vi.fn(async () => {
      ctrl.abort();
      return all([song('late')]);
    });
    await expect(fetchQuickResults('late', ctrl.signal, search)).rejects.toMatchObject({ name: 'AbortError' });
    expect(getCachedQuick('late')).toBeNull();
  });
});

describe('useQuickResults', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearQuickCache();
    searchAll.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  const settle = async () => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(QUICK_DEBOUNCE_MS);
    });
  };

  it('shows the songs for the settled key', async () => {
    searchAll.mockResolvedValue(all([song('a'), song('b')]));
    const { result } = renderHook(({ k }) => useQuickResults(k), { initialProps: { k: 'kesariya' } });
    expect(result.current.loading).toBe(true);
    await settle();
    expect(result.current).toMatchObject({ key: 'kesariya', loading: false, stale: false });
    expect(result.current.hits.songs.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it("drops the previous query's songs when the next fetch fails", async () => {
    searchAll.mockResolvedValueOnce(all([song('a')]));
    const { result, rerender } = renderHook(({ k }) => useQuickResults(k), { initialProps: { k: 'kesariya' } });
    await settle();
    expect(result.current.hits.songs).toHaveLength(1);

    searchAll.mockRejectedValueOnce(new Error('offline'));
    rerender({ k: 'pushpa' });
    expect(result.current.stale).toBe(true); // old songs, dimmed, while loading
    await settle();
    expect(result.current).toMatchObject({ key: 'pushpa', hits: { songs: [], artists: [], albums: [] }, loading: false, stale: false });
  });

  it('an aborted request (the listener typed on) leaves the panel alone', async () => {
    searchAll.mockResolvedValueOnce(all([song('a')]));
    const { result, rerender } = renderHook(({ k }) => useQuickResults(k), { initialProps: { k: 'kesariya' } });
    await settle();

    searchAll.mockImplementationOnce(
      (_q: string, opts?: { signal?: AbortSignal }) =>
        new Promise<SearchResults>((_, reject) => {
          opts?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );
    rerender({ k: 'push' });
    await settle(); // request for "push" in flight
    searchAll.mockResolvedValueOnce(all([song('p')]));
    rerender({ k: 'pushpa' }); // aborts it
    expect(result.current.hits.songs.map((s) => s.id)).toEqual(['a']);
    await settle();
    expect(result.current.hits.songs.map((s) => s.id)).toEqual(['p']);
  });
});
