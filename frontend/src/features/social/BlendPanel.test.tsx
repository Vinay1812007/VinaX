// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';

vi.mock('@/services/audio/engine', () => ({ audioEngine: { load: vi.fn(), preloadNext: vi.fn(), pause: vi.fn(), play: vi.fn(), seek: vi.fn() }, orderedSources: () => [] }));
vi.mock('@/services/media-session', () => ({ setMediaHandlers: vi.fn(), updateMediaMetadata: vi.fn(), updatePlaybackState: vi.fn(), updatePositionState: vi.fn() }));
vi.mock('@/services/native', () => ({ checkNotificationOnFirstPlay: vi.fn(), haptic: vi.fn(), isNativePlatform: () => false, platformName: () => 'web' }));
const recommend = vi.hoisted(() => vi.fn());
vi.mock('@/services/recs/similar', () => ({ recommendFromSeeds: recommend }));
vi.mock('@/features/social/resolve', () => ({ resolveSongs: vi.fn(async (lite: Array<{ id: string }>) => lite.map((l) => song(l.id))) }));

import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import type { PublicProfile } from '@/services/social/api';
import { useBlendStore } from './blend';
import { BlendButton, BlendSection, useBlend } from './BlendPanel';

function song(id: string): Song {
  return { kind: 'song', id, title: `Title ${id}`, subtitle: 'Artist', artists: [{ id: 'ar', name: 'Artist' }], album: { id: 'a', name: 'A' }, images: [], audio: [], duration: 200, language: 'telugu', year: '2026', explicit: false, hasLyrics: false, playCount: 0 } as unknown as Song;
}
const friend = (over: Partial<PublicProfile> = {}): PublicProfile => ({ handle: 'bobo', name: 'Bobo', picture: null, bio: null, public: true, topArtists: [], topLanguages: [], recentLikes: [{ id: 't1' }], badges: [], nowPlaying: null, updatedAt: '2026-11-01T00:00:00.000Z', ...over });

function Harness({ profile }: { profile: PublicProfile }) {
  const blend = useBlend(profile, true);
  return <><BlendButton blend={blend} /><BlendSection blend={blend} profile={profile} /></>;
}
const mount = (profile: PublicProfile) => render(<MemoryRouter><Harness profile={profile} /></MemoryRouter>);

describe('Blend on a profile', () => {
  beforeEach(() => {
    localStorage.clear();
    recommend.mockReset();
    recommend.mockImplementation(async (seeds: Song[]) => [song(`pick-${seeds[0].id}`)]);
    useBlendStore.setState({ blends: {} });
    useLibraryStore.setState({ favorites: [song('m1')], collections: [], hiddenSongIds: [], hiddenArtists: [] } as never);
    usePlayerStore.setState({ playQueue: vi.fn() } as never);
  });
  afterEach(cleanup);

  it('Blend saves the playlist, plays it, and lists whose likes each song came from', async () => {
    mount(friend());
    fireEvent.click(screen.getByRole('button', { name: 'Blend' }));
    await waitFor(() => expect(screen.getByRole('region', { name: 'Your blend' })).toBeTruthy());
    expect(useLibraryStore.getState().collections[0].name).toBe('Blend with Bobo');
    expect(usePlayerStore.getState().playQueue).toHaveBeenCalled();
    const section = screen.getByRole('region', { name: 'Your blend' });
    expect(section.textContent).toContain('From Bobo');
    expect(section.textContent).toContain('From you');
    expect(screen.getByRole('button', { name: 'Play blend' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Show all' }).getAttribute('href')).toMatch(/^\/collection\/col-/);
  });

  it('rebuilds by itself when their profile changed, and on Refresh', async () => {
    const { unmount } = mount(friend());
    fireEvent.click(screen.getByRole('button', { name: 'Blend' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy());
    const made = recommend.mock.calls.length;
    unmount();
    mount(friend({ updatedAt: '2026-11-03T00:00:00.000Z', recentLikes: [{ id: 't2' }] }));
    await waitFor(() => expect(useBlendStore.getState().blends.bobo.theirsAt).toBe('2026-11-03T00:00:00.000Z'));
    expect(recommend.mock.calls.length).toBeGreaterThan(made);
    expect(useLibraryStore.getState().collections).toHaveLength(1);
    expect(useLibraryStore.getState().collections[0].songs.map((s) => s.id)).toContain('t2');
    const before = recommend.mock.calls.length;
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh' })); });
    await waitFor(() => expect(recommend.mock.calls.length).toBeGreaterThan(before));
  });

  it('does not rebuild for a newer profile with the same likes, or for a like made while the page is open', async () => {
    const { unmount } = mount(friend());
    fireEvent.click(screen.getByRole('button', { name: 'Blend' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy());
    const made = recommend.mock.calls.length;
    unmount();
    // They only sent what they are playing: updatedAt moved, the likes did not.
    mount(friend({ updatedAt: '2026-11-03T00:00:00.000Z' }));
    await act(async () => { useLibraryStore.setState({ favorites: [song('m2'), song('m1')] } as never); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(recommend.mock.calls.length).toBe(made);
    expect(usePlayerStore.getState().playQueue).toHaveBeenCalledWith(expect.any(Array), 0, expect.objectContaining({ from: expect.objectContaining({ kind: 'playlist', label: 'Blend with Bobo' }) }));
  });
});
