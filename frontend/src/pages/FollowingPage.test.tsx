// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';

vi.mock('@/services/audio/engine', () => ({ audioEngine: { load: vi.fn(), preloadNext: vi.fn(), pause: vi.fn(), play: vi.fn(), seek: vi.fn() }, orderedSources: () => [] }));
vi.mock('@/services/media-session', () => ({ setMediaHandlers: vi.fn(), updateMediaMetadata: vi.fn(), updatePlaybackState: vi.fn(), updatePositionState: vi.fn() }));
vi.mock('@/services/native', () => ({ checkNotificationOnFirstPlay: vi.fn(), haptic: vi.fn(), isNativePlatform: () => false, platformName: () => 'web' }));
vi.mock('@/features/player/playEntity', () => ({ playArtist: vi.fn(async () => undefined) }));
const topSongs = vi.fn(async (id: string) => (id === 'ar1' ? [song('t1', 'Top One'), song('t2', 'Top Two')] : []));
vi.mock('@/services/api/saavn', () => ({ getArtistTopSongs: (id: string) => topSongs(id) }));
const account = vi.hoisted(() => ({ current: null as null | { session: string } }));
vi.mock('@/services/auth/google', () => ({ currentAccount: () => account.current, onAccountChange: () => () => undefined }));

import { useLibraryStore } from '@/store/libraryStore';
import { useReleaseStore } from '@/features/releases/releaseWatch';
import { useSocialStore } from '@/features/social/store';
import type { PublicProfile } from '@/services/social/api';
import FollowingPage from './FollowingPage';

function song(id: string, title: string): Song {
  return { kind: 'song', id, title, subtitle: 'Anirudh', artists: [{ id: 'ar1', name: 'Anirudh' }], album: { id: 'a', name: 'A' }, images: [], audio: [], duration: 200, language: 'telugu', year: '2026', explicit: false, hasLyrics: false, playCount: 0 } as unknown as Song;
}

const mount = (at = '/following') => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[at]}><Routes><Route path="/following" element={<FollowingPage />} /><Route path="/u/:handle" element={<p>Profile page</p>} /></Routes></MemoryRouter></QueryClientProvider>);
const friend = (handle: string, over: Partial<PublicProfile> = {}): PublicProfile => ({ handle, name: handle.toUpperCase(), picture: null, bio: null, public: true, topArtists: [], topLanguages: [], recentLikes: [], badges: [], nowPlaying: null, updatedAt: new Date().toISOString(), following: true, ...over });

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

describe('/following → People', () => {
  beforeEach(() => {
    localStorage.clear();
    account.current = { session: 'vx1.t' };
    useLibraryStore.setState({ saved: [] } as never);
    useSocialStore.setState({ profile: null, following: [], loadedAt: Date.now() });
  });
  afterEach(cleanup);

  it('the People tab lists everyone you follow, with Join when they let you into their room, and Unfollow', async () => {
    const follow = vi.fn(async () => false);
    useSocialStore.setState({ following: [friend('bobo', { jamCode: 'JAM123' }), friend('cyan', { nowPlaying: { id: 's1', title: 'Song' } })], follow });
    mount('/following?tab=people');
    expect(screen.getByRole('heading', { name: 'People you follow' })).toBeTruthy();
    expect(screen.getByText('2 people')).toBeTruthy();
    expect(screen.getByRole('link', { name: "BOBO's profile" }).getAttribute('href')).toBe('/u/bobo');
    expect(screen.getByRole('link', { name: "Join BOBO's room" }).getAttribute('href')).toBe('/together?code=JAM123');
    expect(screen.queryByRole('link', { name: "Join CYAN's room" })).toBeNull();
    expect(screen.getByText('@cyan · Playing Song')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Unfollow CYAN' }));
    await waitFor(() => expect(follow).toHaveBeenCalledWith('cyan', false));
  });

  it('switches tabs, and the artists tab is the default', () => {
    mount();
    expect(screen.getByRole('tab', { name: 'Artists' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('tab', { name: 'People' }));
    expect(screen.getByRole('heading', { name: 'People you follow' })).toBeTruthy();
  });

  it('Find by handle opens the profile, and says when the text cannot be a handle', () => {
    mount('/following?tab=people');
    const field = screen.getByRole('textbox', { name: 'Handle' });
    fireEvent.change(field, { target: { value: 'a b' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByText('A handle is 3–20 letters, digits or underscores.')).toBeTruthy();
    fireEvent.change(field, { target: { value: '@Bobo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByText('Profile page')).toBeTruthy();
  });

  it('signed out, asks to sign in', () => {
    account.current = null;
    mount('/following?tab=people');
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/login');
  });
});
