// @vitest-environment jsdom
/**
 * Import cancellation — a lookup that finishes AFTER Cancel / backdrop /
 * unmount must not create a collection or replace the queue.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';

vi.mock('@/services/personalization/updater', () => ({ recordFavorite: () => undefined }));

const song = (id: string, title: string, artist: string): Song => ({
  kind: 'song', id, title, subtitle: artist, artists: [{ id: `a-${artist}`, name: artist }], album: null,
  images: [], audio: [], duration: 200, language: 'telugu', year: '2022', explicit: false, hasLyrics: false, playCount: null,
});

// Each search resolves only when the test says so, so a late result can be simulated.
type Pending = { resolve: (songs: Song[]) => void; reject: (e: unknown) => void; signal?: AbortSignal };
let pending: Pending[] = [];
vi.mock('@/services/api', () => ({
  searchSongs: (_q: string, _n: number, opts?: { signal?: AbortSignal }) =>
    new Promise<Song[]>((resolve, reject) => {
      const p: Pending = { resolve, reject, signal: opts?.signal };
      opts?.signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')));
      pending.push(p);
    }),
}));

const playQueue = vi.fn();
vi.mock('@/store/playerStore', () => ({
  usePlayerStore: (sel: (s: { playQueue: typeof playQueue }) => unknown) => sel({ playQueue }),
}));

import { ImportPlaylistSheet } from './ImportPlaylistSheet';
import { useLibraryStore } from '@/store/libraryStore';

function mount(onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: 0 } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <ImportPlaylistSheet onClose={onClose} />
    </QueryClientProvider>,
  );
  return { ...utils, onClose };
}

const collections = () => useLibraryStore.getState().collections;

beforeEach(() => {
  pending = [];
  playQueue.mockClear();
  useLibraryStore.setState({ favorites: [], collections: [], saved: [], hiddenSongIds: [], later: [], hiddenArtists: [], trash: [] });
});
afterEach(cleanup);

async function startImport() {
  fireEvent.change(screen.getByLabelText('Songs, one per line'), { target: { value: 'Srivalli — Sid Sriram\nNaatu Naatu — Rahul Sipligunj' } });
  fireEvent.click(screen.getByRole('button', { name: 'Find songs' }));
  await act(async () => {
    await Promise.resolve();
  });
  expect(pending.length).toBeGreaterThan(0);
}

describe('ImportPlaylistSheet cancellation', () => {
  it('Cancel during lookup aborts the requests and a late result creates nothing', async () => {
    const { onClose } = mount();
    await startImport();
    expect(screen.getByRole('status').textContent).toContain('Finding 0 of 2');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel import' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(pending.every((p) => p.signal?.aborted)).toBe(true);
    // A provider that ignores abort and answers anyway must still be ignored.
    await act(async () => {
      for (const p of pending) p.resolve([song('1', 'Srivalli', 'Sid Sriram')]);
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(collections()).toEqual([]);
    expect(playQueue).not.toHaveBeenCalled();
  });

  it('backdrop dismissal cancels too', async () => {
    const { onClose } = mount();
    await startImport();
    // The sheet renders through a body portal; the backdrop is the dialog's parent.
    fireEvent.click(screen.getByRole('dialog').parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalled();
    expect(pending.every((p) => p.signal?.aborted)).toBe(true);
  });

  it('unmount (navigation) aborts in-flight lookups', async () => {
    const { unmount } = mount();
    await startImport();
    unmount();
    expect(pending.every((p) => p.signal?.aborted)).toBe(true);
    await act(async () => {
      for (const p of pending) p.resolve([song('1', 'Srivalli', 'Sid Sriram')]);
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(collections()).toEqual([]);
  });

  it('an uncancelled run shows a review, and saving commits only the chosen matches', async () => {
    const { onClose } = mount();
    await startImport();
    await act(async () => {
      // First search (title + artist) for each line answers: an exact match, and an unrelated song.
      pending[0].resolve([song('1', 'Srivalli', 'Sid Sriram')]);
      pending[1].resolve([song('9', 'Something Else', 'Nobody')]);
      await new Promise((r) => setTimeout(r, 0));
    });
    // The unrelated one triggers a title-only fallback search — answer it with nothing.
    await act(async () => {
      for (const p of pending.slice(2)) p.resolve([]);
      await new Promise((r) => setTimeout(r, 0));
    });
    // Nothing is saved yet: the review is on screen.
    expect(collections()).toEqual([]);
    expect(screen.getByText(/1 matched · 0 closest matches · 1 not found/)).toBeTruthy();
    expect(screen.getByText('Matched')).toBeTruthy();
    expect(screen.getByText('Not found')).toBeTruthy();
    // The original pasted line is available on demand.
    fireEvent.click(screen.getAllByRole('button', { name: 'Original' })[1]);
    expect(screen.getByText('Naatu Naatu — Rahul Sipligunj')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save & play' }));
    expect(collections()).toHaveLength(1);
    expect(collections()[0].songs.map((s) => s.id)).toEqual(['1']);
    expect(playQueue).toHaveBeenCalledWith([expect.objectContaining({ id: '1' })], 0);
    expect(onClose).toHaveBeenCalled();
  });

  it('a closest match is labelled, can be skipped, and skipping keeps it out of the save', async () => {
    mount();
    await startImport();
    await act(async () => {
      pending[0].resolve([song('1', 'Srivalli', 'Javed Ali')]); // same title, different artist → uncertain
      pending[1].resolve([song('2', 'Naatu Naatu', 'Rahul Sipligunj')]);
      await new Promise((r) => setTimeout(r, 0));
    });
    await act(async () => {
      for (const p of pending.slice(2)) p.resolve([]);
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.getByText('Closest match')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Include Srivalli'));
    expect(screen.getByText('1 of 2 will be saved')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save 1 song' }));
    expect(collections()[0].songs.map((s) => s.id)).toEqual(['2']);
  });

  it('retry re-queries with an edited line and swaps in the new result', async () => {
    mount();
    await startImport();
    await act(async () => {
      pending[0].resolve([song('1', 'Srivalli', 'Sid Sriram')]);
      pending[1].resolve([]);
      await new Promise((r) => setTimeout(r, 0));
    });
    await act(async () => {
      for (const p of pending.slice(2)) p.resolve([]);
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.getByText('Not found')).toBeTruthy();
    const before = pending.length;
    fireEvent.change(screen.getByLabelText('Edit the search for Naatu Naatu'), { target: { value: 'Naatu Naatu — Kaala Bhairava' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[1]);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(pending.length).toBeGreaterThan(before);
    await act(async () => {
      for (const p of pending.slice(before)) p.resolve([song('7', 'Naatu Naatu', 'Kaala Bhairava, Rahul Sipligunj')]);
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.queryByText('Not found')).toBeNull();
    expect(screen.getByText('2 of 2 will be saved')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save 2 songs' }));
    expect(collections()[0].songs.map((s) => s.id)).toEqual(['1', '7']);
  });

  it('inputs are labelled and progress is announced', async () => {
    mount();
    expect(screen.getByLabelText('Playlist name (optional)').tagName).toBe('INPUT');
    expect(screen.getByLabelText('Songs, one per line').tagName).toBe('TEXTAREA');
    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite');
  });
});
