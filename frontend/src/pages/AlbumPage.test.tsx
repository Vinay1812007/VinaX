// @vitest-environment jsdom
/** 1.3 — the album page's "More like this" shelf: the catalogue's similar albums, hidden when it has none. */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Album } from '@/types';
import { makeSong } from '@/__fixtures__/songs';

vi.mock('@/services/audio/engine', () => ({
  audioEngine: { load: vi.fn(), preloadNext: vi.fn(), pause: vi.fn(), play: vi.fn(), seek: vi.fn() },
  orderedSources: () => [],
}));
vi.mock('@/services/media-session', () => ({
  setMediaHandlers: vi.fn(), updateMediaMetadata: vi.fn(), updatePlaybackState: vi.fn(), updatePositionState: vi.fn(),
}));
vi.mock('@/services/native', () => ({ checkNotificationOnFirstPlay: vi.fn(), haptic: vi.fn(), isNativePlatform: () => false, platformName: () => 'web' }));
vi.mock('@/services/personalization/updater', () => ({
  recordComplete: vi.fn(), recordPlay: vi.fn(), recordQueueAdd: vi.fn(), recordSkip: vi.fn(), recordFavorite: vi.fn(), recordDislike: vi.fn(), recordPlaylistAdd: vi.fn(),
}));

const album = (id: string, title: string): Album =>
  ({ kind: 'album', id, title, subtitle: 'Some Artist', artists: [], images: [], year: '2020', language: 'telugu', songCount: 1, songs: [makeSong(`${id}-s`)] }) as unknown as Album;

let current: Album;
vi.mock('@/features/albums/useAlbum', () => ({
  useAlbum: () => ({ data: current, isLoading: false, isError: false, refetch: vi.fn() }),
}));
const getSimilarAlbums = vi.fn(async (..._a: unknown[]): Promise<Album[]> => Promise.reject(new Error('404')));
vi.mock('@/services/api', () => ({
  getSimilarAlbums: (...a: unknown[]) => getSimilarAlbums(...a),
  getSimilarArtists: vi.fn(),
  getAlbum: vi.fn(),
}));

import AlbumPage from './AlbumPage';

const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/album/first-al1']}>
        <Routes>
          <Route path="/album/:id" element={<AlbumPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  current = album('al1', 'First');
  getSimilarAlbums.mockReset();
});
afterEach(cleanup);

describe('AlbumPage — More like this', () => {
  it('shows the catalogue’s similar albums (never the album itself)', async () => {
    getSimilarAlbums.mockResolvedValue([album('al2', 'Second'), album('al1', 'First'), album('al3', 'Third')]);
    mount();
    expect(await screen.findByRole('heading', { name: 'More like this' })).toBeTruthy();
    expect(getSimilarAlbums.mock.calls[0][0]).toBe('al1');
    expect(screen.getByText('Second')).toBeTruthy();
    expect(screen.getByText('Third')).toBeTruthy();
    expect(screen.getAllByText('First')).toHaveLength(1); // the page title only
  });

  it('is hidden when the catalogue has none', async () => {
    getSimilarAlbums.mockRejectedValue(new Error('404'));
    mount();
    await waitFor(() => expect(getSimilarAlbums).toHaveBeenCalled());
    expect(screen.queryByRole('heading', { name: 'More like this' })).toBeNull();
    expect(screen.getByText('First')).toBeTruthy();
  });
});
