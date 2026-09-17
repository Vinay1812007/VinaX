// @vitest-environment jsdom
/**
 * Synced lyrics ran two 60fps requestAnimationFrame loops for as long as they
 * were mounted — including while paused, when nothing on screen can move.
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/audio/engine', () => ({
  audioEngine: { load: vi.fn(), preloadNext: vi.fn(), pause: vi.fn(), play: vi.fn(), seek: vi.fn() },
  orderedSources: () => [],
}));
vi.mock('@/services/media-session', () => ({
  setMediaHandlers: vi.fn(), updateMediaMetadata: vi.fn(), updatePlaybackState: vi.fn(), updatePositionState: vi.fn(),
}));
vi.mock('@/services/native', () => ({ checkNotificationOnFirstPlay: vi.fn(), haptic: vi.fn(), isNativePlatform: () => false }));

import { usePlayerStore } from '@/store/playerStore';
import { makeSong } from '@/__fixtures__/songs';
import { SyncedLyrics } from './SyncedLyrics';

const LINES = [
  { t: 0, text: 'first line' },
  { t: 10, text: 'second line' },
  { t: 20, text: 'third line' },
];

let raf: ReturnType<typeof vi.fn>;
let caf: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // Never invokes the callback: the test only counts what gets SCHEDULED.
  raf = vi.fn(() => 1);
  caf = vi.fn();
  vi.stubGlobal('requestAnimationFrame', raf);
  vi.stubGlobal('cancelAnimationFrame', caf);
  usePlayerStore.setState({ queue: [makeSong('a')], index: 0, isPlaying: false, currentTime: 12, duration: 200 });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const activeText = () => document.querySelector('.vx-lyric-active')?.textContent;

describe('<SyncedLyrics live />', () => {
  it('schedules no animation frames while paused, yet still shows the right line', () => {
    render(<SyncedLyrics lines={LINES} live />);
    expect(raf).not.toHaveBeenCalled();
    expect(activeText()).toBe('second line');
  });

  it('follows a seek made while paused without starting a loop', () => {
    render(<SyncedLyrics lines={LINES} live />);
    act(() => usePlayerStore.setState({ currentTime: 25 }));
    expect(activeText()).toBe('third line');
    expect(raf).not.toHaveBeenCalled();
  });

  it('starts its loops when playback starts and cancels them when it pauses', () => {
    render(<SyncedLyrics lines={LINES} live />);
    act(() => usePlayerStore.setState({ isPlaying: true }));
    // One loop for the active-line index, one for the karaoke fill.
    expect(raf).toHaveBeenCalledTimes(2);
    act(() => usePlayerStore.setState({ isPlaying: false }));
    expect(caf).toHaveBeenCalledTimes(2);
    expect(raf).toHaveBeenCalledTimes(2);
  });

  it('static (non-live) lyrics never touch the clock', () => {
    render(<SyncedLyrics lines={LINES} live={false} />);
    act(() => usePlayerStore.setState({ isPlaying: true, currentTime: 15 }));
    expect(raf).not.toHaveBeenCalled();
    expect(activeText()).toBeUndefined();
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });
});
