// @vitest-environment jsdom
/**
 * The "Up next" card used to subscribe to the raw playback clock for the whole
 * session while rendering nothing ~90 % of the time. It now subscribes to one
 * derived value that is `null` outside the last 30 s.
 */
import { Profiler } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
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

import { usePlayerStore } from '@/store/playerStore';
import { makeSong } from '@/__fixtures__/songs';
import { NextUpCard, selectEndingIn } from './NextUpCard';

describe('selectEndingIn', () => {
  it('is null outside the final 30 seconds, while paused, or with no duration', () => {
    expect(selectEndingIn({ currentTime: 10, duration: 200, isPlaying: true })).toBeNull();
    expect(selectEndingIn({ currentTime: 169.9, duration: 200, isPlaying: true })).toBeNull();
    expect(selectEndingIn({ currentTime: 190, duration: 200, isPlaying: false })).toBeNull();
    expect(selectEndingIn({ currentTime: 5, duration: 0, isPlaying: true })).toBeNull();
    expect(selectEndingIn({ currentTime: 200, duration: 200, isPlaying: true })).toBeNull();
  });

  it('returns whole seconds inside the final 30 seconds', () => {
    expect(selectEndingIn({ currentTime: 170, duration: 200, isPlaying: true })).toBe(30);
    expect(selectEndingIn({ currentTime: 190.25, duration: 200, isPlaying: true })).toBe(10);
    expect(selectEndingIn({ currentTime: 190.75, duration: 200, isPlaying: true })).toBe(10);
  });
});

describe('<NextUpCard />', () => {
  let renders = 0;
  const mount = () =>
    render(
      <MemoryRouter>
        <Profiler id="next-up" onRender={() => { renders += 1; }}>
          <NextUpCard />
        </Profiler>
      </MemoryRouter>,
    );

  beforeEach(() => {
    renders = 0;
    usePlayerStore.setState({
      queue: [makeSong('a'), makeSong('b')], index: 0, shuffle: false, repeat: 'off',
      isPlaying: true, currentTime: 0, duration: 200,
    });
  });
  afterEach(cleanup);

  it('does not re-render on clock ticks outside the final stretch', () => {
    mount();
    const initial = renders;
    expect(screen.queryByRole('button')).toBeNull();
    for (const t of [0.25, 0.5, 40, 99.75, 150]) act(() => usePlayerStore.setState({ currentTime: t }));
    expect(renders).toBe(initial);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows the next song with a whole-second countdown and skips to it on tap', () => {
    const next = vi.fn();
    usePlayerStore.setState({ next });
    mount();
    act(() => usePlayerStore.setState({ currentTime: 180.2 }));
    const card = screen.getByRole('button', { name: 'Up next: Song b. Tap to play it now.' });
    expect(card.textContent).toContain('Up next · 20s');
    const shown = renders;
    // Sub-second ticks inside the same whole second do not re-render.
    act(() => usePlayerStore.setState({ currentTime: 180.5 }));
    act(() => usePlayerStore.setState({ currentTime: 180.9 }));
    expect(renders).toBe(shown);
    card.click();
    expect(next).toHaveBeenCalledWith(true);
  });
});
