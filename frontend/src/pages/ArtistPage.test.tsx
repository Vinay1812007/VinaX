// @vitest-environment jsdom
/**
 * 1.3 — the artist page's catalogue extras: "Artist radio" opens the
 * catalogue's artist station (Radio from their songs when it cannot), and
 * "Related artists" prefers the catalogue's similar artists.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Artist, ArtistRef, Song } from '@/types';
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

let artist: Artist;
let topSongs: Song[];
vi.mock('@/features/artists/useArtist', () => ({
  useArtist: () => ({ data: artist, isLoading: false, isError: false, refetch: vi.fn() }),
  useInfiniteArtistSongs: () => ({ data: { pages: [topSongs] }, isLoading: false, hasNextPage: false, isFetchingNextPage: false, fetchNextPage: vi.fn() }),
}));
const getSimilarArtists = vi.fn(async (..._a: unknown[]): Promise<ArtistRef[]> => Promise.reject(new Error('down')));
const startArtistRadio = vi.fn(async (..._a: unknown[]): Promise<{ stationId: string | null; songs: Song[] }> => Promise.reject(new Error('down')));
vi.mock('@/services/api', () => ({
  getSimilarArtists: (...a: unknown[]) => getSimilarArtists(...a),
  getSimilarAlbums: vi.fn(),
  getRadioStations: vi.fn(),
  startFeaturedStation: vi.fn(),
  startArtistRadio: (...a: unknown[]) => startArtistRadio(...a),
  nextStationSongs: vi.fn(),
  getAlbum: vi.fn(),
}));

import ArtistPage from './ArtistPage';
import { usePlayerStore } from '@/store/playerStore';
import { useToastStore } from '@/store/toastStore';

const startRadio = vi.fn();
const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/artist/a-singer-a1']}>
        <Routes>
          <Route path="/artist/:id" element={<ArtistPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  topSongs = ['1', '2', '3', '4', '5', '6'].map((id) => makeSong(`t${id}`, { artist: 'A Singer', artists: [{ id: 'a1', name: 'A Singer' }, { id: 'co', name: 'Co Singer' }] }));
  artist = { kind: 'artist', id: 'a1', name: 'A Singer', subtitle: 'Artist', images: [], topSongs, albums: [], bio: null, similarArtists: [] } as unknown as Artist;
  getSimilarArtists.mockReset();
  getSimilarArtists.mockRejectedValue(new Error('down'));
  startArtistRadio.mockReset();
  startArtistRadio.mockRejectedValue(new Error('down'));
  startRadio.mockReset();
  usePlayerStore.setState({ startRadio, queue: [], index: 0 });
  useToastStore.setState({ toasts: [] } as never);
});
afterEach(cleanup);

describe('ArtistPage — 1.3', () => {
  it('Artist radio plays the catalogue’s artist station', async () => {
    const station = ['1', '2', '3', '4', '5', '6', '7'].map((id) => makeSong(`r${id}`));
    startArtistRadio.mockResolvedValue({ stationId: 'st', songs: station });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Artist radio' }));
    await waitFor(() => expect(startRadio).toHaveBeenCalledOnce());
    expect(startArtistRadio.mock.calls[0][0]).toBe('a1');
    const [seed, opts] = startRadio.mock.calls[0] as [Song, { seeds: Song[]; feed?: unknown }];
    expect(seed.id).toBe('r1');
    expect(typeof opts.feed).toBe('function');
  });

  it('when the station will not open, Artist radio falls back to Radio from their songs', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Artist radio' }));
    await waitFor(() => expect(startRadio).toHaveBeenCalledOnce());
    const [seed, opts] = startRadio.mock.calls[0] as [Song, { seeds: Song[]; feed?: unknown }];
    expect(seed.id).toBe('t1');
    expect(opts.seeds.map((s) => s.id)).toEqual(['t2', 't3', 't4', 't5']);
    expect(opts.feed).toBeUndefined();
  });

  it('related artists: the catalogue’s similar artists when it has them, co-credits otherwise', async () => {
    getSimilarArtists.mockResolvedValue([{ id: 'sim', name: 'Similar Voice', image: 'x.jpg' }]);
    mount();
    expect(await screen.findByText('Similar Voice')).toBeTruthy();
    expect(screen.queryByText('Co Singer')).toBeNull();
    cleanup();
    getSimilarArtists.mockRejectedValue(new Error('down'));
    mount();
    expect(await screen.findByText('Co Singer')).toBeTruthy();
  });
});
