// @vitest-environment jsdom
/**
 * 1.20 — the Queue page reads and works like Spotify's: Now playing, Next in
 * queue (with Clear queue), Next from: <what you played>, Autoplay, and a
 * Recently played tab. Rows are keyed without their index, so a keyboard move
 * re-orders the SAME DOM node (focus survives) and is announced; drag
 * hit-testing is a binary search over a geometry snapshot.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/audio/engine', () => ({
  audioEngine: { load: vi.fn(), preloadNext: vi.fn(), pause: vi.fn(), play: vi.fn(), seek: vi.fn(), fadeIn: vi.fn(), fadeOut: vi.fn() },
  orderedSources: () => [],
}));
vi.mock('@/services/media-session', () => ({
  setMediaHandlers: vi.fn(), updateMediaMetadata: vi.fn(), updatePlaybackState: vi.fn(), updatePositionState: vi.fn(),
}));
vi.mock('@/services/native', () => ({ checkNotificationOnFirstPlay: vi.fn(), haptic: vi.fn(), isNativePlatform: () => false, platformName: () => 'web' }));
vi.mock('@/services/feedback', () => ({ sendFeedback: vi.fn(async () => true) }));
vi.mock('@/services/downloads', () => ({ canSaveOffline: () => false, downloadSong: vi.fn(), removeDownload: vi.fn(), lastDownloadFailure: vi.fn(() => null), downloadFailureMessage: vi.fn(() => 'Download failed — please try again') }));
vi.mock('@/services/personalization/updater', () => ({
  recordComplete: vi.fn(), recordPlay: vi.fn(), recordQueueAdd: vi.fn(), recordSkip: vi.fn(), recordFavorite: vi.fn(), softMuteArtist: vi.fn(), recordPlaylistAdd: vi.fn(), recordDislike: vi.fn(),
}));
vi.mock('@/services/autoplay', () => ({ findAutoplaySongs: async () => [], pickAutoplay: (s: unknown[]) => s }));

import { usePlayerStore, type QueueRun } from '@/store/playerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useHistoryStore } from '@/store/historyStore';
import { useToastStore } from '@/store/toastStore';
import { makeSong } from '@/__fixtures__/songs';
import QueuePage, { slotForY } from './QueuePage';

const now = makeSong('now', { title: 'Now' });
const dup = makeSong('x', { title: 'Twice' });
const alpha = makeSong('a', { title: 'Alpha' });
const beta = makeSong('b', { title: 'Beta' });
const mine = makeSong('hand', { title: 'Mine' });
const sim = makeSong('sim', { title: 'Similar' });

const setQueue = (songs: ReturnType<typeof makeSong>[], runs: QueueRun[]) =>
  usePlayerStore.setState({ queue: songs, runs, index: 0, isPlaying: false, followMode: false, context: { kind: 'album', label: 'Pushpa 2', path: '/album/1' } });

beforeEach(() => {
  setQueue([now, alpha, dup, beta, dup], ['context', 'context', 'context', 'context', 'context']);
  useSettingsStore.setState({ autoplay: true });
  useToastStore.setState({ toasts: [] });
});
afterEach(cleanup);

const mount = () => render(<MemoryRouter><QueuePage /></MemoryRouter>);
const handle = (title: string) => screen.getAllByRole('button', { name: new RegExp(`^Reorder ${title}`) });
const songRows = () => screen.getAllByRole('listitem');
const order = () => songRows().map((li) => li.textContent?.replace(/Artist.*/, '') ?? '');
const status = () => screen.getByRole('status').textContent;
const ids = () => usePlayerStore.getState().queue.map((s) => s.id);

