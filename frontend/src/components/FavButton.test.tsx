// @vitest-environment jsdom
/**
 * 10.1.0 — a like is confirmed by a snackbar carrying the song's cover:
 * "Added to Liked songs · View" and "Removed from Liked songs · Undo", where
 * Undo puts the song back (the library toggle is its own undo).
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Song } from '@/types';
// Liking a song fires telemetry and the adaptive re-plan as fire-and-forget
// dynamic imports (libraryStore.toggleFavorite). One started by the last
// assertion can still be loading when this file's environment is torn down,
// and vitest then fails the whole run with an EnvironmentTeardownError while
// every test passes — on a slow, cold CI runner only. Importing them here
// puts them in the module registry first, so those `import()`s resolve from
// cache instead of starting a load.
import '@/services/analytics/telemetry';
import '@/services/recommendation/adaptive';
import { useLibraryStore } from '@/store/libraryStore';
import { useToastStore } from '@/store/toastStore';
import { FavButton } from './FavButton';

const song = {
  kind: 'song',
  id: 'fav-1',
  title: 'Fav One',
  subtitle: 'Someone',
  artists: [{ id: 'a1', name: 'Someone' }],
  album: { id: 'al1', name: 'Album' },
  images: [{ quality: '50x50', url: 'https://img.example/50.jpg' }, { quality: '500x500', url: 'https://img.example/500.jpg' }],
  audio: [],
  duration: 200,
  language: 'telugu',
  year: '2020',
  explicit: false,
  hasLyrics: false,
  playCount: 0,
} as unknown as Song;

const last = () => useToastStore.getState().toasts.slice(-1)[0];

beforeEach(() => {
  act(() => {
    if (useLibraryStore.getState().isFavorite(song.id)) useLibraryStore.getState().toggleFavorite(song);
  });
});
afterEach(() => {
  act(() => {
    for (const t of useToastStore.getState().toasts) useToastStore.getState().dismiss(t.id);
  });
  cleanup();
});

describe('FavButton snackbar', () => {
  it('liking shows the cover with a View action; unliking offers Undo', () => {
    render(<FavButton song={song} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add to favorites' }));
    expect(useLibraryStore.getState().isFavorite(song.id)).toBe(true);
    expect(last()?.message).toBe('Added to Liked songs');
    expect(last()?.image).toBe('https://img.example/50.jpg');
    expect(last()?.action?.label).toBe('View');

    fireEvent.click(screen.getByRole('button', { name: 'Remove from favorites' }));
    expect(useLibraryStore.getState().isFavorite(song.id)).toBe(false);
    expect(last()?.message).toBe('Removed from Liked songs');
    expect(last()?.action?.label).toBe('Undo');

    act(() => last()?.action?.onClick());
    expect(useLibraryStore.getState().isFavorite(song.id)).toBe(true);
  });
});
