// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HistoryEntry, Song } from '@/types';
import { KEYS } from '@/constants/storage-keys';
import { useHistoryStore } from '@/store/historyStore';
import { useLibraryStore } from '@/store/libraryStore';
import { BADGES } from './catalog';
import { BadgesSection } from './BadgesSection';

const song = (id: string): Song =>
  ({ kind: 'song', id, title: id, subtitle: 'Anirudh', artists: [{ id: 'an', name: 'Anirudh' }], album: { id: 'a', name: 'A' }, images: [], audio: [], duration: 240, language: 'telugu', year: '2020', explicit: false, hasLyrics: false, playCount: 0 }) as unknown as Song;
const entry = (id: string, ts: number): HistoryEntry => ({ song: song(id), ts, completed: true, listenedSec: 240 });

describe('1.12 — the Badges section', () => {
  beforeEach(() => {
    localStorage.clear();
    useHistoryStore.setState({ entries: [entry('a', Date.now() - 60_000)] });
    useLibraryStore.setState({ favorites: [] } as never);
  });
  afterEach(cleanup);

  it('shows every badge, the earned ones first, and a detail with Share on tap', () => {
    render(<MemoryRouter><BadgesSection /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Badges' })).toBeTruthy();
    expect(screen.getByText(/1 of \d+ earned/)).toBeTruthy();
    const tiles = screen.getAllByRole('button', { pressed: false });
    expect(tiles).toHaveLength(BADGES.length);
    // The first play earned "First note" (saved in the ledger) and sorts first.
    expect(tiles[0].getAttribute('aria-label')).toMatch(/^First note, earned/);
    expect(tiles[0].className).not.toContain('is-locked');
    expect(tiles[1].className).toContain('is-locked');
    expect(JSON.parse(localStorage.getItem(KEYS.badges) ?? '{}').earned['first-note']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    fireEvent.click(tiles[0]);
    expect(screen.getByRole('region', { name: 'First note details' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Share/ })).toBeTruthy();
    // A locked badge says how far along it is, with no Share.
    fireEvent.click(screen.getByRole('button', { name: /^Century,/ }));
    expect(screen.getByText(/1 of 100 plays so far/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Share/ })).toBeNull();
  });
});
