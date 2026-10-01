// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';
import { makeSong } from '@/__fixtures__/songs';

/**
 * 7.2 — "Designed for you" must apply the listener's CURRENT safety settings
 * to cached and placeholder shelves, at once, without another design call.
 */
vi.mock('@/services/native', () => ({ isNativePlatform: () => false, platformName: () => 'web', haptic: () => undefined }));
const design = vi.fn();
vi.mock('@/services/ai/home', () => ({
  designHomeShelves: (...args: unknown[]) => design(...args),
  loadShownSongIds: () => [],
  recordShownShelves: () => undefined,
  recordShownSongs: () => undefined,
}));
const catalogue: Record<string, Song[]> = {};
vi.mock('@/services/api', () => ({
  searchSongs: async (q: string) => catalogue[q] ?? [],
  searchSongsPage: async () => [],
}));

import { useAiHome } from './useAiHome';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { softMuteArtist } from '@/services/personalization/updater';

const sections = [
  { title: 'Shelf one', description: 'd', query: 'q1', reason: 'r', type: 'other' as const },
  { title: 'Shelf two', description: 'd', query: 'q2', reason: 'r', type: 'other' as const },
];
const ok = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => makeSong(`${prefix}${i}`, { artist: `${prefix} artist ${i}` }));

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const view = renderHook(() => useAiHome(true), { wrapper });
  const shown = () => (view.result.current.data ?? []).flatMap((s) => s.songs.map((x) => x.id));
  return { ...view, shown };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  design.mockReset();
  design.mockResolvedValue(sections);
  catalogue.q1 = [makeSong('explicit', { artist: 'E', explicit: true }), makeSong('hindi', { artist: 'H', language: 'hindi' }), makeSong('by-hidden', { artist: 'Hidden Artist' }), makeSong('soft', { artist: 'Soft Muted' }), ...ok('a', 4)];
  catalogue.q2 = [...ok('b', 5), makeSong('to-hide', { artist: 'T' })];
  useSettingsStore.setState({ aiHomeShelves: true, pinnedLanguages: ['telugu'], mutedLanguages: [], kidMode: false, discoveryMode: 'balanced' });
  useLibraryStore.setState({ hiddenSongIds: [], hiddenArtists: [] });
});
afterEach(cleanup);

describe('useAiHome — current safety on cached shelves', () => {
  it('Kid mode removes an explicit song at once, without another design call', async () => {
    const { shown } = setup();
    await waitFor(() => expect(shown()).toContain('explicit'));
    act(() => useSettingsStore.setState({ kidMode: true }));
    expect(shown()).not.toContain('explicit');
    expect(design).toHaveBeenCalledTimes(1);
  });

  it('hiding a song or an artist removes it at once', async () => {
    const { shown } = setup();
    await waitFor(() => expect(shown()).toContain('to-hide'));
    act(() => useLibraryStore.getState().toggleHidden('to-hide'));
    expect(shown()).not.toContain('to-hide');
    act(() => useLibraryStore.getState().toggleHiddenArtist('Hidden Artist'));
    expect(shown()).not.toContain('by-hidden');
    expect(design).toHaveBeenCalledTimes(1);
  });

  it('muting a language removes its songs without designing the shelves again', async () => {
    const { shown } = setup();
    await waitFor(() => expect(shown()).toContain('hindi'));
    act(() => useSettingsStore.setState({ mutedLanguages: ['hindi'] }));
    expect(shown()).not.toContain('hindi');
    await new Promise((r) => setTimeout(r, 20));
    expect(shown()).not.toContain('hindi');
    expect(design).toHaveBeenCalledTimes(1);
  });

  it('"Show fewer like this" removes the artist as soon as the tap lands', async () => {
    const { shown } = setup();
    await waitFor(() => expect(shown()).toContain('soft'));
    act(() => {
      softMuteArtist(makeSong('soft', { artist: 'Soft Muted' }), 14);
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await waitFor(() => expect(shown()).not.toContain('soft'));
    expect(design).toHaveBeenCalledTimes(1);
  });

  it('filters placeholder shelves too, while a new design is on its way', async () => {
    const { shown, result } = setup();
    await waitFor(() => expect(shown()).toContain('to-hide'));
    design.mockImplementationOnce(() => new Promise(() => undefined)); // the next design never lands
    act(() => useSettingsStore.setState({ pinnedLanguages: ['telugu', 'tamil'] }));
    await waitFor(() => expect(design).toHaveBeenCalledTimes(2));
    expect(result.current.isPlaceholderData).toBe(true);
    act(() => useLibraryStore.getState().toggleHidden('to-hide'));
    expect(shown()).not.toContain('to-hide');
    expect(shown()).toContain('b0');
  });

  it('drops a shelf that safety leaves too short to show', async () => {
    catalogue.q1 = [...Array.from({ length: 4 }, (_, i) => makeSong(`x${i}`, { artist: `X ${i}`, explicit: i > 0 }))];
    const { result } = setup();
    await waitFor(() => expect(result.current.data?.length).toBe(2));
    act(() => useSettingsStore.setState({ kidMode: true }));
    expect(result.current.data?.map((s) => s.title)).toEqual(['Shelf two']);
  });
});

describe('useAiHome — the 9.0 refresh policy', () => {
  it('returning to Home inside the window reuses the design: one call for three visits', async () => {
    const { resetHomeGeneration } = await import('./homeRefresh');
    resetHomeGeneration();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    for (let visit = 0; visit < 3; visit += 1) {
      const view = renderHook(() => useAiHome(true), { wrapper });
      await waitFor(() => expect(view.result.current.data?.length).toBe(2));
      view.unmount();
    }
    expect(design).toHaveBeenCalledTimes(1);
  });

  it('an explicit refresh designs again and keeps the old shelves on screen meanwhile', async () => {
    const { refreshHome, resetHomeGeneration } = await import('./homeRefresh');
    resetHomeGeneration();
    const { shown, result } = setup();
    await waitFor(() => expect(shown()).toContain('b0'));
    design.mockImplementationOnce(() => new Promise(() => undefined));
    act(() => { refreshHome(); });
    await waitFor(() => expect(design).toHaveBeenCalledTimes(2));
    expect(result.current.isPlaceholderData).toBe(true);
    expect(shown()).toContain('b0');
  });

  it('a visit after the window designs again (expiry), a visit inside it does not', async () => {
    const { expireHomeIfStale, HOME_TTL_MS, resetHomeGeneration, homeGeneration } = await import('./homeRefresh');
    resetHomeGeneration(1_000);
    expect(expireHomeIfStale(1_000 + HOME_TTL_MS - 1)).toBe(1);
    expect(expireHomeIfStale(1_000 + HOME_TTL_MS)).toBe(2);
    expect(homeGeneration().startedAt).toBe(1_000 + HOME_TTL_MS);
  });
});