describe('Queue page — sections', () => {
  it('reads Now playing, Next in queue, Next from: <what you played>, then Autoplay', () => {
    setQueue([now, mine, alpha, sim], ['context', 'queued', 'context', 'autoplay']);
    mount();
    expect(screen.getByRole('heading', { name: 'Now playing' })).toBeTruthy();
    const text = screen.getByRole('list').textContent ?? '';
    expect(text.indexOf('Next in queue')).toBeLessThan(text.indexOf('Mine'));
    expect(text.indexOf('Mine')).toBeLessThan(text.indexOf('Next from: Pushpa 2'));
    expect(text.indexOf('Next from: Pushpa 2')).toBeLessThan(text.indexOf('Alpha'));
    expect(text.indexOf('Alpha')).toBeLessThan(text.indexOf('Autoplay'));
    expect(text.indexOf('Autoplay')).toBeLessThan(text.indexOf('Similar'));
    expect(screen.getByRole('link', { name: 'Pushpa 2' }).getAttribute('href')).toBe('/album/1');
  });

  it('Clear queue drops only the songs you added', () => {
    setQueue([now, mine, alpha], ['context', 'queued', 'context']);
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Clear queue' }));
    expect(ids()).toEqual(['now', 'a']);
    expect(screen.queryByText('Next in queue')).toBeNull();
  });

  it('the Autoplay switch is the Settings one; shuffle and repeat sit with the queue', () => {
    mount();
    fireEvent.click(screen.getByRole('switch', { name: 'Autoplay' }));
    expect(useSettingsStore.getState().autoplay).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Shuffle' }));
    expect(usePlayerStore.getState().shuffle).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Repeat off' }));
    expect(usePlayerStore.getState().repeat).toBe('all');
    act(() => usePlayerStore.getState().toggleShuffle());
    act(() => usePlayerStore.setState({ repeat: 'off' }));
  });

  it('Recently played lists what this device played', () => {
    useHistoryStore.setState({ entries: [{ song: beta, ts: 2, completed: true }, { song: alpha, ts: 1, completed: true }] });
    mount();
    fireEvent.click(screen.getByRole('tab', { name: 'Recently played' }));
    expect(order()).toEqual(['Beta', 'Alpha']);
  });

  it('an empty queue says how to start one', () => {
    usePlayerStore.setState({ queue: [], runs: [], index: 0 });
    mount();
    expect(screen.getByText('Your queue is empty')).toBeTruthy();
  });
});

describe('Queue page — rows', () => {
  it('a keyboard move keeps the same DOM node, keeps focus on the handle and announces the new position', () => {
    mount();
    const [grip] = handle('Alpha');
    const row = grip.closest('li');
    grip.focus();
    fireEvent.keyDown(grip, { key: 'ArrowDown' });
    expect(order()).toEqual(['Twice', 'Alpha', 'Beta', 'Twice']);
    expect(handle('Alpha')[0].closest('li')).toBe(row);
    expect(document.activeElement).toBe(handle('Alpha')[0]);
    expect(status()).toBe('Alpha moved to position 2 of 4');
  });

  it('does nothing at the ends of the list', () => {
    mount();
    fireEvent.keyDown(handle('Alpha')[0], { key: 'ArrowUp' });
    expect(order()).toEqual(['Alpha', 'Twice', 'Beta', 'Twice']);
  });

  it('the row menu removes and moves a row without a pointer', () => {
    mount();
    fireEvent.click(screen.getAllByRole('button', { name: 'More options for Beta' })[0]);
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Move up' }));
    expect(order()).toEqual(['Alpha', 'Beta', 'Twice', 'Twice']);
    fireEvent.click(screen.getAllByRole('button', { name: 'More options for Beta' })[0]);
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Remove from queue' }));
    expect(order()).toEqual(['Alpha', 'Twice', 'Twice']);
  });

  it('× removes a row, leaves the rows below it mounted and announces it', () => {
    mount();
    const betaRow = handle('Beta')[0].closest('li');
    fireEvent.click(screen.getByRole('button', { name: 'Remove Alpha from queue' }));
    expect(order()).toEqual(['Twice', 'Beta', 'Twice']);
    expect(handle('Beta')[0].closest('li')).toBe(betaRow);
    expect(status()).toBe('Removed Alpha');
  });

  it('a tap plays the row: the list songs above it are skipped, your adds stay next', () => {
    setQueue([now, mine, alpha, beta], ['context', 'queued', 'context', 'context']);
    mount();
    fireEvent.click(screen.getByText('Beta').closest('button')!);
    const st = usePlayerStore.getState();
    expect(st.queue[st.index].id).toBe('b');
    expect(st.queue.slice(st.index + 1).map((s) => s.id)).toEqual(['hand']);
  });

  it('rows stay mounted when the playing song advances', () => {
    mount();
    const twice = handle('Twice')[1].closest('li');
    act(() => usePlayerStore.setState({ index: 1 }));
    expect(handle('Twice')[1].closest('li')).toBe(twice);
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
