// @vitest-environment jsdom
/**
 * 1.3 — /trending reads the catalogue's trending feed and /most-searched its
 * "Most Searched Songs" chart playlist; both fall back to the search seed when
 * the catalogue misses. /top-songs reads "Most played on VinaX this week"
 * (GET /api/charts/vinax) and stays on the search while fewer than ten of its
 * songs pass the listener's safety rules.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';
import { makeSong } from '@/__fixtures__/songs';

const getTrendingSongs = vi.fn();
const getCharts = vi.fn();
const getPlaylist = vi.fn();
const getSong = vi.fn();
vi.mock('@/services/api', () => ({
  getSong: (id: string) => getSong(id),
  API_LANGUAGES: ['hindi', 'telugu'],
  getTrendingSongs: (...a: unknown[]) => getTrendingSongs(...a),
  getCharts: (...a: unknown[]) => getCharts(...a),
  getPlaylist: (...a: unknown[]) => getPlaylist(...a),
}));
vi.mock('@/store/playerStore', () => ({ usePlayerStore: (sel: (s: { playQueue: () => void }) => unknown) => sel({ playQueue: vi.fn() }) }));
vi.mock('@/components/SongRow', () => ({ SongRow: ({ song }: { song: Song }) => <p>{song.title}</p> }));

const searchSongs = [makeSong('s1', { title: 'Search One' }), makeSong('s2', { title: 'Search Two' })];
const searchEnabled: boolean[] = [];
vi.mock('@/features/search/useInfiniteSongs', () => ({
  useInfiniteSongs: (_q: string, enabled = true) => {
    searchEnabled.push(enabled);
    return enabled
      ? { isLoading: false, isError: false, data: { pages: [searchSongs] }, hasNextPage: false, refetch: vi.fn() }
      : { isLoading: false, isError: false, data: undefined, hasNextPage: false, refetch: vi.fn() };
  },
  flattenSongPages: (pages?: unknown[][]) => (pages ?? []).flat(),
}));

import ChartLandingPage, { type ChartVariant } from './ChartLandingPage';
import { useSettingsStore } from '@/store/settingsStore';

function mount(variant: ChartVariant) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ChartLandingPage variant={variant} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getTrendingSongs.mockReset().mockRejectedValue(new Error('route not found'));
  getCharts.mockReset().mockRejectedValue(new Error('route not found'));
  getPlaylist.mockReset().mockRejectedValue(new Error('down'));
  getSong.mockReset().mockImplementation(async (id: string) => makeSong(id, { title: `Chart ${id}`, language: 'hindi', explicit: id === 'v1' || id === 'v2' }));
  searchEnabled.length = 0;
  useSettingsStore.setState({ pinnedLanguages: ['hindi'], mutedLanguages: [], kidMode: false });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ChartLandingPage', () => {
  it('/trending lists the catalogue’s trending feed without running the search', async () => {
    getTrendingSongs.mockResolvedValue([makeSong('t1', { title: 'Trending One', language: 'hindi' })]);
    mount('trending');
    expect(await screen.findByText('Trending One')).toBeTruthy();
    expect(screen.queryByText('Search One')).toBeNull();
    expect(searchEnabled[searchEnabled.length - 1]).toBe(false);
  });

  it('/trending falls back to the search when the feed misses', async () => {
    mount('trending');
    expect(await screen.findByText('Search One')).toBeTruthy();
    expect(getTrendingSongs).toHaveBeenCalled();
  });

  it('/trending hides songs the listener has muted, and falls back when none are left', async () => {
    useSettingsStore.setState({ mutedLanguages: ['tamil'] });
    getTrendingSongs.mockResolvedValue([makeSong('t1', { title: 'Tamil One', language: 'tamil' })]);
    mount('trending');
    expect(await screen.findByText('Search One')).toBeTruthy();
    expect(screen.queryByText('Tamil One')).toBeNull();
  });

  it('/most-searched plays the catalogue’s "Most Searched Songs" chart', async () => {
    getCharts.mockResolvedValue([
      { kind: 'playlist', id: '9', title: 'Trending Today', subtitle: '', images: [], songs: [], songCount: null, language: 'hindi' },
      { kind: 'playlist', id: '946682072', title: 'Most Searched Songs - Hindi', subtitle: '', images: [], songs: [], songCount: null, language: 'hindi' },
    ]);
    getPlaylist.mockResolvedValue({ kind: 'playlist', id: '946682072', title: 'Most Searched Songs - Hindi', subtitle: '', images: [], songs: [makeSong('m1', { title: 'Searched One' })], songCount: 1, language: 'hindi' });
    mount('most-searched');
    expect(await screen.findByText('Searched One')).toBeTruthy();
    expect(getPlaylist).toHaveBeenCalledWith('946682072');
    expect(screen.queryByText('Search One')).toBeNull();
  });

  it('/most-searched falls back to the search when the chart cannot be read', async () => {
    getCharts.mockResolvedValue([{ kind: 'playlist', id: '946682072', title: 'Most Searched Songs - Hindi', subtitle: '', images: [], songs: [], songCount: null, language: 'hindi' }]);
    mount('most-searched');
    expect(await screen.findByText('Search One')).toBeTruthy();
  });

  const chart = (n: number) => new Response(JSON.stringify({ songs: Array.from({ length: n }, (_, i) => ({ id: `v${i + 1}`, title: `Chart v${i + 1}`, artist: 'A', image: null, rank: i + 1 })) }), { status: 200, headers: { 'content-type': 'application/json' } });

  it('/top-songs lists "Most played on VinaX this week" without running the search', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => chart(12)));
    mount('top');
    expect(await screen.findByText('Chart v12')).toBeTruthy();
    expect(screen.getByText('Most played on VinaX this week')).toBeTruthy();
    expect(screen.queryByText('Search One')).toBeNull();
    expect(searchEnabled[searchEnabled.length - 1]).toBe(false);
    expect(getTrendingSongs).not.toHaveBeenCalled();
  });

  it('/top-songs stays on the search while fewer than ten chart songs are allowed', async () => {
    // Twelve on the chart, two explicit: Kid mode leaves ten — still a chart.
    useSettingsStore.setState({ kidMode: true });
    vi.stubGlobal('fetch', vi.fn(async () => chart(12)));
    const first = mount('top');
    expect(await screen.findByText('Chart v12')).toBeTruthy();
    expect(screen.queryByText('Chart v1')).toBeNull();
    first.unmount();
    // Eleven, two explicit: nine left, so the search seed shows instead.
    vi.stubGlobal('fetch', vi.fn(async () => chart(11)));
    mount('top');
    expect(await screen.findByText('Search One')).toBeTruthy();
    expect(screen.queryByText('Most played on VinaX this week')).toBeNull();
  });

  it('/top-songs stays on the search when the chart is short or cannot be read, and looks nothing up', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => chart(9)));
    mount('top');
    expect(await screen.findByText('Search One')).toBeTruthy();
    expect(getSong).not.toHaveBeenCalled();
    expect(getCharts).not.toHaveBeenCalled();
  });
});
