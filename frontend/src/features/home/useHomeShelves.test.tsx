// @vitest-environment jsdom
/**
 * 1.3 — Trending and New releases ask the catalogue's feeds first and fall
 * back to the search pools: when the feed rejects, leaves too few songs after
 * the mute filter, or cannot serve one of the pinned languages.
 *
 * 1.14.4 — when the feed answers, a rotating search page joins it (the feed
 * is the same list on every call), and the shelf is ordered per generation.
 */
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';
import { makeSong } from '@/__fixtures__/songs';

const getTrendingSongs = vi.fn<(langs: string[], limit?: number) => Promise<Song[]>>();
const getNewReleases = vi.fn<(langs: string[], limit?: number) => Promise<{ songs: Song[]; albums: unknown[] }>>();
const searchSongs = vi.fn<(q: string, limit?: number) => Promise<Song[]>>();
const searchSongsPage = vi.fn<(q: string, page: number, limit: number) => Promise<Song[]>>();

vi.mock('@/services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api')>();
  return {
    API_LANGUAGES: actual.API_LANGUAGES,
    // Home reads the songs halves of /trending and /home; these mocks stand for those halves.
    getTrending: async (langs: string[], limit?: number) => ({ songs: await getTrendingSongs(langs, limit), albums: [], playlists: [] }),
    getHomeFeed: async (langs: string[], limit?: number) => {
      const r = await getNewReleases(langs, limit);
      return { newSongs: r.songs, newAlbums: r.albums, charts: [], featuredPlaylists: [] };
    },
    searchSongs: (q: string, limit?: number) => searchSongs(q, limit),
    searchSongsPage: (q: string, page: number, limit: number) => searchSongsPage(q, page, limit),
  };
});

import { MIN_FEED_SONGS, useNewForLanguage, useNewReleases, useTrendingForLanguage, useTrendingNow } from './useHomeShelves';
import { useSettingsStore } from '@/store/settingsStore';

const songs = (prefix: string, n: number, over: Partial<Song> = {}) =>
  Array.from({ length: n }, (_, i) => makeSong(`${prefix}${i}`, { title: `${prefix} song ${i}`, artist: `${prefix} artist ${i}`, ...over }));

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const ids = (list: Song[] | undefined) => (list ?? []).map((s) => s.id).sort();

beforeEach(() => {
  getTrendingSongs.mockReset();
  getNewReleases.mockReset();
  searchSongs.mockReset();
  searchSongsPage.mockReset();
  searchSongs.mockImplementation(async () => songs('search', 8));
  searchSongsPage.mockImplementation(async () => songs('search', 8));
  useSettingsStore.setState({ pinnedLanguages: ['telugu'], mutedLanguages: [], kidMode: false });
});

afterEach(cleanup);

describe('useTrendingNow', () => {
  it('uses the trending feed for the pinned languages, plus a rotating search page', async () => {
    useSettingsStore.setState({ pinnedLanguages: ['telugu', 'hindi'] });
    const feed = [...songs('te', 5), ...songs('hi', 5, { language: 'hindi' })];
    getTrendingSongs.mockResolvedValue(feed);
    const { result } = renderHook(() => useTrendingNow(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(ids(result.current.data)).toEqual(expect.arrayContaining(ids(feed)));
    expect(getTrendingSongs.mock.calls[0][0]).toEqual(['telugu', 'hindi']);
    expect(searchSongsPage).toHaveBeenCalled();
  });

  it('falls back to the search pool when the feed rejects', async () => {
    getTrendingSongs.mockRejectedValue(new Error('route not found'));
    const { result } = renderHook(() => useTrendingNow(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(ids(result.current.data)).toEqual(ids(songs('search', 8)));
    expect(searchSongsPage).toHaveBeenCalled();
  });

  it('falls back when the mute filter leaves fewer than the minimum', async () => {
    useSettingsStore.setState({ pinnedLanguages: ['telugu'], mutedLanguages: ['tamil'] });
    getTrendingSongs.mockResolvedValue([...songs('te', MIN_FEED_SONGS - 1), ...songs('ta', 6, { language: 'tamil' })]);
    const { result } = renderHook(() => useTrendingNow(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(ids(result.current.data)).toEqual(ids(songs('search', 8)));
    expect(result.current.data?.some((s) => s.language === 'tamil')).toBe(false);
  });

  it('never asks the feed for a language it cannot serve (it would answer in Hindi)', async () => {
    useSettingsStore.setState({ pinnedLanguages: ['telugu', 'konkani'] });
    const { result } = renderHook(() => useTrendingNow(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getTrendingSongs).not.toHaveBeenCalled();
    expect(searchSongsPage).toHaveBeenCalledTimes(2);
  });
});

describe('useNewReleases', () => {
  it('uses the songs half of the new-releases feed, with the search page after it when it fails', async () => {
    const feed = songs('new', 8);
    getNewReleases.mockResolvedValue({ songs: feed, albums: [] });
    searchSongsPage.mockRejectedValue(new Error('down'));
    const { result } = renderHook(() => useNewReleases(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(ids(result.current.data)).toEqual(ids(feed));
  });

  it('falls back to the search when the feed has no songs', async () => {
    getNewReleases.mockResolvedValue({ songs: [], albums: [{}] });
    const { result } = renderHook(() => useNewReleases(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(ids(result.current.data)).toEqual(ids(songs('search', 8)));
  });
});

describe('per-language shelves', () => {
  it('useTrendingForLanguage asks the feed for that one language', async () => {
    const feed = songs('ta', 7, { language: 'tamil' });
    getTrendingSongs.mockResolvedValue(feed);
    const { result } = renderHook(() => useTrendingForLanguage('tamil'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getTrendingSongs.mock.calls[0][0]).toEqual(['tamil']);
    expect(ids(result.current.data)).toEqual(expect.arrayContaining(ids(feed)));
  });

  it('useNewForLanguage falls back to the search seed when the feed rejects', async () => {
    getNewReleases.mockRejectedValue(new Error('down'));
    const { result } = renderHook(() => useNewForLanguage('telugu'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(searchSongsPage).toHaveBeenCalledWith(expect.stringMatching(/telugu/), expect.any(Number), 20);
    expect(ids(result.current.data)).toEqual(ids(songs('search', 8)));
  });
});

describe('a new Home generation shows different songs', () => {
  it('reorders the same feed when the generation moves, and puts songs heard lately at the back', async () => {
    const { refreshHome } = await import('./homeRefresh');
    const { useHistoryStore } = await import('@/store/historyStore');
    const feed = songs('te', 20);
    getTrendingSongs.mockResolvedValue(feed);
    searchSongsPage.mockResolvedValue([]);
    useHistoryStore.setState({ entries: [{ song: feed[0], ts: Date.now() - 60_000, completed: true }] });
    const first = renderHook(() => useTrendingNow(), { wrapper });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    const a = (first.result.current.data ?? []).map((s) => s.id);
    expect(a[a.length - 1]).toBe('te0');
    first.unmount();
    refreshHome();
    const second = renderHook(() => useTrendingNow(), { wrapper });
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));
    const b = (second.result.current.data ?? []).map((s) => s.id);
    expect(b.slice().sort()).toEqual(a.slice().sort());
    expect(b).not.toEqual(a);
    useHistoryStore.setState({ entries: [] });
  });
});
