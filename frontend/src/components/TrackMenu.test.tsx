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
vi.mock('@/services/native', () => ({ checkNotificationOnFirstPlay: vi.fn(), haptic: vi.fn(), isNativePlatform: () => false, platformName: () => 'web' }));
vi.mock('@/services/storage/idb', () => ({ addEvent: vi.fn(async () => undefined), getRecentEvents: vi.fn(async () => []), clearEvents: vi.fn(async () => undefined) }));
// The play recorders are stubs, but "Less like this" writes a real soft mute:
// the test follows it through to the profile and back out again with Undo.
vi.mock('@/services/personalization/updater', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/personalization/updater')>();
  return {
    recordComplete: vi.fn(), recordPlay: vi.fn(), recordQueueAdd: vi.fn(), recordSkip: vi.fn(), recordFavorite: vi.fn(),
    softMuteArtist: actual.softMuteArtist,
  };
});
vi.mock('@/services/feedback', () => ({ sendFeedback: vi.fn(async () => true) }));
vi.mock('@/services/downloads', () => ({ downloadSong: vi.fn(), removeDownload: vi.fn(), lastDownloadFailure: vi.fn(() => null), downloadFailureMessage: vi.fn(() => 'Download failed — please try again') }));

import { usePlayerStore } from '@/store/playerStore';
import { useToastStore } from '@/store/toastStore';
import { makeSong } from '@/__fixtures__/songs';
import { listSoftMutes, clearSoftMutes } from '@/services/personalization/softMutes';
import { placePanel, TrackMenu } from './TrackMenu';

const song = makeSong('a', { artist: 'సిద్ శ్రీరామ్' });
const enqueue = vi.fn();

beforeEach(() => {
  enqueue.mockReset();
  localStorage.clear();
  clearSoftMutes();
  useToastStore.setState({ toasts: [] });
  usePlayerStore.setState({ enqueue, queue: [], index: 0 });
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

  it('v7.0.1 — the page behind never scrolls: wheel on the backdrop, or past the end of the list, is swallowed', () => {
    mount();
    fireEvent.click(trigger());
    const menu = screen.getByRole('menu');
    const backdrop = menu.previousElementSibling as HTMLElement;
    expect(menu.className).toContain('overscroll-contain');
    const wheel = (target: Element, deltaY: number): boolean => {
      const e = new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true });
      target.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(wheel(backdrop, 120)).toBe(true);
    // A list with nothing left to scroll must not hand the gesture to the page…
    expect(wheel(items()[0], 120)).toBe(true);
    // …but a list that CAN scroll keeps its own scrolling.
    Object.defineProperty(menu, 'scrollHeight', { configurable: true, value: 600 });
    Object.defineProperty(menu, 'clientHeight', { configurable: true, value: 288 });
    expect(wheel(items()[0], 120)).toBe(false);
    expect(wheel(items()[0], -120)).toBe(true); // already at the top
  });

  it('7.2 — "Less like this" asks for how long, mutes for that long and offers an exact Undo', () => {
    mount();
    fireEvent.click(trigger());
    const less = screen.getByRole('menuitem', { name: 'Less like this…' });
    expect(less.getAttribute('aria-haspopup')).toBe('menu');
    fireEvent.click(less);
    // The same menu, now asking for how long — the menu stays open and says whose.
    const menu = screen.getByRole('menu');
    expect(menu.getAttribute('aria-label')).toBe('Less like this: play less of సిద్ శ్రీరామ్ for how long?');
    expect(items().map((i) => i.textContent)).toEqual(['7 days', '14 days', '30 days', 'Back']);
    expect(document.activeElement).toBe(items()[0]);

    // Escape steps back to the full menu (and keeps it open), focus on the item that opened it.
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Less like this…' }));

    fireEvent.click(screen.getByRole('menuitem', { name: 'Less like this…' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '7 days' }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(listSoftMutes().map((m) => m.name)).toEqual(['సిద్ శ్రీరామ్']);
    const toasts = useToastStore.getState().toasts;
    const toast = toasts[toasts.length - 1];
    expect(toast.message).toMatch(/^Less of సిద్ శ్రీరామ్ until /);
    toast.action!.onClick();
    expect(listSoftMutes()).toEqual([]);
  });

  it('7.2 — the permanent blocks sit in their own group, and a long artist name is never sliced', () => {
    mount();
    fireEvent.click(trigger());
    const labels = items().map((i) => i.textContent);
    expect(labels).toContain('More like this');
    expect(labels).toContain('Not interested');
    // Never play carries the whole name (CSS truncates it; slicing broke Indic clusters).
    expect(labels).toContain('Never play సిద్ శ్రీరామ్');
    expect(screen.getAllByRole('separator').length).toBeGreaterThanOrEqual(2);
    // A divider separates the temporary "Less like this" from the permanent blocks.
    const menu = screen.getByRole('menu');
    const nodes = Array.from(menu.children);
    const lessAt = nodes.findIndex((n) => n.textContent === 'Less like this…');
    const blockAt = nodes.findIndex((n) => n.textContent === 'Not interested');
    expect(nodes.slice(lessAt, blockAt).some((n) => n.getAttribute('role') === 'separator')).toBe(true);
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

  it('8.2 — "Start AI Radio" starts endless radio from the song and says so', () => {
    const startRadio = vi.fn();
    usePlayerStore.setState({ startRadio });
    mount();
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('menuitem', { name: 'Start AI Radio' }));
    expect(startRadio).toHaveBeenCalledWith(song);
    expect(useToastStore.getState().toasts.slice(-1)[0]?.message).toBe(`AI Radio: ${song.title}`);
  });
});

describe('placePanel', () => {
  const viewport = { width: 400, height: 800 };
  it('opens below the trigger, right-aligned to it', () => {
    expect(placePanel({ top: 100, bottom: 136, right: 380 }, 288, viewport)).toEqual({ top: 140, left: 124 });
  });
  it('flips above when there is no room below', () => {
    expect(placePanel({ top: 700, bottom: 736, right: 380 }, 288, viewport)).toEqual({ top: 408, left: 124 });
  });
  it('never leaves the viewport, horizontally or vertically', () => {
    expect(placePanel({ top: 100, bottom: 136, right: 60 }, 288, viewport).left).toBe(8);
    expect(placePanel({ top: 100, bottom: 136, right: 2000 }, 288, viewport).left).toBe(400 - 256 - 8);
    // Too tall for either side: pinned inside the viewport instead of overflowing it.
    const squeezed = placePanel({ top: 150, bottom: 186, right: 380 }, 288, { width: 400, height: 380 });
    expect(squeezed.top).toBeGreaterThanOrEqual(8);
    expect(squeezed.top + 288).toBeLessThanOrEqual(380 - 8);
  });
});
