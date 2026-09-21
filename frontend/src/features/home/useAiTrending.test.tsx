// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';
import { makeSong } from '@/__fixtures__/songs';

/**
 * 7.2 — "Trending for you" must apply the listener's CURRENT safety settings
 * to the cached curation and to placeholder data, without curating again.
 */
vi.mock('@/services/native', () => ({ isNativePlatform: () => false, platformName: () => 'web', haptic: () => undefined }));
vi.mock('./useAppConfig', () => ({ useFeatureEnabled: () => false }));
let pool: { data: Song[] | undefined; isLoading: boolean } = { data: undefined, isLoading: true };
vi.mock('./useHomeShelves', () => ({ useTrendingNow: () => pool }));
vi.mock('@/services/ai/trending', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/ai/trending')>();
  return { ...actual, curateTrending: vi.fn(actual.curateTrending) };
});

import { useAiTrending } from './useAiTrending';
import { curateTrending } from '@/services/ai/trending';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { softMuteArtist } from '@/services/personalization/updater';
import { loadBlocklist } from '@/services/content/blocklist';

const curate = vi.mocked(curateTrending);
const base = (): Song[] => [
  makeSong('explicit', { artist: 'E', explicit: true }),
  makeSong('hindi', { artist: 'H', language: 'hindi' }),
  makeSong('by-hidden', { artist: 'Hidden Artist' }),
  makeSong('soft', { artist: 'Soft Muted Two' }),
  makeSong('to-hide', { artist: 'T' }),
  ...Array.from({ length: 5 }, (_, i) => makeSong(`ok${i}`, { artist: `Ok ${i}` })),
];

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const view = renderHook(() => useAiTrending(), { wrapper });
  const shown = () => view.result.current.songs.map((s) => s.id);
  return { ...view, shown };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  curate.mockClear();
  pool = { data: base(), isLoading: false };
  useSettingsStore.setState({ aiHomeShelves: true, pinnedLanguages: ['telugu'], mutedLanguages: [], kidMode: false, discoveryMode: 'balanced' });
  useLibraryStore.setState({ hiddenSongIds: [], hiddenArtists: [] });
});
afterEach(cleanup);

describe('useAiTrending — current safety on the cached curation', () => {
  it('hiding a song or an artist removes it at once, without curating again', async () => {
    const { shown } = setup();
    await waitFor(() => expect(shown()).toContain('to-hide'));
    act(() => useLibraryStore.getState().toggleHidden('to-hide'));
    expect(shown()).not.toContain('to-hide');
    act(() => useLibraryStore.getState().toggleHiddenArtist('Hidden Artist'));
    expect(shown()).not.toContain('by-hidden');
    expect(curate).toHaveBeenCalledTimes(1);
  });

  it('Kid mode removes an explicit song at once — also while the pool reloads — and does not curate the smaller pool again', async () => {
    const { shown, result, rerender } = setup();
    await waitFor(() => expect(shown()).toContain('explicit'));
    // Kid mode changes the pool's own cache key: it reloads, then comes back without the explicit song.
    pool = { data: undefined, isLoading: true };
    act(() => useSettingsStore.setState({ kidMode: true }));
    rerender();
    expect(shown()).not.toContain('explicit');
    expect(result.current.songs.length).toBeGreaterThan(0);
    pool = { data: base().filter((s) => !s.explicit), isLoading: false };
    rerender();
    await new Promise((r) => setTimeout(r, 20));
    expect(shown()).not.toContain('explicit');
    expect(shown()).toContain('ok0');
    expect(curate).toHaveBeenCalledTimes(1);
  });

  it('muting a language removes its songs without curating again', async () => {
    const { shown, rerender } = setup();
    await waitFor(() => expect(shown()).toContain('hindi'));
    act(() => useSettingsStore.setState({ mutedLanguages: ['hindi'] }));
    expect(shown()).not.toContain('hindi');
    pool = { data: base().filter((s) => s.language !== 'hindi'), isLoading: false };
    rerender();
    await new Promise((r) => setTimeout(r, 20));
    expect(shown()).not.toContain('hindi');
    expect(curate).toHaveBeenCalledTimes(1);
  });

  it('"Show fewer like this" removes the artist as soon as the tap lands', async () => {
    const { shown } = setup();
    await waitFor(() => expect(shown()).toContain('soft'));
    act(() => {
      softMuteArtist(makeSong('soft', { artist: 'Soft Muted Two' }), 14);
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await waitFor(() => expect(shown()).not.toContain('soft'));
    expect(curate).toHaveBeenCalledTimes(1);
  });

  it('filters placeholder data while a new curation is on its way', async () => {
    const { shown, rerender } = setup();
    await waitFor(() => expect(shown()).toContain('to-hide'));
    curate.mockImplementationOnce(() => new Promise(() => undefined)); // the next curation never lands
    act(() => useSettingsStore.setState({ discoveryMode: 'discover' }));
    rerender();
    await waitFor(() => expect(curate).toHaveBeenCalledTimes(2));
    expect(shown()).toContain('to-hide'); // the placeholder is still on screen
    act(() => useLibraryStore.getState().toggleHidden('to-hide'));
    expect(shown()).not.toContain('to-hide');
    expect(shown()).toContain('ok0');
  });

  it('honours the server blocklist for songs fetched before it arrived', async () => {
    const { shown, rerender } = setup();
    await waitFor(() => expect(shown()).toContain('ok3'));
    const serve = (body: unknown) => vi.fn(async () => ({ ok: true, json: async () => body }));
    vi.stubGlobal('fetch', serve({ ids: ['ok3'], artists: ['ok 4'], keywords: [] }));
    await loadBlocklist();
    rerender();
    expect(shown()).not.toContain('ok3');
    expect(shown()).not.toContain('ok4');
    expect(curate).toHaveBeenCalledTimes(1);
    vi.stubGlobal('fetch', serve({ ids: [], artists: [], keywords: [] }));
    await loadBlocklist();
    vi.unstubAllGlobals();
  });

  it('a genuinely new trending pool is curated', async () => {
    const { shown, rerender } = setup();
    await waitFor(() => expect(shown()).toContain('ok0'));
    pool = { data: [...base(), makeSong('new', { artist: 'Newcomer' })], isLoading: false };
    rerender();
    await waitFor(() => expect(shown()).toContain('new'));
    expect(curate).toHaveBeenCalledTimes(2);
  });
});
