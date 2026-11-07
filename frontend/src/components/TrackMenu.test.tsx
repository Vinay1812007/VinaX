// @vitest-environment jsdom
/**
 * Song "⋯" menu: ARIA wiring on the trigger, roving focus inside the menu,
 * Escape returning focus, and the panel living in <body> (so it cannot be
 * painted over by later rows or clipped by a transformed ancestor).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/audio/engine', () => ({
  audioEngine: { load: vi.fn(), preloadNext: vi.fn(), pause: vi.fn(), play: vi.fn(), seek: vi.fn(), switchQuality: vi.fn(() => false) },
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
    recordComplete: vi.fn(), recordPlay: vi.fn(), recordQueueAdd: vi.fn(), recordSkip: vi.fn(), recordFavorite: vi.fn(), recordPlaylistAdd: vi.fn(), recordDislike: vi.fn(),
    softMuteArtist: actual.softMuteArtist,
  };
});
vi.mock('@/services/feedback', () => ({ sendFeedback: vi.fn(async () => true) }));
vi.mock('@/services/downloads', () => ({ downloadSong: vi.fn(), removeDownload: vi.fn(), lastDownloadFailure: vi.fn(() => null), downloadFailureMessage: vi.fn(() => 'Download failed — please try again') }));

import { usePlayerStore } from '@/store/playerStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
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
/** 1.11 — open the menu and step into More…, where the longer list lives. */
const openMore = () => {
  fireEvent.click(trigger());
  fireEvent.click(screen.getByRole('menuitem', { name: 'More…' }));
};

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
    openMore();
    const less = screen.getByRole('menuitem', { name: 'Less like this…' });
    expect(less.getAttribute('aria-haspopup')).toBe('menu');
    fireEvent.click(less);
    // The same menu, now asking for how long — the menu stays open and says whose.
    const menu = screen.getByRole('menu');
    expect(menu.getAttribute('aria-label')).toBe('Less like this: play less of సిద్ శ్రీరామ్ for how long?');
    expect(items().map((i) => i.textContent)).toEqual(['7 days', '14 days', '30 days', 'Back']);
    expect(document.activeElement).toBe(items()[0]);

    // Escape steps back to More… (and keeps it open), focus on the item that opened it.
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
    openMore();
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

  it('8.2 — "Start radio" starts endless radio from the song and says so', () => {
    const startRadio = vi.fn();
    usePlayerStore.setState({ startRadio });
    mount();
    openMore();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Start radio' }));
    expect(startRadio).toHaveBeenCalledWith(song);
    expect(useToastStore.getState().toasts.slice(-1)[0]?.message).toBe(`Radio: ${song.title}`);
  });
});

describe('1.11 — the short menu', () => {
  it('opens on the main actions, with everything else under More…', () => {
    mount();
    fireEvent.click(trigger());
    const labels = items().map((i) => i.textContent);
    expect(labels.slice(0, 4)).toEqual(['Like', 'Add to playlist…', 'Play next', 'Add to queue']);
    expect(labels).toContain('Share');
    expect(labels).toContain('View lyrics');
    expect(labels[labels.length - 1]).toBe('More…');
    expect(labels).not.toContain('Start radio');
    expect(labels).not.toContain('Not interested');
    // Not the playing song: no Quality.
    expect(labels).not.toContain('Quality…');
    // More… lists the rest, with Back first; Back returns to the short list.
    fireEvent.click(screen.getByRole('menuitem', { name: 'More…' }));
    const more = items().map((i) => i.textContent);
    expect(more[0]).toBe('Back');
    for (const l of ['Start radio', 'Listen later', 'Song details', 'Report broken track', 'Not interested', 'Share to WhatsApp', 'Share as story']) expect(more).toContain(l);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Back' }));
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'More…' }));
  });

  it('Add to playlist… picks a playlist in its own view', () => {
    useLibraryStore.setState({ collections: [{ id: 'c1', name: 'Road trip', createdAt: 1, songs: [] }] });
    mount();
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add to playlist…' }));
    expect(items().map((i) => i.textContent)).toEqual(['Back', 'New playlist…', 'Add to “Road trip”']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add to “Road trip”' }));
    expect(useLibraryStore.getState().collections[0].songs.map((x) => x.id)).toEqual([song.id]);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('Like adds the song to Liked songs, and the label turns into a remove', () => {
    useLibraryStore.setState({ favorites: [] });
    mount();
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('menuitem', { name: 'Like' }));
    expect(useLibraryStore.getState().favorites.map((x) => x.id)).toEqual([song.id]);
    fireEvent.click(trigger());
    expect(screen.getByRole('menuitem', { name: 'Remove from Liked songs' })).toBeTruthy();
  });

  it('Quality… is offered for the playing song and sets the streaming level', () => {
    usePlayerStore.setState({ queue: [song], index: 0 });
    useSettingsStore.setState({ audioQuality: 'high' });
    mount();
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('menuitem', { name: 'Quality…' }));
    const levels = screen.getAllByRole('menuitemradio');
    expect(levels.map((i) => i.textContent)).toEqual(['Low · 48 kbps', 'Medium · 96 kbps', 'High · 160 kbps', 'Very high · 320 kbps']);
    expect(levels[3].getAttribute('aria-checked')).toBe('true');
    fireEvent.click(levels[2]);
    expect(useSettingsStore.getState().audioQuality).toBe('medium');
    expect(useToastStore.getState().toasts.slice(-1)[0]?.message).toMatch(/^Quality: High/);
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

describe('<TrackMenu /> — 1.3 podcast episodes', () => {
  const Where = () => <p data-testid="where">{useLocation().pathname}</p>;
  const open = (s: ReturnType<typeof makeSong>) => {
    render(
      <MemoryRouter>
        <TrackMenu song={s} />
        <Where />
      </MemoryRouter>,
    );
    fireEvent.click(trigger());
  };

  it('an episode goes to its podcast, not to an album page', () => {
    open(makeSong('ep', { album: { id: '62', name: 'Talking Music' }, audio: [{ quality: 'original', url: 'https://x/ep.mp3' }] }));
    expect(screen.queryByRole('menuitem', { name: 'Go to album' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Go to podcast' }));
    expect(screen.getByTestId('where').textContent).toBe('/podcast/talking-music-62');
  });

  it('a song still goes to its album', () => {
    open(makeSong('s', { album: { id: '9', name: 'Film' }, audio: [{ quality: '320kbps', url: 'https://x/s.mp4' }] }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Go to album' }));
    expect(screen.getByTestId('where').textContent).toBe('/album/film-9');
  });
});
