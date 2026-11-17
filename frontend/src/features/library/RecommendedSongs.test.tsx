// @vitest-environment jsdom
/**
 * The "Recommended songs" footer under a playlist: it waits until it is near
 * the screen, shows songs not in the playlist and allowed right now, + adds a
 * song (and it leaves the list), and Refresh asks again with other seeds.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';
import { makeSong } from '@/__fixtures__/songs';

const { recommendFromSeeds, toast } = vi.hoisted(() => ({ recommendFromSeeds: vi.fn(), toast: vi.fn() }));
let hidden = new Set<string>();
const lib = { collections: [] as Array<{ id: string; name: string; songs: Song[] }> };
const addToCollection = vi.fn((cid: string, song: Song) => {
  lib.collections = lib.collections.map((c) => (c.id === cid ? { ...c, songs: [...c.songs, song] } : c));
});
const removeManyFromCollection = vi.fn();

vi.mock('@/services/recs/similar', () => ({ recommendFromSeeds }));
vi.mock('@/features/home/useShelfSafety', () => ({ useShelfSafety: () => (s: Song) => !hidden.has(s.id) }));
vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: { getState: () => ({ ...lib, addToCollection, removeManyFromCollection }) },
}));
vi.mock('@/store/toastStore', () => ({ toast }));
vi.mock('@/components/SongRow', () => ({
  SongRow: ({ song, songs, index }: { song: Song; songs: Song[]; index: number }) => (
    <div data-testid="rec" data-list={songs.map((s) => s.id).join(',')} data-index={index}>{song.title}</div>
  ),
}));
vi.mock('@/components/SectionHeader', () => ({
  SectionHeader: ({ title, action }: { title: string; action?: React.ReactNode }) => <div><h2>{title}</h2>{action}</div>,
}));

import { RecommendedSongs } from './RecommendedSongs';

let ioCallback: ((entries: Array<{ isIntersecting: boolean }>) => void) | null = null;
class FakeIO {
  constructor(cb: (entries: Array<{ isIntersecting: boolean }>) => void) { ioCallback = cb; }
  observe() {}
  disconnect() {}
}

const mount = (songs: Song[]) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (list: Song[]) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter><RecommendedSongs collectionId="c1" name="Road trip" songs={list} /></MemoryRouter>
    </QueryClientProvider>
  );
  const r = render(ui(songs));
  return { ...r, update: (list: Song[]) => r.rerender(ui(list)) };
};
const shownIds = () => screen.queryAllByTestId('rec').map((el) => el.textContent);

beforeEach(() => {
  recommendFromSeeds.mockReset();
  addToCollection.mockClear();
  toast.mockReset();
  hidden = new Set();
  ioCallback = null;
  vi.stubGlobal('IntersectionObserver', FakeIO);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('RecommendedSongs', () => {
  it('fetches only once the section comes near the screen', async () => {
    recommendFromSeeds.mockResolvedValue([makeSong('n1', { title: 'New one' })]);
    mount([makeSong('p1')]);
    expect(recommendFromSeeds).not.toHaveBeenCalled();
    act(() => ioCallback?.([{ isIntersecting: true }]));
    expect(await screen.findByText('New one')).toBeTruthy();
    expect(recommendFromSeeds).toHaveBeenCalledTimes(1);
  });

  it('shows songs not in the playlist and allowed now; a row plays the list from there', async () => {
    hidden = new Set(['bad']);
    recommendFromSeeds.mockResolvedValue([makeSong('p1', { title: 'p1' }), makeSong('bad', { title: 'bad' }), makeSong('n1', { title: 'n1' }), makeSong('n2', { title: 'n2' })]);
    mount([makeSong('p1')]);
    act(() => ioCallback?.([{ isIntersecting: true }]));
    await waitFor(() => expect(shownIds()).toEqual(['n1', 'n2']));
    const rows = screen.getAllByTestId('rec');
    expect(rows[1].getAttribute('data-list')).toBe('n1,n2');
    expect(rows[1].getAttribute('data-index')).toBe('1');
  });

  it('+ adds the song to the playlist, says so with Undo, and the row leaves', async () => {
    const playlist = [makeSong('p1')];
    lib.collections = [{ id: 'c1', name: 'Road trip', songs: playlist }];
    const n1 = makeSong('n1', { title: 'n1' });
    recommendFromSeeds.mockResolvedValue([n1, makeSong('n2', { title: 'n2' })]);
    const { update } = mount(playlist);
    act(() => ioCallback?.([{ isIntersecting: true }]));
    await waitFor(() => expect(shownIds()).toEqual(['n1', 'n2']));
    fireEvent.click(screen.getByRole('button', { name: 'Add n1 to Road trip' }));
    expect(addToCollection).toHaveBeenCalledWith('c1', n1);
    expect(toast).toHaveBeenCalledWith('Added “n1” to “Road trip”', expect.objectContaining({ action: expect.objectContaining({ label: 'Undo' }) }));
    update([...playlist, n1]);
    expect(shownIds()).toEqual(['n2']);
    expect(recommendFromSeeds).toHaveBeenCalledTimes(1);
  });

  it('Refresh asks again and leaves out what was shown', async () => {
    const playlist = Array.from({ length: 10 }, (_, i) => makeSong(`p${i}`, { artist: `Artist ${i}` }));
    recommendFromSeeds.mockResolvedValueOnce([makeSong('n1', { title: 'n1' })]).mockResolvedValueOnce([makeSong('n1', { title: 'n1' }), makeSong('n3', { title: 'n3' })]);
    mount(playlist);
    act(() => ioCallback?.([{ isIntersecting: true }]));
    await waitFor(() => expect(shownIds()).toEqual(['n1']));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh recommended songs' }));
    await waitFor(() => expect(shownIds()).toEqual(['n3']));
    const [firstSeeds] = recommendFromSeeds.mock.calls[0];
    const [secondSeeds, secondOpts] = recommendFromSeeds.mock.calls[1];
    expect(secondSeeds.map((s: Song) => s.id)).not.toEqual(firstSeeds.map((s: Song) => s.id));
    expect(secondOpts.exclude[0]).toBe('n1');
  });

  it('stays hidden and quiet while the playlist is being picked or searched, and keeps its list after', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const playlist = [makeSong('p1')];
    const ui = (hide: boolean) => (
      <QueryClientProvider client={qc}>
        <MemoryRouter><RecommendedSongs collectionId="c1" name="Road trip" songs={playlist} hidden={hide} /></MemoryRouter>
      </QueryClientProvider>
    );
    recommendFromSeeds.mockResolvedValue([makeSong('n1', { title: 'n1' })]);
    const r = render(ui(true));
    expect(ioCallback).toBeNull();
    expect(r.container.querySelector('section')?.hidden).toBe(true);
    r.rerender(ui(false));
    act(() => ioCallback?.([{ isIntersecting: true }]));
    await waitFor(() => expect(shownIds()).toEqual(['n1']));
    r.rerender(ui(true));
    r.rerender(ui(false));
    expect(shownIds()).toEqual(['n1']);
    expect(recommendFromSeeds).toHaveBeenCalledTimes(1);
  });

  it('says so when nothing comes back', async () => {
    recommendFromSeeds.mockResolvedValue([]);
    mount([makeSong('p1')]);
    act(() => ioCallback?.([{ isIntersecting: true }]));
    expect(await screen.findByText('No suggestions right now. Try Refresh.')).toBeTruthy();
  });
});
