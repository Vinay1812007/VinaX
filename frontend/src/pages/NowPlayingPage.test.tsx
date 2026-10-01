// @vitest-environment jsdom
/**
 * 9.0 "Encore" — the full-screen player's contracts: toggles say their state
 * (aria-pressed, the repeat-one marker), the panel tabs are a real tablist
 * driven by arrow keys, Up next says who queued each song in words, the
 * sleep timer's button names how long is left, lyrics have an empty state,
 * and the two "More options" buttons keep their order (the song menu first,
 * the playback options last — tutorials and e2e specs rely on it).
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/audio/engine', () => ({
  audioEngine: { load: vi.fn(), preloadNext: vi.fn(), pause: vi.fn(), play: vi.fn(), seek: vi.fn(), setOutputDevice: vi.fn(async () => true) },
  orderedSources: () => [],
}));
vi.mock('@/services/media-session', () => ({
  setMediaHandlers: vi.fn(), updateMediaMetadata: vi.fn(), updatePlaybackState: vi.fn(), updatePositionState: vi.fn(),
}));
vi.mock('@/services/native', () => ({ checkNotificationOnFirstPlay: vi.fn(), haptic: vi.fn(), isNativePlatform: () => false, platformName: () => 'web' }));
vi.mock('@/services/personalization/updater', () => ({
  recordComplete: vi.fn(), recordPlay: vi.fn(), recordQueueAdd: vi.fn(), recordSkip: vi.fn(), recordFavorite: vi.fn(), softMuteArtist: vi.fn(),
}));
vi.mock('@/utils/color', () => ({ extractAverageColor: vi.fn(async () => null), extractVibrantColor: vi.fn(async () => null), applyArtColor: vi.fn() }));
vi.mock('@/utils/wakeLock', () => ({ acquireWakeLock: vi.fn(async () => undefined), releaseWakeLock: vi.fn() }));
vi.mock('@/components/SongCanvas', () => ({
  useSongCanvas: () => ({ video: null, src: null, hasVideo: false, off: false, toggle: vi.fn(), markFailed: vi.fn() }),
  SongCanvas: () => <img alt="" className="vx-np-art-img" />,
  SongCanvasBackdrop: () => null,
}));
const lyricsHook = vi.fn((_song: unknown) => ({ data: null as unknown, isLoading: false }));
vi.mock('@/features/lyrics/useSyncedLyrics', () => ({ useSyncedLyrics: (song: unknown) => lyricsHook(song) }));

import { usePlayerStore } from '@/store/playerStore';
import { makeSong } from '@/__fixtures__/songs';
import NowPlayingPage from './NowPlayingPage';

const now = makeSong('now', { title: 'Neeli Megham' });
const listed = makeSong('a', { title: 'Alpha' });

const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/now-playing']}>
        <NowPlayingPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  lyricsHook.mockImplementation(() => ({ data: null, isLoading: false }));
  usePlayerStore.setState({ queue: [now, listed], index: 0, isPlaying: false, shuffle: false, repeat: 'off', sleepAt: null, sleepAfterTrack: false, sleepSongsLeft: 0 });
});
afterEach(cleanup);

// The first mount pulls the whole player (song menu, sheets) — give it room on a busy machine.
describe('NowPlayingPage', { timeout: 20_000 }, () => {
  it('names the song in a heading and says every toggle’s state in words', () => {
    usePlayerStore.setState({ shuffle: true, repeat: 'one' });
    mount();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Neeli Megham');
    expect(screen.getByRole('button', { name: 'Shuffle on' }).getAttribute('aria-pressed')).toBe('true');
    const repeat = screen.getByRole('button', { name: 'Repeat: one' });
    expect(repeat.getAttribute('aria-pressed')).toBe('true');
    expect(repeat.querySelector('.vx-np-repeat-one')?.textContent).toBe('1');
    expect(screen.getByRole('button', { name: 'Play' }).className).toContain('vx-np-play');
  });

  it('keeps the song menu first and the playback options last among the "More options" buttons', () => {
    mount();
    const exact = Array.from(document.querySelectorAll<HTMLButtonElement>('button[aria-label="More options"]'));
    expect(exact.length).toBe(2);
    expect(exact[0].getAttribute('aria-haspopup')).toBe('menu');
    fireEvent.click(exact[exact.length - 1]);
    const sheet = screen.getByRole('dialog', { name: 'Playback' });
    expect(within(sheet).getByText('Share this moment')).toBeTruthy();
    expect(within(sheet).getByRole('group', { name: 'Sleep timer' })).toBeTruthy();
  });

  it('panel tabs are a tablist: arrow keys move the selection and the focus', () => {
    mount();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Up next', 'Lyrics', 'Credits']);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs[0].getAttribute('aria-controls')).toBe('vx-np-panel-queue');
    expect(tabs[1].getAttribute('tabindex')).toBe('-1');
    tabs[0].focus();
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
    const lyricsTab = screen.getByRole('tab', { name: 'Lyrics' });
    expect(lyricsTab.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(lyricsTab);
    expect(screen.getByRole('tabpanel', { name: 'Lyrics' })).toBeTruthy();
    // No lyrics from any source: a calm empty state, not a blank panel.
    expect(screen.getByText('No lyrics for this song yet')).toBeTruthy();
    fireEvent.keyDown(lyricsTab, { key: 'End' });
    expect(screen.getByRole('tab', { name: 'Credits' }).getAttribute('aria-selected')).toBe('true');
  });

  it('Up next says who queued each song, in words', () => {
    const pick = makeSong('p1', { title: 'Pick one' });
    const mine = makeSong('hand', { title: 'Mine' });
    act(() => {
      usePlayerStore.getState().replaceAutoTail([pick]);
      usePlayerStore.getState().enqueue(mine);
    });
    mount();
    const panel = screen.getByRole('tabpanel', { name: 'Up next' });
    const rowFor = (title: string) => within(panel).getAllByRole('listitem').find((li) => li.textContent?.includes(title))!;
    expect(within(rowFor('Pick one')).getByText('VinaX pick')).toBeTruthy();
    expect(within(rowFor('Mine')).getByText('Added by you')).toBeTruthy();
    // The listener's own list carries no marker.
    expect(within(rowFor('Alpha')).queryByText('VinaX pick')).toBeNull();
    expect(within(rowFor('Alpha')).queryByText('Added by you')).toBeNull();
    expect(screen.getByRole('group', { name: 'Pin a mood' })).toBeTruthy();
  });

  it('the sleep timer button names how long is left, and opens its own sheet', () => {
    usePlayerStore.setState({ sleepSongsLeft: 3 });
    mount();
    const button = screen.getByRole('button', { name: 'Sleep timer: stops after 3 songs' });
    expect(button.className).toContain('is-on');
    fireEvent.click(button);
    const sheet = screen.getByRole('dialog', { name: 'Sleep timer' });
    expect(within(sheet).getByRole('status').textContent).toBe('Playback stops after 3 songs.');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel sleep timer' }));
    expect(usePlayerStore.getState().sleepSongsLeft).toBe(0);
  });

  it('synced lyrics land on the Lyrics tab by themselves', () => {
    lyricsHook.mockImplementation(() => ({ data: { synced: [{ t: 0, text: 'first line' }, { t: 4, text: 'second line' }], plain: null, source: 'upstream' }, isLoading: false }));
    mount();
    expect(screen.getByRole('tab', { name: 'Lyrics' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('second line')).toBeTruthy();
  });
});
