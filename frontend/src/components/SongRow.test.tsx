// @vitest-environment jsdom
/**
 * Song rows: keyboard contract (Enter on the heart must never ALSO play the
 * row), aria-current on the playing row, and the render budget that makes
 * long lists affordable.
 */
import { Profiler } from 'react';
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
  recordComplete: vi.fn(), recordPlay: vi.fn(), recordQueueAdd: vi.fn(), recordSkip: vi.fn(), recordFavorite: vi.fn(), softMuteArtist: vi.fn(),
}));
vi.mock('@/services/analytics/telemetry', () => ({ trackFavorite: vi.fn() }));

import { usePlayerStore } from '@/store/playerStore';
import { useLibraryStore } from '@/store/libraryStore';
import { makeSong } from '@/__fixtures__/songs';
import { SongRow } from './SongRow';

const songs = [makeSong('a'), makeSong('b'), makeSong('c')];
const playQueue = vi.fn();

beforeEach(() => {
  playQueue.mockReset();
  usePlayerStore.setState({ queue: [], index: 0, isPlaying: false, currentTime: 0, duration: 0, playQueue });
  useLibraryStore.setState({ favorites: [] });
});
afterEach(cleanup);

const renderRow = (i = 0) =>
  render(
    <MemoryRouter>
      <SongRow song={songs[i]} songs={songs} index={i} />
    </MemoryRouter>,
  );

describe('<SongRow /> keyboard + semantics', () => {
  it('the play target is a real button that plays the list from this row', () => {
    renderRow(1);
    const play = screen.getByRole('button', { name: /^Play Song b/ });
    expect(play.tagName).toBe('BUTTON');
    fireEvent.click(play);
    expect(playQueue).toHaveBeenCalledTimes(1);
    expect(playQueue).toHaveBeenCalledWith(songs, 1);
  });

  it('Enter / Space / click on the nested favourite button never starts playback', () => {
    renderRow();
    const heart = screen.getByRole('button', { name: 'Add to favorites' });
    // The heart must not live inside the play button (nested interactive content).
    expect(heart.closest('.vx-track-play')).toBeNull();
    heart.focus();
    fireEvent.keyDown(heart, { key: 'Enter' });
    fireEvent.keyUp(heart, { key: 'Enter' });
    fireEvent.keyDown(heart, { key: ' ' });
    fireEvent.keyUp(heart, { key: ' ' });
    fireEvent.click(heart);
    expect(playQueue).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Remove from favorites' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('Enter on the menu trigger opens the menu and does not play', () => {
    renderRow();
    const trigger = screen.getByRole('button', { name: 'More options' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(screen.getAllByRole('menuitem')[0], { key: 'Enter' });
    expect(playQueue).not.toHaveBeenCalled();
  });

  it('marks only the current song with aria-current', () => {
    usePlayerStore.setState({ queue: songs, index: 1 });
    render(
      <MemoryRouter>
        {songs.map((s, i) => <SongRow key={s.id} song={s} songs={songs} index={i} />)}
      </MemoryRouter>,
    );
    const current = document.querySelectorAll('[aria-current="true"]');
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toContain('Song b');
  });
});

describe('<SongRow /> render budget', () => {
  it('only the rows whose state flips re-render on track change, play/pause and clock ticks', () => {
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
    usePlayerStore.setState({ queue: songs, index: 0, isPlaying: true });
    render(
      <MemoryRouter>
        {songs.map((s, i) => (
          <Profiler key={s.id} id={s.id} onRender={(id) => { counts[id] += 1; }}>
            <SongRow song={s} songs={songs} index={i} />
          </Profiler>
        ))}
      </MemoryRouter>,
    );
    const reset = () => { counts.a = 0; counts.b = 0; counts.c = 0; };

    reset();
    for (const t of [0.25, 0.5, 0.75]) act(() => usePlayerStore.setState({ currentTime: t }));
    expect(counts).toEqual({ a: 0, b: 0, c: 0 });

    reset();
    act(() => usePlayerStore.setState({ isPlaying: false }));
    expect(counts).toEqual({ a: 1, b: 0, c: 0 });

    reset();
    act(() => usePlayerStore.setState({ index: 1 }));
    expect(counts.c).toBe(0);
    expect(counts.a).toBe(1);
    expect(counts.b).toBe(1);

    reset();
    act(() => useLibraryStore.getState().toggleFavorite(songs[2]));
    expect(counts).toEqual({ a: 0, b: 0, c: 1 });
  });
});
