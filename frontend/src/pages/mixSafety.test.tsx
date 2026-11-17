// @vitest-environment jsdom
/**
 * Your Week, Made for you and Mixes come out of caches (the week until
 * Monday, mixes for up to 30 minutes), so each page filters its songs with
 * the listener's CURRENT safety settings (useShelfSafety) when it renders,
 * and Play, Shuffle and Save use that same filtered list.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';
import { makeSong } from '@/__fixtures__/songs';

const { playQueue, addToCollection } = vi.hoisted(() => ({ playQueue: vi.fn(), addToCollection: vi.fn() }));
let hidden = new Set<string>();
let weekly: Song[] = [];
let mixes: Array<{ id: string; title: string; explanation: string; songs: Song[] }> = [];

vi.mock('@/features/home/useShelfSafety', () => ({ useShelfSafety: () => (s: Song) => !hidden.has(s.id) }));
vi.mock('@/features/weekly/useWeeklyMix', () => ({
  useWeeklyMix: () => ({ data: weekly, isLoading: false, isError: false, refetch: vi.fn() }),
  isoWeekKey: () => '2026-W47',
}));
vi.mock('@/features/recommendations/useRecommendations', () => ({
  useRecommendations: () => ({ data: mixes, isLoading: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/store/playerStore', () => {
  const state = { playQueue, shuffle: false, toggleShuffle: vi.fn() };
  const usePlayerStore = Object.assign((sel: (s: typeof state) => unknown) => sel(state), { getState: () => state });
  return { usePlayerStore };
});
vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: { getState: () => ({ createCollection: () => 'c1', addToCollection }) },
}));
vi.mock('@/store/toastStore', () => ({ toast: vi.fn() }));
vi.mock('@/components/SongRow', () => ({
  SongRow: ({ song, songs }: { song: Song; songs: Song[] }) => <div data-testid="row" data-list={songs.map((s) => s.id).join(',')}>{song.title}</div>,
  TrackListHead: () => null,
}));
vi.mock('@/components/MediaCard', () => ({
  MediaCard: ({ title, onPlay }: { title: string; onPlay: () => void }) => <button type="button" onClick={onPlay}>{title}</button>,
}));
vi.mock('@/components/Shelf', () => ({
  Shelf: ({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) => <section aria-label={title}>{action}{children}</section>,
}));
vi.mock('@/features/library/CollageCover', () => ({ CollageCover: () => null, collageArt: () => [] }));

import WeeklyMixPage from './WeeklyMixPage';
import MadeForYouPage from './MadeForYouPage';
import MixesPage from './MixesPage';

const mount = (el: ReactNode) => render(<MemoryRouter>{el}</MemoryRouter>);
const ids = (list: Song[]) => list.map((s) => s.id);

beforeEach(() => {
  playQueue.mockReset();
  addToCollection.mockReset();
  hidden = new Set(['b']);
  weekly = [makeSong('a', { title: 'Alpha' }), makeSong('b', { title: 'Bravo' }), makeSong('c', { title: 'Charlie' })];
  mixes = [
    { id: 'm1', title: 'Mix one', explanation: '', songs: [makeSong('a', { title: 'Alpha' }), makeSong('b', { title: 'Bravo' })] },
    { id: 'm2', title: 'Mix two', explanation: '', songs: [makeSong('b', { title: 'Bravo' })] },
  ];
});
afterEach(cleanup);

describe('Your Week', () => {
  it('hides a song the listener has since hidden, and plays and saves the filtered list', () => {
    mount(<WeeklyMixPage />);
    expect(screen.queryByText('Bravo')).toBeNull();
    expect(screen.getAllByTestId('row').map((r) => r.textContent)).toEqual(['Alpha', 'Charlie']);
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(ids(playQueue.mock.calls[0][0] as Song[])).toEqual(['a', 'c']);
    fireEvent.click(screen.getByRole('button', { name: 'Save as playlist' }));
    expect(addToCollection.mock.calls.map((c) => (c[1] as Song).id)).toEqual(['a', 'c']);
  });

  it('shows the empty state when nothing in the week is allowed any more', () => {
    hidden = new Set(['a', 'b', 'c']);
    mount(<WeeklyMixPage />);
    expect(screen.getByText('Building your week')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Play' })).toBeNull();
  });
});

describe('Made for you', () => {
  it('filters each mix, drops a mix left empty, and Play all plays the filtered songs', () => {
    mount(<MadeForYouPage />);
    expect(screen.queryByText('Bravo')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Mix two' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Play all/ }));
    expect(ids(playQueue.mock.calls[0][0] as Song[])).toEqual(['a']);
  });
});

describe('Mixes', () => {
  it('filters each mix the same way', () => {
    mount(<MixesPage />);
    expect(screen.queryByText('Bravo')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Mix two' })).toBeNull();
    expect(screen.getAllByTestId('row').map((r) => r.dataset.list)).toEqual(['a']);
    fireEvent.click(screen.getByRole('button', { name: /Play all/ }));
    expect(ids(playQueue.mock.calls[0][0] as Song[])).toEqual(['a']);
  });
});
