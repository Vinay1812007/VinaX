// @vitest-environment jsdom
/**
 * 1.3 — Moods and Explore show the catalogue's moods & genres when the API
 * has them, and look as they did before when it does not.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowseCategory } from '@/services/api';

vi.mock('@/services/audio/engine', () => ({
  audioEngine: { load: vi.fn(), preloadNext: vi.fn(), pause: vi.fn(), play: vi.fn(), seek: vi.fn(), setVolume: vi.fn(), setMuted: vi.fn() },
  orderedSources: () => [],
}));
vi.mock('@/services/media-session', () => ({
  setMediaHandlers: vi.fn(), updateMediaMetadata: vi.fn(), updatePlaybackState: vi.fn(), updatePositionState: vi.fn(),
}));
vi.mock('@/services/native', () => ({ checkNotificationOnFirstPlay: vi.fn(), haptic: vi.fn(), isNativePlatform: () => false, platformName: () => 'web' }));
const getBrowseCategories = vi.fn<(langs: string) => Promise<BrowseCategory[]>>();
vi.mock('@/services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api')>();
  return { ...actual, getBrowseCategories: (langs: string) => getBrowseCategories(langs), searchSongs: vi.fn(async () => []) };
});

import MoodsPage from './MoodsPage';
import ExplorePage from './ExplorePage';
import { useSettingsStore } from '@/store/settingsStore';

const cat = (id: string, name: string, category: string, isNew = false): BrowseCategory => ({
  id, name, category, tags: [], isNew,
  images: [{ quality: '150x150', url: `https://c.saavncdn.com/editorial/${id}.jpg` }],
});
const list = [
  cat('27', 'Romance', 'mood'),
  cat('193', 'Carvaan', 'mood', true),
  cat('37', 'Hip Hop', 'genre'),
  cat('142', 'Podsnacks - Podcasts under 10 mins', 'music_plus'),
  ...Array.from({ length: 14 }, (_, i) => cat(`g${i}`, `Genre ${i}`, 'genre')),
];

function mount(page: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{page}</MemoryRouter>
    </QueryClientProvider>,
  );
}
const link = (name: RegExp | string) => screen.getByRole('link', { name }).getAttribute('href');

beforeEach(() => {
  getBrowseCategories.mockReset();
  useSettingsStore.setState({ pinnedLanguages: ['telugu'] });
});
afterEach(cleanup);

describe('MoodsPage — catalogue moods & genres', () => {
  it('groups the catalogue categories and links each to its page', async () => {
    getBrowseCategories.mockResolvedValue(list);
    mount(<MoodsPage />);
    expect(await screen.findByRole('heading', { name: 'Moods & moments' })).toBeTruthy();
    expect(getBrowseCategories).toHaveBeenCalledWith('telugu');
    expect(screen.getByRole('heading', { name: 'Genres' })).toBeTruthy();
    expect(link('Romance')).toBe('/browse/27');
    expect(link('Carvaan New')).toBe('/browse/193');
    expect(link('Hip Hop')).toBe('/browse/37');
    expect(screen.queryByText(/Podsnacks/)).toBeNull();
    // Twelve genres at first; the rest behind "Show all".
    expect(screen.queryByRole('link', { name: 'Genre 13' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show all 15' }));
    expect(await screen.findByRole('link', { name: 'Genre 13' })).toBeTruthy();
    // The curated moods are still there.
    expect(screen.getByRole('group', { name: 'Moods' })).toBeTruthy();
  });

  it('looks as it did before when the API is unavailable', async () => {
    getBrowseCategories.mockRejectedValue(new Error('unavailable'));
    mount(<MoodsPage />);
    await vi.waitFor(() => expect(getBrowseCategories).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByRole('group', { name: 'Moods' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Moods & moments' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Genres' })).toBeNull();
    expect(document.querySelector('a[href^="/browse/"]')).toBeNull();
  });
});

describe('ExplorePage — catalogue moods & genres', () => {
  it('surfaces a few categories, moods first', async () => {
    getBrowseCategories.mockResolvedValue(list);
    mount(<ExplorePage />);
    expect(await screen.findByRole('heading', { name: 'Moods & genres' })).toBeTruthy();
    expect(link('Romance')).toBe('/browse/27');
    expect(document.querySelectorAll('a[href^="/browse/"]')).toHaveLength(8);
  });

  it('leaves the section out when the API is unavailable', async () => {
    getBrowseCategories.mockRejectedValue(new Error('unavailable'));
    mount(<ExplorePage />);
    await vi.waitFor(() => expect(getBrowseCategories).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole('heading', { name: 'Moods & genres' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Any mood, your language' })).toBeTruthy();
  });
});
