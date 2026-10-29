// @vitest-environment jsdom
/**
 * 1.3 — "Trending albums" and "Trending artists" read the catalogue's trending
 * feed first and say so; the search fallback keeps the 7.2 label, which never
 * calls a search result a chart.
 */
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Album, Song } from '@/types';
import { makeSong } from '@/__fixtures__/songs';

const getTrendingAlbums = vi.fn<(langs: string[]) => Promise<Album[]>>();
const getTrendingSongs = vi.fn<(langs: string[]) => Promise<Song[]>>();
const searchAlbums = vi.fn<(q: string) => Promise<Album[]>>();
const searchSongsPage = vi.fn<(q: string) => Promise<Song[]>>();

vi.mock('@/services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api')>();
  return {
    API_LANGUAGES: actual.API_LANGUAGES,
    getTrendingAlbums: (langs: string[]) => getTrendingAlbums(langs),
    getTrendingSongs: (langs: string[]) => getTrendingSongs(langs),
    searchAlbums: (q: string) => searchAlbums(q),
    searchSongsPage: (q: string) => searchSongsPage(q),
  };
});

import { CATALOGUE_SEARCH_PROVENANCE, CATALOGUE_TRENDING_PROVENANCE, useTrendingAlbums, useTrendingArtists } from './useTrendingShelves';
import { useSettingsStore } from '@/store/settingsStore';

const album = (id: string): Album => ({ kind: 'album', id, title: `Album ${id}`, subtitle: '', images: [], songs: [], year: null, language: 'telugu', artists: [], songCount: null });

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  getTrendingAlbums.mockReset();
  getTrendingSongs.mockReset();
  searchAlbums.mockReset().mockResolvedValue([album('s1'), album('s2')]);
  searchSongsPage.mockReset().mockResolvedValue([makeSong('x1', { artist: 'Search Artist' })]);
  useSettingsStore.setState({ pinnedLanguages: ['telugu'], mutedLanguages: [], kidMode: false });
});

afterEach(cleanup);

describe('useTrendingAlbums', () => {
  it('uses the trending feed and labels it as the catalogue’s trending list', async () => {
    getTrendingAlbums.mockResolvedValue([album('t1'), album('t2'), album('t3')]);
    const { result } = renderHook(() => useTrendingAlbums(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.map((a) => a.id)).toEqual(['t1', 't2', 't3']);
    expect(result.current.provenance).toBe(CATALOGUE_TRENDING_PROVENANCE);
    expect(result.current.provenance.label).not.toMatch(/chart/i);
    expect(getTrendingAlbums).toHaveBeenCalledWith(['telugu']);
    expect(searchAlbums).not.toHaveBeenCalled();
  });

  it('falls back to the album search, labelled as a search', async () => {
    getTrendingAlbums.mockRejectedValue(new Error('route not found'));
    const { result } = renderHook(() => useTrendingAlbums(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.map((a) => a.id)).toEqual(['s1', 's2']);
    expect(result.current.provenance).toBe(CATALOGUE_SEARCH_PROVENANCE);
  });

  it('labels the shelf as a search until data arrives', () => {
    getTrendingAlbums.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useTrendingAlbums(), { wrapper });
    expect(result.current.data).toBeUndefined();
    expect(result.current.provenance).toBe(CATALOGUE_SEARCH_PROVENANCE);
  });
});

describe('useTrendingArtists', () => {
  it('counts artists across the trending feed', async () => {
    getTrendingSongs.mockResolvedValue([
      makeSong('a1', { title: 'One', artist: 'Sid Sriram' }),
      makeSong('a2', { title: 'Two', artist: 'Sid Sriram' }),
      makeSong('a3', { title: 'Three', artist: 'Shreya Ghoshal' }),
    ]);
    const { result } = renderHook(() => useTrendingArtists(), { wrapper });
    await waitFor(() => expect(result.current.data.length).toBe(2));
    expect(result.current.data[0]).toMatchObject({ name: 'Sid Sriram', plays: 2 });
    expect(result.current.provenance).toBe(CATALOGUE_TRENDING_PROVENANCE);
    expect(searchSongsPage).not.toHaveBeenCalled();
  });

  it('falls back to the song searches when the feed rejects', async () => {
    getTrendingSongs.mockRejectedValue(new Error('down'));
    const { result } = renderHook(() => useTrendingArtists(), { wrapper });
    await waitFor(() => expect(result.current.data.length).toBe(1));
    expect(result.current.data[0].name).toBe('Search Artist');
    expect(result.current.provenance).toBe(CATALOGUE_SEARCH_PROVENANCE);
  });
});
