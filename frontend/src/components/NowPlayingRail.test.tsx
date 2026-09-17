// @vitest-environment jsdom
/**
 * The wide-screen rail was only CSS-hidden below 1280px, so every phone still
 * mounted it: a lyrics fetch, a playback-clock subscriber and 500px artwork
 * for a column nobody could see. It must not mount at all below `xl`.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/audio/engine', () => ({
  audioEngine: { load: vi.fn(), preloadNext: vi.fn(), pause: vi.fn(), play: vi.fn(), seek: vi.fn() },
  orderedSources: () => [],
}));
vi.mock('@/services/media-session', () => ({
  setMediaHandlers: vi.fn(), updateMediaMetadata: vi.fn(), updatePlaybackState: vi.fn(), updatePositionState: vi.fn(),
}));
vi.mock('@/services/native', () => ({ checkNotificationOnFirstPlay: vi.fn(), haptic: vi.fn(), isNativePlatform: () => false }));
const useSyncedLyrics = vi.fn((_song: unknown) => ({ data: undefined, isLoading: false }));
vi.mock('@/features/lyrics/useSyncedLyrics', () => ({ useSyncedLyrics: (song: unknown) => useSyncedLyrics(song) }));

import { usePlayerStore } from '@/store/playerStore';
import { makeSong } from '@/__fixtures__/songs';
import { NowPlayingRail } from './NowPlayingRail';

const setWide = (wide: boolean) =>
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (media: string) => ({ matches: wide, media, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  });

beforeEach(() => {
  useSyncedLyrics.mockClear();
  usePlayerStore.setState({ queue: [makeSong('a'), makeSong('b')], index: 0 });
});
afterEach(cleanup);

const mount = () => render(<MemoryRouter><NowPlayingRail /></MemoryRouter>);

describe('<NowPlayingRail />', () => {
  it('mounts nothing below 1280px — no lyrics fetch, no artwork', () => {
    setWide(false);
    const { container } = mount();
    expect(container.innerHTML).toBe('');
    expect(useSyncedLyrics).not.toHaveBeenCalled();
  });

  it('renders the rail from 1280px up', () => {
    setWide(true);
    mount();
    expect(screen.getByRole('complementary', { name: 'Now playing' })).toBeTruthy();
    expect(useSyncedLyrics).toHaveBeenCalled();
  });
});
