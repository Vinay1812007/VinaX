// @vitest-environment jsdom
/**
 * The VinaX AI playlist card: Play starts on the first song found, in order,
 * and queues the rest as they are found; the answers are kept, so Save or
 * Add to queue after Play searches nothing again; a row with no match says so.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Song } from '@/types';
import { makeSong } from '@/__fixtures__/songs';

const searchSongs = vi.fn<(q: string) => Promise<Song[]>>();
vi.mock('@/services/api/saavn', () => ({ searchSongs: (q: string) => searchSongs(q) }));
vi.mock('@/services/auth/gate', () => ({ requireAccount: () => true }));

const player = {
  queue: [] as Song[],
  index: 0,
  shuffle: false,
  playQueue: vi.fn((songs: Song[]) => {
    player.queue = [...songs];
    player.index = 0;
  }),
  enqueueAll: vi.fn((songs: Song[]) => {
    player.queue = [...player.queue, ...songs];
  }),
};
vi.mock('@/store/playerStore', () => ({ usePlayerStore: { getState: () => player } }));

const lib = { createCollection: vi.fn(() => 'c1'), addManyToCollection: vi.fn((_id: string, songs: Song[]) => songs.length) };
vi.mock('@/store/libraryStore', () => ({ useLibraryStore: { getState: () => lib } }));

const { PlaylistCard } = await import('./PlaylistCard');

/** A search per song title that the test answers by hand. */
function deferredSearch(): Map<string, (songs: Song[]) => void> {
  const waiting = new Map<string, (songs: Song[]) => void>();
  searchSongs.mockImplementation((q) => new Promise((resolve) => waiting.set(q.split(' ')[0], resolve)));
  return waiting;
}

const card = (text: string) => render(<MemoryRouter><PlaylistCard text={text} /></MemoryRouter>);

beforeEach(() => {
  player.queue = [];
  player.index = 0;
  player.shuffle = false;
  player.playQueue.mockClear();
  player.enqueueAll.mockClear();
  lib.createCollection.mockClear();
  lib.addManyToCollection.mockClear();
  searchSongs.mockReset();
});
afterEach(cleanup);

describe('PlaylistCard', () => {
  it('plays the first song as soon as it is found, then queues the rest in order', async () => {
    const one = makeSong('p1', { title: 'Alpha', artist: 'Ann' });
    const two = makeSong('p2', { title: 'Bravo', artist: 'Ben' });
    const four = makeSong('p4', { title: 'Delta', artist: 'Dee' });
    const waiting = deferredSearch();
    card('title: Mix\nAlpha — Ann\nBravo — Ben\nCharlie — Cat\nDelta — Dee');
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    await waitFor(() => expect(waiting.size).toBe(4));
    await act(async () => waiting.get('Bravo')!([two]));
    expect(player.playQueue).not.toHaveBeenCalled();
    await act(async () => waiting.get('Alpha')!([one]));
    expect(player.playQueue).toHaveBeenCalledWith([one], 0, { keepList: true, from: { kind: 'playlist', label: 'Mix' } });
    expect(player.enqueueAll).toHaveBeenLastCalledWith([two], { quiet: true });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy());
    await act(async () => waiting.get('Delta')!([four]));
    expect(player.enqueueAll).toHaveBeenCalledTimes(1); // Charlie has not answered yet
    await act(async () => waiting.get('Charlie')!([]));
    expect(player.enqueueAll).toHaveBeenLastCalledWith([four], { quiet: true });
    expect(screen.getByText('Not in the catalogue')).toBeTruthy();

    // Save after Play: nothing is searched again.
    fireEvent.click(screen.getByRole('button', { name: 'Save to library' }));
    await waitFor(() => expect(lib.addManyToCollection).toHaveBeenCalledWith('c1', [one, two, four]));
    expect(searchSongs).toHaveBeenCalledTimes(4);
  });

  it('stops adding songs once the listener plays something else', async () => {
    const one = makeSong('q1', { title: 'Echo', artist: 'Eve' });
    const two = makeSong('q2', { title: 'Foxtrot', artist: 'Fay' });
    const waiting = deferredSearch();
    card('Echo — Eve\nFoxtrot — Fay');
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    await waitFor(() => expect(waiting.size).toBe(2));
    await act(async () => waiting.get('Echo')!([one]));
    expect(player.playQueue).toHaveBeenCalledTimes(1);
    player.queue = [makeSong('elsewhere')];
    await act(async () => waiting.get('Foxtrot')!([two]));
    expect(player.enqueueAll).not.toHaveBeenCalled();
  });

  it('with shuffle on, adds the rest once, after every answer is in', async () => {
    player.shuffle = true;
    const one = makeSong('s1', { title: 'Juliet', artist: 'Jo' });
    const two = makeSong('s2', { title: 'Kilo', artist: 'Kay' });
    const three = makeSong('s3', { title: 'Lima', artist: 'Lee' });
    const waiting = deferredSearch();
    card('Juliet — Jo\nKilo — Kay\nLima — Lee');
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    await waitFor(() => expect(waiting.size).toBe(3));
    await act(async () => waiting.get('Juliet')!([one]));
    await act(async () => waiting.get('Kilo')!([two]));
    expect(player.playQueue).toHaveBeenCalledWith([one], 0, expect.objectContaining({ keepList: true }));
    expect(player.enqueueAll).not.toHaveBeenCalled();
    await act(async () => waiting.get('Lima')!([three]));
    await waitFor(() => expect(player.enqueueAll).toHaveBeenCalledTimes(1));
    const [added, opts] = player.enqueueAll.mock.calls[0] as unknown as [Song[], unknown];
    expect(added.map((s) => s.id).sort()).toEqual(['s2', 's3']);
    expect(opts).toEqual({ quiet: true });
  });

  it('Add to queue adds every song found, in order', async () => {
    const one = makeSong('r1', { title: 'Golf', artist: 'Gia' });
    const two = makeSong('r2', { title: 'Hotel', artist: 'Hal' });
    searchSongs.mockImplementation(async (q) => (q.startsWith('Golf') ? [one] : q.startsWith('Hotel') ? [two] : []));
    card('Golf — Gia\nIndia — Ivy\nHotel — Hal');
    fireEvent.click(screen.getByRole('button', { name: 'Add to queue' }));
    await waitFor(() => expect(player.enqueueAll).toHaveBeenCalledWith([one, two]));
    expect(screen.getByText('Not in the catalogue')).toBeTruthy();
    // Play now needs no search and plays the whole list at once.
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    await waitFor(() => expect(player.playQueue).toHaveBeenCalledWith([one, two], 0, { from: { kind: 'playlist', label: 'Playlist from VinaX AI' } }));
    expect(searchSongs).toHaveBeenCalledTimes(3);
  });
});
