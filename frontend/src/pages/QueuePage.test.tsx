// @vitest-environment jsdom
/**
 * Queue reordering: rows are keyed without their index, so a keyboard move
 * re-orders the SAME DOM node (focus survives, artwork is not re-fetched),
 * the result is announced, and drag hit-testing is a binary search over a
 * geometry snapshot rather than a rect read per row per pointermove.
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
vi.mock('@/services/personalization/updater', () => ({
  recordComplete: vi.fn(), recordPlay: vi.fn(), recordQueueAdd: vi.fn(), recordSkip: vi.fn(), recordFavorite: vi.fn(),
}));
vi.mock('@/features/queue/TuneChips', () => ({ TuneChips: () => null }));

import { usePlayerStore } from '@/store/playerStore';
import { makeSong } from '@/__fixtures__/songs';
import QueuePage, { slotForY } from './QueuePage';

const dup = makeSong('x', { title: 'Twice' });
const queue = [makeSong('now'), makeSong('a', { title: 'Alpha' }), dup, makeSong('b', { title: 'Beta' }), dup];

beforeEach(() => {
  usePlayerStore.setState({ queue, index: 0, isPlaying: false });
});
afterEach(cleanup);

const mount = () => render(<MemoryRouter><QueuePage /></MemoryRouter>);
const handle = (title: string) => screen.getAllByRole('button', { name: new RegExp(`^Reorder ${title}`) });
const order = () => screen.getAllByRole('listitem').map((li) => li.textContent?.replace(/Artist.*/, '') ?? '');

describe('QueuePage reordering', () => {
  it('a keyboard move keeps the same DOM node, keeps focus on the handle and announces the new position', () => {
    mount();
    const grip = handle('Alpha')[0];
    const row = grip.closest('li');
    grip.focus();
    fireEvent.keyDown(grip, { key: 'ArrowDown' });

    expect(order()).toEqual(['Twice', 'Alpha', 'Beta', 'Twice']);
    const after = handle('Alpha')[0];
    expect(after).toBe(grip); // not remounted
    expect(after.closest('li')).toBe(row);
    expect(document.activeElement).toBe(grip);
    expect(screen.getByRole('status').textContent).toBe('Moved to position 2 of 4');

    // Focus survived, so the next press keeps moving the same row.
    fireEvent.keyDown(grip, { key: 'ArrowDown' });
    expect(order()).toEqual(['Twice', 'Beta', 'Alpha', 'Twice']);
    expect(document.activeElement).toBe(grip);
    expect(screen.getByRole('status').textContent).toBe('Moved to position 3 of 4');
  });

  it('does nothing at the ends of the list', () => {
    mount();
    const first = handle('Alpha')[0];
    fireEvent.keyDown(first, { key: 'ArrowUp' });
    expect(order()).toEqual(['Alpha', 'Twice', 'Beta', 'Twice']);
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('removing a row leaves the rows below it mounted (duplicate ids included)', () => {
    mount();
    const beta = handle('Beta')[0];
    const lastDup = handle('Twice')[1];
    fireEvent.click(screen.getByRole('button', { name: 'Remove Alpha from queue' }));
    expect(order()).toEqual(['Twice', 'Beta', 'Twice']);
    expect(handle('Beta')[0]).toBe(beta);
    expect(handle('Twice')[1]).toBe(lastDup);
  });

  it('rows stay mounted when the playing song advances', () => {
    mount();
    const beta = handle('Beta')[0];
    act(() => usePlayerStore.setState({ index: 1 }));
    expect(order()).toEqual(['Twice', 'Beta', 'Twice']);
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
