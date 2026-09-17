// @vitest-environment jsdom
/**
 * Song "⋯" menu: ARIA wiring on the trigger, roving focus inside the menu,
 * Escape returning focus, and the panel living in <body> (so it cannot be
 * painted over by later rows or clipped by a transformed ancestor).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
vi.mock('@/services/personalization/updater', () => ({
  recordComplete: vi.fn(), recordPlay: vi.fn(), recordQueueAdd: vi.fn(), recordSkip: vi.fn(), recordFavorite: vi.fn(), softMuteArtist: vi.fn(),
}));
vi.mock('@/services/feedback', () => ({ sendFeedback: vi.fn(async () => true) }));
vi.mock('@/services/downloads', () => ({ downloadSong: vi.fn(), removeDownload: vi.fn() }));

import { usePlayerStore } from '@/store/playerStore';
import { makeSong } from '@/__fixtures__/songs';
import { placePanel, TrackMenu } from './TrackMenu';

const song = makeSong('a');
const enqueue = vi.fn();

beforeEach(() => {
  enqueue.mockReset();
  usePlayerStore.setState({ enqueue });
});
afterEach(cleanup);

const mount = () =>
  render(
    <MemoryRouter>
      <div data-testid="row" style={{ transform: 'translateY(3px)' }}>
        <TrackMenu song={song} />
      </div>
    </MemoryRouter>,
  );
const trigger = () => screen.getByRole('button', { name: 'More options' });
const items = () => screen.getAllByRole('menuitem');

describe('<TrackMenu />', () => {
  it('trigger is a typed button that announces its popup and state; nothing is mounted while closed', () => {
    mount();
    expect(trigger().getAttribute('type')).toBe('button');
    expect(trigger().getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(trigger());
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('portals the panel to <body>, outside the (transformed) row', () => {
    mount();
    fireEvent.click(trigger());
    const menu = screen.getByRole('menu');
    expect(screen.getByTestId('row').contains(menu)).toBe(false);
    expect(document.body.contains(menu)).toBe(true);
    expect(menu.className).toContain('fixed');
  });

  it('focuses the first item, and arrows / Home / End move between items (wrapping)', () => {
    mount();
    fireEvent.click(trigger());
    const all = items();
    expect(document.activeElement).toBe(all[0]);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(all[1]);
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement).toBe(all[all.length - 1]);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(all[0]);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(all[all.length - 1]);
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(document.activeElement).toBe(all[0]);
  });

  it('Escape closes the menu and returns focus to the trigger', () => {
    mount();
    fireEvent.click(trigger());
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger());
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('choosing an item runs it, closes the menu and restores focus', () => {
    mount();
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add to queue' }));
    expect(enqueue).toHaveBeenCalledWith(song);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('removes its window / document listeners when it closes', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    mount();
    fireEvent.click(trigger());
    const added = add.mock.calls.filter(([type]) => type === 'scroll' || type === 'resize').length;
    expect(added).toBe(2);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    const removed = remove.mock.calls.filter(([type]) => type === 'scroll' || type === 'resize').length;
    expect(removed).toBe(2);
    add.mockRestore();
    remove.mockRestore();
  });
});

describe('placePanel', () => {
  const viewport = { width: 400, height: 800 };
  it('opens below the trigger, right-aligned to it', () => {
    expect(placePanel({ top: 100, bottom: 136, right: 380 }, 288, viewport)).toEqual({ top: 140, left: 156 });
  });
  it('flips above when there is no room below', () => {
    expect(placePanel({ top: 700, bottom: 736, right: 380 }, 288, viewport)).toEqual({ top: 408, left: 156 });
  });
  it('never leaves the viewport, horizontally or vertically', () => {
    expect(placePanel({ top: 100, bottom: 136, right: 60 }, 288, viewport).left).toBe(8);
    expect(placePanel({ top: 100, bottom: 136, right: 2000 }, 288, viewport).left).toBe(400 - 224 - 8);
    // Too tall for either side: pinned inside the viewport instead of overflowing it.
    const squeezed = placePanel({ top: 150, bottom: 186, right: 380 }, 288, { width: 400, height: 380 });
    expect(squeezed.top).toBeGreaterThanOrEqual(8);
    expect(squeezed.top + 288).toBeLessThanOrEqual(380 - 8);
  });
});
