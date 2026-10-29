// @vitest-environment jsdom
/**
 * 8.2.0 — Home: the AI Radio shortcut, "Your playlists", "Your top genres",
 * the usage signal (taps per block) and the dynamic block order, which only
 * applies when nobody chose an order and never changes within a session.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

vi.mock('@/services/audio/engine', () => ({
  audioEngine: { load: vi.fn(), preloadNext: vi.fn(), pause: vi.fn(), play: vi.fn(), seek: vi.fn(), setVolume: vi.fn(), setMuted: vi.fn() },
  orderedSources: () => [],
}));
vi.mock('@/services/media-session', () => ({
  setMediaHandlers: vi.fn(), updateMediaMetadata: vi.fn(), updatePlaybackState: vi.fn(), updatePositionState: vi.fn(),
}));
vi.mock('@/services/native', () => ({ checkNotificationOnFirstPlay: vi.fn(), haptic: vi.fn(), isNativePlatform: () => false, platformName: () => 'web' }));
vi.mock('@/services/personalization/updater', () => ({
  recordComplete: vi.fn(), recordPlay: vi.fn(), recordQueueAdd: vi.fn(), recordSkip: vi.fn(), recordFavorite: vi.fn(), softMuteArtist: vi.fn(),
}));
vi.mock('@/services/downloads', () => ({ downloadSong: vi.fn(), removeDownload: vi.fn() }));
vi.mock('@/services/feedback', () => ({ sendFeedback: vi.fn(async () => true) }));
const searched: string[] = [];
// 1.3 — the catalogue's own feeds; they miss by default (the backup source does not know them).
const feeds = vi.hoisted(() => ({ charts: undefined as unknown, featured: undefined as unknown, newReleases: undefined as unknown }));
const answer = (v: unknown) => (v ? Promise.resolve(v) : Promise.reject(new Error('route not found')));
vi.mock('@/services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api')>();
  const { makeSong } = await import('@/__fixtures__/songs');
  const results = (q: string) => {
    searched.push(q);
    return [makeSong(`${q}-1`, { title: `${q} one` }), makeSong(`${q}-2`, { title: `${q} two` })];
  };
  return {
    ...actual,
    searchSongs: vi.fn(async (q: string) => results(q)),
    searchSongsPage: vi.fn(async (q: string) => results(q)),
    getCharts: vi.fn(() => answer(feeds.charts)),
    getFeaturedPlaylists: vi.fn(() => answer(feeds.featured)),
    getNewReleases: vi.fn(() => answer(feeds.newReleases)),
  };
});

import HomePage from './HomePage';
import { useLibraryStore } from '@/store/libraryStore';
import { useHistoryStore } from '@/store/historyStore';
import { useSettingsStore } from '@/store/settingsStore';
import { usePlayerStore } from '@/store/playerStore';
import { makeSong } from '@/__fixtures__/songs';
import { HOME_SIGNALS_KEY, loadHomeSignals } from '@/features/home/homeSignals';
import { resetSessionHomeOrder } from '@/features/home/homeOrder';
import { HOME_DESIGN_KEY } from '@/services/recommendation/homeDesign';

const renderHome = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/radio" element={<p>Radio page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};
const markers = () => Array.from(document.querySelectorAll('[data-home-block]')).map((m) => m.getAttribute('data-home-block')).filter(Boolean);
/** 9.0.0 — the wider catalogue waits behind "Show more for you". */
const openExplore = async () => {
  fireEvent.click(await screen.findByRole('button', { name: /Show more for you/ }));
  await act(async () => {});
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetSessionHomeOrder();
  searched.length = 0;
  feeds.charts = feeds.featured = feeds.newReleases = undefined;
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
  // Deferred Home blocks come into view at once; the endless feed's sentinel never does.
  vi.stubGlobal('IntersectionObserver', class {
    constructor(private cb: (e: Array<{ isIntersecting: boolean }>) => void) {}
    observe(el: Element) {
      if (el.classList.contains('h-56')) queueMicrotask(() => this.cb([{ isIntersecting: true }]));
    }
    unobserve() {}
    disconnect() {}
  });
  useSettingsStore.setState({ pinnedLanguages: ['telugu'], djTakeover: false, autoplay: true });
  useLibraryStore.setState({ favorites: [], collections: [], saved: [] });
  useHistoryStore.setState({ entries: [] });
  usePlayerStore.setState({ queue: [], index: 0, isPlaying: false });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('HomePage 8.2', () => {
  it('always offers AI Radio as the first shortcut, even to a brand-new listener', async () => {
    renderHome();
    const shortcuts = await screen.findByRole('group', { name: 'Shortcuts' });
    const first = within(shortcuts).getAllByRole('button')[0];
    expect(first.textContent).toBe('AI Radio');
    fireEvent.click(first);
    expect(await screen.findByText('Radio page')).toBeTruthy();
  });

  it('shows "Your playlists" with the listener\'s own and saved playlists, and hides it when there are none', async () => {
    const { unmount } = renderHome();
    await screen.findByRole('group', { name: 'Shortcuts' });
    expect(screen.queryByRole('heading', { name: 'Your playlists' })).toBeNull();
    unmount();
    useLibraryStore.setState({
      collections: [{ id: 'c1', name: 'Road trip', createdAt: 1, songs: [makeSong('r1')] }],
      saved: [{ id: 'p1', kind: 'playlist', title: 'Telugu top 50', subtitle: '', image: null, savedAt: 2 }],
    });
    renderHome();
    expect(await screen.findByRole('heading', { name: 'Your playlists' })).toBeTruthy();
    expect(screen.getByText('Road trip')).toBeTruthy();
    expect(screen.getByText('Telugu top 50')).toBeTruthy();
  });

  it('builds "Your top genres" from what the listener likes, with a short query in their language', async () => {
    const melodies = ['a', 'b', 'c'].map((id) => makeSong(`m${id}`, { title: `Melody ${id}` }));
    useLibraryStore.setState({ favorites: melodies });
    renderHome();
    await openExplore();
    expect(await screen.findByRole('heading', { name: 'Your top genres · Melody' })).toBeTruthy();
    expect(searched).toContain('telugu melody songs');
  });

  it('records which block a tap landed in', async () => {
    renderHome();
    const shortcuts = await screen.findByRole('group', { name: 'Shortcuts' });
    fireEvent.click(within(shortcuts).getAllByRole('button')[0]);
    expect(loadHomeSignals().taps.quick?.s).toBe(1);
  });

  it('orders blocks by the listener\'s signals when nobody chose an order, and keeps that order for the session', async () => {
    const now = Date.now();
    localStorage.setItem(HOME_SIGNALS_KEY, JSON.stringify({ v: 1, taps: { loved: { s: 20, t: now } }, outcomes: { discovery: { done: { s: 0, t: now }, skipped: { s: 9, t: now } } } }));
    const { unmount } = renderHome();
    await screen.findByRole('group', { name: 'Shortcuts' });
    await openExplore();
    const order = markers();
    expect(order[0]).toBe('quick');
    expect(order[order.length - 1]).toBe('feed');
    expect(order.indexOf('loved')).toBeLessThan(11);
    expect(order.indexOf('discovery')).toBeGreaterThan(3);
    unmount();
    // New signals mid-session change nothing until the next session.
    localStorage.setItem(HOME_SIGNALS_KEY, JSON.stringify({ v: 1, taps: { albums: { s: 50, t: now } }, outcomes: {} }));
    renderHome();
    await screen.findByRole('group', { name: 'Shortcuts' });
    // The open Explore band is remembered for the session.
    await act(async () => {});
    expect(markers()).toEqual(order);
  });

  it('keeps the listener\'s Home Studio order exactly', async () => {
    localStorage.setItem(HOME_SIGNALS_KEY, JSON.stringify({ v: 1, taps: { loved: { s: 20, t: Date.now() } }, outcomes: {} }));
    const chosen = ['quick', 'charts', 'personal', 'aihome', 'discovery', 'seasonal', 'moods', 'genres', 'artists', 'albums', 'daypicks', 'loved', 'feed'];
    localStorage.setItem(HOME_DESIGN_KEY, JSON.stringify({ title: 'Mine', description: 'd', order: chosen, hidden: [] }));
    renderHome();
    await screen.findByRole('group', { name: 'Shortcuts' });
    await openExplore();
    expect(markers()).toEqual(chosen);
  });
});

describe('HomePage 9.0', () => {
  it('shows the first four blocks; the wider catalogue mounts (and fetches) only behind "Show more for you"', async () => {
    useLibraryStore.setState({ favorites: ['a', 'b', 'c'].map((id) => makeSong(`m${id}`, { title: `Melody ${id}` })) });
    renderHome();
    await screen.findByRole('group', { name: 'Shortcuts' });
    await act(async () => {});
    expect(markers()).toHaveLength(4);
    expect(markers()[0]).toBe('quick');
    expect(markers()).not.toContain('genres');
    expect(searched).not.toContain('telugu melody songs'); // the genres block has not mounted
    await openExplore();
    expect(markers()).toHaveLength(13);
    expect(sessionStorage.getItem('vinax.home.open.explore')).toBe('1');
  });

  it('a song hidden from a menu leaves every Home shelf at once (no refetch)', async () => {
    const recent = ['x', 'y', 'z'].map((id) => makeSong(`h${id}`, { title: `Recent ${id}`, artist: `Singer ${id}` }));
    useHistoryStore.setState({ entries: recent.map((song, i) => ({ song, ts: Date.now() - i * 60_000, completed: true })) });
    renderHome();
    const shelf = await screen.findByRole('heading', { name: 'Continue listening' });
    expect(shelf).toBeTruthy();
    expect(screen.getAllByText('Recent y').length).toBeGreaterThan(0);
    act(() => useLibraryStore.getState().toggleHidden('hy'));
    expect(screen.queryAllByText('Recent y')).toHaveLength(0);
  });
});

describe('HomePage 10.0 — the first visit', () => {
  it('a listener with nothing played sees the free welcome, and "Start listening" plays the opening mix', async () => {
    const realPlayQueue = usePlayerStore.getState().playQueue;
    const playQueue = vi.fn();
    usePlayerStore.setState({ playQueue });
    onTestFinished(() => usePlayerStore.setState({ playQueue: realPlayQueue }));
    renderHome();
    expect(await screen.findByRole('heading', { level: 1, name: /All the music you love\. Free\./ })).toBeTruthy();
    expect(screen.getByText(/Nothing to pay\./)).toBeTruthy();
    // The six feature tiles link to real destinations.
    const tiles = within(screen.getByRole('region', { name: 'Everything included, all free' })).getAllByRole('link');
    expect(tiles.map((a) => a.getAttribute('href'))).toEqual(['/VinaXAI', '/radio', '/together', '/karaoke', '/download', '/languages']);
    // The Aura Mix stays (the guided tour points at its play button).
    const auraPlay = screen.getByRole('button', { name: /^Play your \w+ Mix$/ }) as HTMLButtonElement;
    // Wait for the opening mix, then start it from the welcome.
    await vi.waitFor(() => expect(auraPlay.disabled).toBe(false), { timeout: 5000 });
    fireEvent.click(screen.getByRole('button', { name: /Start listening/ }));
    expect(playQueue).toHaveBeenCalledTimes(1);
    const [queue, index] = playQueue.mock.calls[0] as [unknown[], number];
    expect(queue.length).toBeGreaterThan(0);
    expect(index).toBe(0);
  });

  it('a returning listener gets the short greeting and no welcome', async () => {
    const recent = ['p', 'q'].map((id) => makeSong(`r${id}`));
    useHistoryStore.setState({ entries: recent.map((song, i) => ({ song, ts: Date.now() - i * 60_000, completed: true })) });
    renderHome();
    await screen.findByRole('group', { name: 'Shortcuts' });
    expect(screen.queryByRole('heading', { name: /All the music you love/ })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Everything included, all free' })).toBeNull();
    expect(screen.getByRole('heading', { level: 1 }).textContent).not.toMatch(/Free/);
  });
});

describe('HomePage 1.3 — the catalogue’s own feeds', () => {
  const playlist = (id: string, title: string) => ({ kind: 'playlist', id, title, subtitle: 'JioSaavn', images: [], songs: [], songCount: null, language: 'telugu' });

  it('adds "Top charts", "Featured playlists" and "New albums" when the catalogue has them', async () => {
    feeds.charts = [playlist('110858205', 'Trending Today')];
    feeds.featured = [playlist('4562515', 'Karwa Chauth Special')];
    feeds.newReleases = { songs: [], albums: [{ kind: 'album', id: '82567150', title: 'Rangulu Ranguley', subtitle: 'A.R. Rahman', images: [], artists: [], songs: [], songCount: 1, year: '2026', language: 'telugu' }] };
    renderHome();
    await screen.findByRole('group', { name: 'Shortcuts' });
    await openExplore();
    expect(await screen.findByRole('heading', { name: 'Top charts' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Featured playlists' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'New albums' })).toBeTruthy();
    expect(screen.getByText('Trending Today').closest('a')?.getAttribute('href')).toBe('/playlist/trending-today-110858205');
    expect(screen.getByText('Rangulu Ranguley').closest('a')?.getAttribute('href')).toBe('/album/rangulu-ranguley-82567150');
  });

  it('hides those shelves entirely, with no error, when the catalogue misses', async () => {
    renderHome();
    await screen.findByRole('group', { name: 'Shortcuts' });
    await openExplore();
    expect(await screen.findByRole('heading', { name: 'Charts' })).toBeTruthy();
    await act(async () => {});
    expect(screen.queryByRole('heading', { name: 'Top charts' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Featured playlists' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'New albums' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
