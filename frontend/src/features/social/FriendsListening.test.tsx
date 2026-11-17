// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/audio/engine', () => ({ audioEngine: { load: vi.fn(), preloadNext: vi.fn(), pause: vi.fn(), play: vi.fn(), seek: vi.fn() }, orderedSources: () => [] }));
vi.mock('@/services/media-session', () => ({ setMediaHandlers: vi.fn(), updateMediaMetadata: vi.fn(), updatePlaybackState: vi.fn(), updatePositionState: vi.fn() }));
vi.mock('@/services/native', () => ({ checkNotificationOnFirstPlay: vi.fn(), haptic: vi.fn(), isNativePlatform: () => false, platformName: () => 'web' }));
vi.mock('@/features/social/resolve', () => ({ resolveSongs: vi.fn(async () => []) }));

import { useSocialStore } from './store';
import { FriendsListening } from './FriendsListening';
import type { PublicProfile } from '@/services/social/api';

const friend = (handle: string, over: Partial<PublicProfile> = {}): PublicProfile => ({ handle, name: handle.toUpperCase(), picture: null, bio: null, public: true, topArtists: [], topLanguages: [], recentLikes: [], badges: [], nowPlaying: null, updatedAt: new Date().toISOString(), following: true, ...over });
const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><FriendsListening /></MemoryRouter></QueryClientProvider>);

describe('v23 — Friends are listening: join a friend\'s jam', () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it('a friend hosting a room you may join gets a Join link to /together?code=', () => {
    useSocialStore.setState({ following: [friend('bobo', { nowPlaying: { id: 's1', title: 'Song' }, jamCode: 'JAM123' }), friend('cyan', { nowPlaying: { id: 's2', title: 'Other' } })] });
    mount();
    expect(screen.getByRole('link', { name: "Join BOBO's room" }).getAttribute('href')).toBe('/together?code=JAM123');
    expect(screen.queryByRole('link', { name: "Join CYAN's room" })).toBeNull();
  });

  it('shows a host who shares no song, and stays hidden when nobody plays or hosts', () => {
    useSocialStore.setState({ following: [friend('bobo', { jamCode: 'JAM123' })] });
    mount();
    expect(screen.getByText('Hosting Listen Together')).toBeTruthy();
    expect(screen.getByRole('link', { name: "Join BOBO's room" })).toBeTruthy();
    cleanup();
    useSocialStore.setState({ following: [friend('dee')] });
    const { container } = mount();
    expect(container.textContent).toBe('');
  });
});
