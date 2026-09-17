// @vitest-environment jsdom
/**
 * Dragging the seek thumb used to call seek() on every tick — audible stutter
 * plus a store broadcast per pixel. The bar now holds the drag locally and
 * commits once on release; keyboard steps still seek immediately.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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
import { Seekbar } from './Seekbar';

const seek = vi.fn();
const slider = () => screen.getByRole('slider', { name: 'Seek' }) as HTMLInputElement;

beforeEach(() => {
  seek.mockReset();
  usePlayerStore.setState({ currentTime: 30, duration: 200, seek });
});
afterEach(cleanup);

describe('<Seekbar />', () => {
  it('holds a pointer drag locally and commits a single seek on release', () => {
    render(<Seekbar />);
    fireEvent.pointerDown(slider());
    fireEvent.change(slider(), { target: { value: '60' } });
    fireEvent.change(slider(), { target: { value: '90' } });
    fireEvent.change(slider(), { target: { value: '120' } });
    expect(seek).not.toHaveBeenCalled();
    // The bar paints the dragged position, not the store clock.
    expect(slider().value).toBe('120');
    expect(slider().style.getPropertyValue('--fill')).toBe('60%');
    expect(slider().getAttribute('aria-valuetext')).toBe('2:00 of 3:20');

    // Playback ticking underneath must not yank the thumb away mid-drag.
    act(() => usePlayerStore.setState({ currentTime: 31 }));
    expect(slider().value).toBe('120');

    fireEvent.pointerUp(window);
    expect(seek).toHaveBeenCalledTimes(1);
    expect(seek).toHaveBeenCalledWith(120);
  });

  it('a press and release with no movement does not seek', () => {
    render(<Seekbar />);
    fireEvent.pointerDown(slider());
    fireEvent.pointerUp(window);
    expect(seek).not.toHaveBeenCalled();
  });

  it('keyboard steps (no pointer held) seek immediately', () => {
    render(<Seekbar />);
    fireEvent.change(slider(), { target: { value: '31' } });
    expect(seek).toHaveBeenCalledTimes(1);
    expect(seek).toHaveBeenCalledWith(31);
  });

  it('returns to immediate seeking after a drag ends, and detaches its window listeners', () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    render(<Seekbar />);
    fireEvent.pointerDown(slider());
    fireEvent.change(slider(), { target: { value: '50' } });
    fireEvent.pointerCancel(window);
    expect(seek).toHaveBeenCalledTimes(1);
    expect(remove.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(['pointerup', 'pointercancel']));
    fireEvent.change(slider(), { target: { value: '55' } });
    expect(seek).toHaveBeenLastCalledWith(55);
    remove.mockRestore();
  });

  it('exposes position as "m:ss of m:ss"', () => {
    render(<Seekbar compact />);
    expect(slider().getAttribute('aria-valuetext')).toBe('0:30 of 3:20');
  });
});
