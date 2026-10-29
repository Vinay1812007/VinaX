// @vitest-environment jsdom
/** 1.3 — the catalogue feed hooks: languages the feed knows, the "Most Searched" pick, misses as errors. */
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Playlist } from '@/types';
import { makeSong } from '@/__fixtures__/songs';

const getCharts = vi.fn();
const getPlaylist = vi.fn();
const getNewReleases = vi.fn();

vi.mock('@/services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api')>();
  return {
    API_LANGUAGES: actual.API_LANGUAGES,
    getCharts: (...a: unknown[]) => getCharts(...a),
    getPlaylist: (...a: unknown[]) => getPlaylist(...a),
    getNewReleases: (...a: unknown[]) => getNewReleases(...a),
    getFeaturedPlaylists: vi.fn(),
    getTrendingSongs: vi.fn(),
  };
});

import { feedLanguages, pickMostSearched, playlistSubtitle, useCatalogueCharts, useMostSearchedFeedSongs, useNewAlbums } from './useCatalogFeeds';
import { useSettingsStore } from '@/store/settingsStore';

const playlist = (id: string, title: string, over: Partial<Playlist> = {}): Playlist => ({
  kind: 'playlist', id, title, subtitle: '', images: [], songs: [], songCount: null, language: null, ...over,
});

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  getCharts.mockReset();
  getPlaylist.mockReset();
  getNewReleases.mockReset();
  useSettingsStore.setState({ pinnedLanguages: ['telugu', 'hindi'] });
});
afterEach(cleanup);

describe('helpers', () => {
  it('keeps only the languages the feed understands', () => {
    expect(feedLanguages(['telugu', 'konkani', 'hindi'])).toEqual(['telugu', 'hindi']);
    expect(feedLanguages(['sanskrit'])).toEqual([]);
  });

  it('picks the "Most Searched" chart in the first language, else the first one', () => {
    const charts = [
      playlist('1', 'Trending Today', { language: 'telugu' }),
      playlist('2', 'Most Searched Songs - Hindi', { language: 'hindi' }),
      playlist('3', 'Most Searched Songs - Telugu', { language: 'telugu' }),
    ];
    expect(pickMostSearched(charts, 'telugu')?.id).toBe('3');
    expect(pickMostSearched(charts, 'tamil')?.id).toBe('2');
    expect(pickMostSearched([charts[0]], 'telugu')).toBeNull();
  });

  it('never shows the source’s name as a playlist subtitle', () => {
    expect(playlistSubtitle(playlist('1', 'X', { subtitle: 'JioSaavn', language: 'hindi' }))).toBe('Hindi · Playlist');
    expect(playlistSubtitle(playlist('1', 'X', { subtitle: '12.8K Followers' }))).toBe('12.8K Followers');
    expect(playlistSubtitle(playlist('1', 'X', { songCount: 21 }))).toBe('21 songs');
  });
});

describe('feed hooks', () => {
  it('reads the most-searched chart playlist’s songs', async () => {
    getCharts.mockResolvedValue([playlist('3', 'Most Searched Songs - Telugu', { language: 'telugu' })]);
    getPlaylist.mockResolvedValue(playlist('3', 'Most Searched Songs - Telugu', { songs: [makeSong('m1'), makeSong('m2')] }));
    const { result } = renderHook(() => useMostSearchedFeedSongs(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((s) => s.id)).toEqual(['m1', 'm2']);
    expect(getCharts.mock.calls[0][0]).toEqual(['telugu', 'hindi']);
    expect(getPlaylist).toHaveBeenCalledWith('3');
  });

  it('is an error when no "Most Searched" chart exists', async () => {
    getCharts.mockResolvedValue([playlist('1', 'Trending Today')]);
    const { result } = renderHook(() => useMostSearchedFeedSongs(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(getPlaylist).not.toHaveBeenCalled();
  });

  it('does not ask the feed when no pinned language is one it knows', async () => {
    useSettingsStore.setState({ pinnedLanguages: ['konkani'] });
    const { result } = renderHook(() => useCatalogueCharts(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(getCharts).not.toHaveBeenCalled();
  });

  it('treats new releases without albums as a miss', async () => {
    getNewReleases.mockResolvedValue({ songs: [makeSong('n1')], albums: [] });
    const { result } = renderHook(() => useNewAlbums(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
