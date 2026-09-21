// @vitest-environment jsdom
/**
 * Queue reordering and ownership: rows are keyed without their index, so a
 * keyboard move re-orders the SAME DOM node (focus survives, artwork is not
 * re-fetched), the result is announced, and drag hit-testing is a binary
 * search over a geometry snapshot rather than a rect read per row per
 * pointermove. 7.2 adds the manual / automatic marker, the row menu's
 * keyboard moves, "Keep this song", remove with Undo and the deliberate
 * rebuild of the DJ picks.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
vi.mock('@/services/feedback', () => ({ sendFeedback: vi.fn(async () => true) }));
vi.mock('@/services/downloads', () => ({ downloadSong: vi.fn(), removeDownload: vi.fn() }));
vi.mock('@/services/personalization/updater', () => ({
  recordComplete: vi.fn(), recordPlay: vi.fn(), recordQueueAdd: vi.fn(), recordSkip: vi.fn(), recordFavorite: vi.fn(), softMuteArtist: vi.fn(),
}));
vi.mock('@/features/queue/TuneChips', () => ({ TuneChips: () => null }));

import { usePlayerStore } from '@/store/playerStore';
import { useToastStore } from '@/store/toastStore';
import { makeSong } from '@/__fixtures__/songs';
import QueuePage, { slotForY } from './QueuePage';

const dup = makeSong('x', { title: 'Twice' });
const queue = [makeSong('now'), makeSong('a', { title: 'Alpha' }), dup, makeSong('b', { title: 'Beta' }), dup];

/** The queue's ownership lives in the store's closure — drive it through the
 *  same calls the app makes: the recommender appends its tail, the listener
 *  queues by hand. */
const pick1 = makeSong('p1', { title: 'Pick one' });
const pick2 = makeSong('p2', { title: 'Pick two' });
const mine = makeSong('hand', { title: 'Mine' });
const seedOwnership = (withHandQueued = true) => {
  act(() => {
    usePlayerStore.getState().replaceAutoTail([pick1, pick2]);
    if (withHandQueued) usePlayerStore.getState().enqueue(mine);
  });
};

beforeEach(() => {
  usePlayerStore.setState({ queue, index: 0, isPlaying: false });
  useToastStore.setState({ toasts: [] });
});
afterEach(cleanup);

const mount = () => render(<MemoryRouter><QueuePage /></MemoryRouter>);
const handle = (title: string) => screen.getAllByRole('button', { name: new RegExp(`^Reorder ${title}`) });
const rows = () => screen.getAllByRole('listitem');
const order = () => rows().map((li) => li.textContent?.replace(/Artist.*/, '') ?? '');
const status = () => screen.getByRole('status').textContent;
const openMenu = (title: string, nth = 0) => {
  fireEvent.click(screen.getAllByRole('button', { name: `More options for ${title}` })[nth]);
  return screen.getByRole('menu');
};
const removeButton = (title: string, nth = 0) => screen.getAllByRole('button', { name: `Remove ${title} from queue` })[nth];

