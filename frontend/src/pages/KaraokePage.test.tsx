// @vitest-environment jsdom
/**
 * Karaoke + Drive Mode are full-screen portals: they must present as modal
 * dialogs, keep Tab inside, and karaoke's seek control must be a real slider
 * whose clock subscription does not re-render the page (and its lyric list).
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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
vi.mock('@/features/karaoke/history', () => ({ loadKaraokeHistory: () => [], recordKaraokeSession: vi.fn() }));
const lyricsHook = vi.fn((_song: unknown) => ({ data: { synced: null, plain: 'la la la' }, isLoading: false }));
vi.mock('@/features/lyrics/useSyncedLyrics', () => ({ useSyncedLyrics: (song: unknown) => lyricsHook(song) }));

import { usePlayerStore } from '@/store/playerStore';
import { makeSong } from '@/__fixtures__/songs';
import KaraokePage from './KaraokePage';
import DriveModePage from './DriveModePage';

beforeEach(() => {
  lyricsHook.mockClear();
  usePlayerStore.setState({ queue: [makeSong('a')], index: 0, isPlaying: false, currentTime: 10, duration: 200 });
});
afterEach(cleanup);

describe('KaraokePage', () => {
  it('is a labelled modal dialog with a keyboard-operable seek slider and a 44px close target', () => {
    render(<MemoryRouter><KaraokePage /></MemoryRouter>);
    const dialog = screen.getByRole('dialog', { name: 'Karaoke — Song a' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const seekbar = screen.getByRole('slider', { name: 'Seek' });
    expect(dialog.contains(seekbar)).toBe(true);
    expect(seekbar.getAttribute('aria-valuetext')).toBe('0:10 of 3:20');
    expect(screen.getByRole('button', { name: 'Close karaoke' }).className).toContain('w-11 h-11');
  });

  it('moves focus into the dialog and wraps Tab inside it', () => {
    render(<MemoryRouter><button type="button">behind</button><KaraokePage /></MemoryRouter>);
    const close = screen.getByRole('button', { name: 'Close karaoke' });
    expect(document.activeElement).toBe(close);
    const last = screen.getByRole('button', { name: 'Next song' });
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
  });

  it('clock ticks do not re-render the page', () => {
    render(<MemoryRouter><KaraokePage /></MemoryRouter>);
    const before = lyricsHook.mock.calls.length; // one call per page render
    for (const t of [10.25, 10.5, 11, 42]) act(() => usePlayerStore.setState({ currentTime: t }));
    expect(lyricsHook.mock.calls.length).toBe(before);
    expect(screen.getByRole('slider', { name: 'Seek' }).getAttribute('aria-valuetext')).toBe('0:42 of 3:20');
  });
});

describe('DriveModePage', () => {
  it('is a labelled modal dialog that takes focus', () => {
    render(<MemoryRouter><DriveModePage /></MemoryRouter>);
    const dialog = screen.getByRole('dialog', { name: 'Drive Mode' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Exit Drive Mode' }));
  });
});
