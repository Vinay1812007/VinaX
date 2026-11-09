// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';

vi.mock('@/services/audio/engine', () => ({ audioEngine: { load: vi.fn(), preloadNext: vi.fn(), pause: vi.fn(), play: vi.fn(), seek: vi.fn() }, orderedSources: () => [] }));
vi.mock('@/services/media-session', () => ({ setMediaHandlers: vi.fn(), updateMediaMetadata: vi.fn(), updatePlaybackState: vi.fn(), updatePositionState: vi.fn() }));
vi.mock('@/services/native', () => ({ checkNotificationOnFirstPlay: vi.fn(), haptic: vi.fn(), isNativePlatform: () => false, platformName: () => 'web' }));
vi.mock('@/features/player/playEntity', () => ({ playArtist: vi.fn(async () => undefined) }));
const topSongs = vi.fn(async (id: string) => (id === 'ar1' ? [song('t1', 'Top One'), song('t2', 'Top Two')] : []));
vi.mock('@/services/api/saavn', () => ({ getArtistTopSongs: (id: string) => topSongs(id) }));

import { useLibraryStore } from '@/store/libraryStore';
import { useReleaseStore } from '@/features/releases/releaseWatch';
import FollowingPage from './FollowingPage';

function song(id: string, title: string): Song {
  return { kind: 'song', id, title, subtitle: 'Anirudh', artists: [{ id: 'ar1', name: 'Anirudh' }], album: { id: 'a', name: 'A' }, images: [], audio: [], duration: 200, language: 'telugu', year: '2026', explicit: false, hasLyrics: false, playCount: 0 } as unknown as Song;
}

const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><FollowingPage /></MemoryRouter></QueryClientProvider>);

describe('1.12 — the Following page', () => {
  beforeEach(() => {
    localStorage.clear();
    useReleaseStore.setState({ fresh: [], checkedAt: 0, seen: {} });
    useLibraryStore.setState({ saved: [] } as never);
  });
  afterEach(cleanup);

  it('with nobody followed, says how to follow and points at Top Artists', () => {
    mount();
    expect(screen.getByText('You follow nobody yet')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Top Artists' }).getAttribute('href')).toBe('/top-artists');
  });

  it('lists the artists, the new songs newest first, and each artist’s latest', async () => {
    useLibraryStore.setState({ saved: [
      { id: 'ar1', kind: 'artist', title: 'Anirudh', subtitle: 'Artist', image: null, savedAt: 2 },
      { id: 'ar2', kind: 'artist', title: 'Sid Sriram', subtitle: 'Artist', image: null, savedAt: 1 },
      { id: 'al1', kind: 'album', title: 'Some album', subtitle: '', image: null, savedAt: 3 },
    ] } as never);
    useReleaseStore.setState({ fresh: [
      { song: song('n1', 'Older New'), artist: 'Anirudh', at: 1000 },
      { song: song('n2', 'Newest'), artist: 'Anirudh', at: 2000 },
    ], checkedAt: Date.now() - 60_000 });
    mount();
    expect(screen.getByRole('heading', { name: 'Artists you follow' })).toBeTruthy();
    expect(screen.getByText('2 artists')).toBeTruthy();
    expect(screen.getByText('2 new songs')).toBeTruthy();
    // Albums are not artists.
    expect(screen.queryByText('Some album')).toBeNull();
    const feed = screen.getByRole('region', { name: 'New from your artists' });
    const rows = feed.querySelectorAll('.vx-group > div');
    expect(rows[0].textContent).toContain('Newest');
    expect(rows[1].textContent).toContain('Older New');
    expect(screen.getByRole('button', { name: 'Dismiss Newest' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Play new songs' })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('region', { name: 'Latest from Anirudh' })).toBeTruthy());
    expect(screen.getByText('Top One')).toBeTruthy();
    // An artist with nothing in the catalogue gets no block.
    expect(screen.queryByRole('region', { name: 'Latest from Sid Sriram' })).toBeNull();
    expect(topSongs).toHaveBeenCalledWith('ar2');
  });
});