describe('QueuePage reordering', () => {
  it('a keyboard move keeps the same DOM node, keeps focus on the handle and announces the new position', () => {
    mount();
    const grip = handle('Alpha')[0];
    const row = grip.closest('li');
    grip.focus();
    fireEvent.keyDown(grip, { key: 'ArrowDown' });

    expect(order().map((t) => t.split(/DJ pick|Added by you/)[0])).toEqual(['Twice', 'Alpha', 'Beta', 'Twice']);
    const after = handle('Alpha')[0];
    expect(after).toBe(grip); // not remounted
    expect(after.closest('li')).toBe(row);
    expect(document.activeElement).toBe(grip);
    expect(status()).toBe('Alpha moved to position 2 of 4');

    // Focus survived, so the next press keeps moving the same row.
    fireEvent.keyDown(grip, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(grip);
    expect(status()).toBe('Alpha moved to position 3 of 4');
  });

  it('does nothing at the ends of the list', () => {
    mount();
    const first = handle('Alpha')[0];
    fireEvent.keyDown(first, { key: 'ArrowUp' });
    expect(status()).toBe('');
  });

  it('the row menu moves a row without a pointer and puts focus back on that row’s menu', () => {
    mount();
    const menu = openMenu('Alpha');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Move down' }));
    expect(status()).toBe('Alpha moved to position 2 of 4');
    const trigger = screen.getByRole('button', { name: 'More options for Alpha' });
    expect(document.activeElement).toBe(trigger);
    // The first row has no "Move up"; the last has no "Move down" or "Clear from here down".
    const first = openMenu('Twice');
    expect(within(first).queryByRole('menuitem', { name: 'Move up' })).toBeNull();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    const last = openMenu('Twice', 1);
    expect(within(last).queryByRole('menuitem', { name: 'Move down' })).toBeNull();
    expect(within(last).queryByRole('menuitem', { name: 'Clear from here down' })).toBeNull();
  });

  it('removing a row leaves the rows below it mounted, announces it and offers Undo', () => {
    mount();
    const beta = handle('Beta')[0];
    fireEvent.click(removeButton('Alpha'));
    expect(order().map((t) => t.split(/DJ pick|Added by you/)[0])).toEqual(['Twice', 'Beta', 'Twice']);
    expect(handle('Beta')[0]).toBe(beta);
    expect(status()).toBe('Removed Alpha');
    // Focus moved to the row that took its place, not to nowhere.
    expect(document.activeElement).toBe(removeButton('Twice'));

    const undo = useToastStore.getState().toasts.at(-1)?.action;
    expect(undo?.label).toBe('Undo');
    act(() => undo!.onClick());
    expect(order().map((t) => t.split(/DJ pick|Added by you/)[0])).toEqual(['Alpha', 'Twice', 'Beta', 'Twice']);
    expect(status()).toBe('Alpha is back in the queue');
  });

  it('rows stay mounted when the playing song advances', () => {
    mount();
    const beta = handle('Beta')[0];
    act(() => usePlayerStore.setState({ index: 1 }));
    expect(handle('Beta')[0]).toBe(beta);
  });

  it('the 28px reorder grip carries a hit pad, and the sort chips call the store', () => {
    const sortUpcoming = vi.fn();
    usePlayerStore.setState({ sortUpcoming });
    mount();
    expect(handle('Alpha')[0].className).toContain('after:-m-[8px]');
    fireEvent.click(screen.getByRole('button', { name: 'Energy' }));
    expect(sortUpcoming).toHaveBeenCalledWith('energy');
  });
});

describe('QueuePage ownership', () => {
  it('marks automatic and hand-queued entries in words, and counts them for the listener', () => {
    seedOwnership();
    mount();
    const handRow = rows().find((li) => li.textContent?.includes('Mine'))!;
    expect(within(handRow).getByText('Added by you')).toBeTruthy();
    const autoRow = rows().find((li) => li.textContent?.includes('Pick one'))!;
    expect(within(autoRow).getByText('DJ pick')).toBeTruthy();
    // A song from the list the listener started carries no marker.
    const listRow = rows().find((li) => li.textContent?.includes('Alpha'))!;
    expect(within(listRow).queryByText('DJ pick')).toBeNull();
    expect(within(listRow).queryByText('Added by you')).toBeNull();
    expect(screen.getByText(/2 DJ picks · 1 added by you/)).toBeTruthy();
  });

  it('offers "Keep this song" on an automatic entry only, and keeping it turns the marker into the listener’s own', () => {
    seedOwnership(false);
    mount();
    // Not on a song from the listener's own list…
    expect(within(openMenu('Alpha')).queryByRole('menuitem', { name: 'Keep this song' })).toBeNull();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    // …only on a DJ pick.
    expect(within(openMenu('Pick one')).getByRole('menuitem', { name: 'Keep this song' })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Keep this song' }));
    const kept = rows().find((li) => li.textContent?.includes('Pick one'))!;
    expect(within(kept).getByText('Added by you')).toBeTruthy();
    expect(status()).toMatch(/stays when the DJ picks change/);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'More options for Pick one' }));
    // Now that it is the listener's own, the menu no longer offers to keep it.
    expect(within(openMenu('Pick one')).queryByRole('menuitem', { name: 'Keep this song' })).toBeNull();
  });

  it('"New DJ picks" says what it replaces, keeps hand-queued songs and reports when nothing comes back', () => {
    seedOwnership();
    vi.useFakeTimers();
    const regenerateAutoTail = vi.fn();
    usePlayerStore.setState({ regenerateAutoTail });
    mount();
    const button = screen.getByRole('button', { name: 'New DJ picks' });
    // Three songs came from the list that was tapped, so the note says so.
    expect(screen.getByText(/Replaces the 6 upcoming songs you didn’t add, including 4 from the list you started\. Songs you added stay\./)).toBeTruthy();
    expect(button.getAttribute('aria-describedby')).toBe('vx-rebuild-note');
    fireEvent.click(button);
    expect(regenerateAutoTail).toHaveBeenCalled();
    expect(status()).toBe('Getting new DJ picks. Songs you added stay.');
    act(() => {
      vi.advanceTimersByTime(12_000);
    });
    expect(screen.getByRole('alert').textContent).toMatch(/Couldn’t get new DJ picks/);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    vi.useRealTimers();
  });
});

describe('slotForY', () => {
  const mids = [33, 107, 181, 255];
  it('binary-searches the snapshot of row midpoints', () => {
    expect(slotForY(mids, -50)).toBe(0);
    expect(slotForY(mids, 32)).toBe(0);
    expect(slotForY(mids, 33)).toBe(1);
    expect(slotForY(mids, 180)).toBe(2);
    expect(slotForY(mids, 254)).toBe(3);
    expect(slotForY(mids, 9999)).toBe(3);
  });
  it('is safe on an empty list', () => {
    expect(slotForY([], 10)).toBe(0);
  });
});
