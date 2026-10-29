// @vitest-environment jsdom
/**
 * 1.3 — a catalogue mood or genre page (/browse/:id): header, language
 * chips, playlists and playable songs; a failing API shows the error state.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowseDetail } from '@/services/api';
import { makeSong } from '@/__fixtures__/songs';

vi.mock('@/services/audio/engine', () => ({
  audioEngine: { load: vi.fn(), preloadNext: vi.fn(), pause: vi.fn(), play: vi.fn(), seek: vi.fn(), setVolume: vi.fn(), setMuted: vi.fn() },
  orderedSources: () => [],
}));
vi.mock('@/services/media-session', () => ({
  setMediaHandlers: vi.fn(), updateMediaMetadata: vi.fn(), updatePlaybackState: vi.fn(), updatePositionState: vi.fn(),
}));
vi.mock('@/services/native', () => ({ checkNotificationOnFirstPlay: vi.fn(), haptic: vi.fn(), isNativePlatform: () => false, platformName: () => 'web' }));
const getBrowseCategory = vi.fn<(id: string, langs: string, limit?: number) => Promise<BrowseDetail>>();
vi.mock('@/services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api')>();
  return { ...actual, getBrowseCategory: (id: string, langs: string, limit?: number) => getBrowseCategory(id, langs, limit) };
});
const playPlaylist = vi.fn();
vi.mock('@/features/player/playEntity', () => ({ playPlaylist: (id: string, title: string) => playPlaylist(id, title) }));

import BrowseCategoryPage from './BrowseCategoryPage';
import { usePlayerStore } from '@/store/playerStore';
import { useSettingsStore } from '@/store/settingsStore';

const songs = [makeSong('s1', { title: 'Gehra Hua' }), makeSong('s2', { title: 'Saiyaara' })];
const detail = (over: Partial<BrowseDetail> = {}): BrowseDetail => ({
  id: '27',
  name: 'Romance',
  category: 'mood',
  tags: ['Romantic'],
  isNew: false,
  images: [],
  description: 'Songs like Gehra Hua and Saiyaara.',
  playlists: [{ kind: 'playlist', id: '1139074020', title: 'Most Streamed Love Songs: Hindi', subtitle: '30 Songs', images: [], songs: [], songCount: 30, language: null }],
  songs,
  ...over,
});

const playQueue = vi.fn();
function mount(path = '/browse/27') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/browse/:id" element={<BrowseCategoryPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getBrowseCategory.mockReset();
  playPlaylist.mockReset();
  playQueue.mockReset();
  usePlayerStore.setState({ playQueue });
  useSettingsStore.setState({ pinnedLanguages: ['tamil'] });
});
afterEach(cleanup);

describe('BrowseCategoryPage', () => {
  it('shows the header, playlists and songs in the first pinned language', async () => {
    getBrowseCategory.mockResolvedValue(detail());
    mount();
    expect(await screen.findByRole('heading', { name: 'Romance' })).toBeTruthy();
    expect(getBrowseCategory).toHaveBeenCalledWith('27', 'tamil', 10);
    expect(screen.getByText('Songs like Gehra Hua and Saiyaara.')).toBeTruthy();
    expect(screen.getByText('Mood')).toBeTruthy();
    expect(screen.getByText('Most Streamed Love Songs: Hindi')).toBeTruthy();
    expect(screen.getByText('Gehra Hua')).toBeTruthy();
    expect(screen.getByText('Saiyaara')).toBeTruthy();
    const card = screen.getAllByRole('link').find((a) => a.getAttribute('href')?.startsWith('/playlist/'));
    expect(card?.getAttribute('href')).toBe('/playlist/most-streamed-love-songs-hindi-1139074020');
    expect(screen.getByRole('link', { name: /Moods/ }).getAttribute('href')).toBe('/moods');
  });

  it('plays every song from the top', async () => {
    getBrowseCategory.mockResolvedValue(detail());
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Play all' }));
    expect(playQueue).toHaveBeenCalledWith(songs, 0);
  });

  it('switches language from the chips, and honours ?language=', async () => {
    getBrowseCategory.mockResolvedValue(detail());
    mount('/browse/27?language=punjabi');
    await screen.findByRole('heading', { name: 'Romance' });
    expect(getBrowseCategory).toHaveBeenLastCalledWith('27', 'punjabi', 10);
    expect(screen.getByRole('button', { name: 'Punjabi' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Hindi' }));
    await waitFor(() => expect(getBrowseCategory).toHaveBeenLastCalledWith('27', 'hindi', 10));
    expect(await screen.findByRole('heading', { name: 'Romance' })).toBeTruthy();
  });

  it('hides play-all when the category has only playlists', async () => {
    getBrowseCategory.mockResolvedValue(detail({ songs: [] }));
    mount();
    await screen.findByRole('heading', { name: 'Romance' });
    expect(screen.queryByRole('button', { name: 'Play all' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Top songs' })).toBeNull();
    expect(screen.getByText('Most Streamed Love Songs: Hindi')).toBeTruthy();
  });

  it('shows the error state, with the language chips, when the API is unavailable', async () => {
    getBrowseCategory.mockRejectedValue(new Error('unavailable'));
    mount();
    expect(await screen.findByText('This page isn’t available right now')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Language' })).toBeTruthy();
    getBrowseCategory.mockResolvedValue(detail());
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Romance' })).toBeTruthy();
  });
});
