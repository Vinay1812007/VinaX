// @vitest-environment jsdom
/**
 * 1.3 — one podcast. Pins: the header (name, hosts linking to their artist
 * pages, followers, description); the latest season opens first and the
 * season picker switches it; each episode shows its number, date, length
 * and summary; a tap plays the listed episodes from that one and "Play all"
 * from the top; episodes page in with "Load more" until the season's count;
 * loading, error-with-retry and empty states.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Podcast } from '@/services/api';
import type { Episode } from '@/features/podcasts/api';
import { makeSong } from '@/__fixtures__/songs';

const getPodcast = vi.fn<(id: string, season?: number | null, opts?: unknown) => Promise<Podcast>>();
const getEpisodePage = vi.fn<(id: string, q: { season?: number | null; page?: number; limit?: number }) => Promise<Episode[]>>();
const playQueue = vi.fn();
const enqueueAll = vi.fn();
const player = { queue: [] as unknown[], index: 0, isPlaying: false, playQueue, enqueueAll };

vi.mock('@/services/api', () => ({ getPodcast: (id: string, s?: number | null, o?: unknown) => getPodcast(id, s, o) }));
vi.mock('@/features/podcasts/api', () => ({ getEpisodePage: (id: string, q: never) => getEpisodePage(id, q) }));
vi.mock('@/store/playerStore', () => {
  const usePlayerStore = (sel: (s: typeof player) => unknown) => sel(player);
  usePlayerStore.getState = () => player;
  return { usePlayerStore };
});
vi.mock('@/components/TrackMenu', () => ({ TrackMenu: () => null }));
vi.mock('@/utils/color', () => ({ extractVibrantColor: () => Promise.resolve(null) }));

import PodcastPage from './PodcastPage';

const podcast = (over: Partial<Podcast> = {}): Podcast => ({
  id: '62',
  name: 'Talking Music',
  description: 'Hear the stories behind their music.',
  language: 'hindi',
  hosts: [{ id: '2673255', name: 'Kirthi Shetty' }],
  followerCount: 166341,
  images: [],
  seasons: [
    { id: '81', name: 'Season 1', number: 1, episodeCount: 11 },
    { id: '105', name: 'Season 2', number: 2, episodeCount: 11 },
    { id: '1365', name: 'Season 3', number: 3, episodeCount: 22 },
  ],
  episodes: [],
  ...over,
});
const ep = (id: string, over: Partial<Episode> = {}): Episode => ({
  song: makeSong(id, { title: `Episode ${id}`, duration: 1716, audio: [{ quality: 'original', url: `https://x/${id}.mp3` }] }),
  description: `About ${id}.`,
  releaseDate: '2017-10-11',
  number: 1,
  ...over,
});
const eps = (from: number, n: number) => Array.from({ length: n }, (_, i) => ep(`e${from + i}`, { number: from + i }));

function mount(path = '/podcast/talking-music-62') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/podcast/:id" element={<PodcastPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getPodcast.mockReset();
  getEpisodePage.mockReset();
  playQueue.mockReset();
  enqueueAll.mockReset();
});
afterEach(cleanup);

describe('PodcastPage', () => {
  it('shows the header and opens on the latest season', async () => {
    getPodcast.mockResolvedValue(podcast());
    getEpisodePage.mockResolvedValue([ep('a', { number: 39 })]);
    mount();
    expect(await screen.findByRole('heading', { name: 'Talking Music' })).toBeTruthy();
    expect(getPodcast).toHaveBeenCalledWith('62', null, expect.anything());
    expect(screen.getByRole('link', { name: 'Kirthi Shetty' }).getAttribute('href')).toBe('/artist/kirthi-shetty-2673255');
    expect(screen.getByText('1.7L followers')).toBeTruthy();
    expect(screen.getByText('Hear the stories behind their music.')).toBeTruthy();
    expect(screen.getByText('22 episodes')).toBeTruthy();
    expect(await screen.findByText('Episode a')).toBeTruthy();
    expect(getEpisodePage).toHaveBeenCalledWith('62', { season: 3, page: 1, limit: 20 });
    expect(screen.getByRole('button', { name: 'Season 3' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Episode 39 · 11 Oct 2017 · 29 min')).toBeTruthy();
    expect(screen.getByText('About a.')).toBeTruthy();
  });

  it('switches seasons', async () => {
    getPodcast.mockResolvedValue(podcast());
    getEpisodePage.mockImplementation(async (_id, q) => [ep(`s${q.season}`)]);
    mount();
    expect(await screen.findByText('Episode s3')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Season 1' }));
    expect(await screen.findByText('Episode s1')).toBeTruthy();
    expect(screen.queryByText('Episode s3')).toBeNull();
    expect(getEpisodePage).toHaveBeenLastCalledWith('62', { season: 1, page: 1, limit: 20 });
    expect(screen.getByText('11 episodes')).toBeTruthy();
  });

  it('has no season picker for a one-season show', async () => {
    getPodcast.mockResolvedValue(podcast({ seasons: [{ id: '1', name: 'Season 1', number: 1, episodeCount: 2 }] }));
    getEpisodePage.mockResolvedValue([ep('a')]);
    mount();
    expect(await screen.findByText('Episode a')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Season' })).toBeNull();
  });

  it('plays from the tapped episode, and Play all from the top', async () => {
    getPodcast.mockResolvedValue(podcast());
    const list = [ep('a'), ep('b'), ep('c')];
    getEpisodePage.mockResolvedValue(list);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Play Episode b' }));
    expect(playQueue).toHaveBeenLastCalledWith(list.map((e) => e.song), 1);
    fireEvent.click(screen.getByRole('button', { name: 'Play all' }));
    expect(playQueue).toHaveBeenLastCalledWith(list.map((e) => e.song), 0);
  });

  it('loads more episodes until the season’s count', async () => {
    getPodcast.mockResolvedValue(podcast());
    getEpisodePage.mockImplementation(async (_id, q) => (q.page === 1 ? eps(1, 20) : eps(21, 2)));
    mount();
    expect(await screen.findByText('Episode e20')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Load more episodes' }));
    expect(await screen.findByText('Episode e22')).toBeTruthy();
    expect(getEpisodePage).toHaveBeenLastCalledWith('62', { season: 3, page: 2, limit: 20 });
    expect(screen.queryByRole('button', { name: 'Load more episodes' })).toBeNull();
    // A tap on a later episode queues everything listed.
    fireEvent.click(screen.getByRole('button', { name: 'Play Episode e21' }));
    expect(playQueue.mock.calls[0][0]).toHaveLength(22);
    expect(playQueue.mock.calls[0][1]).toBe(20);
  });

  it('stops at a full page when the season count says that was all', async () => {
    getPodcast.mockResolvedValue(podcast({ seasons: [{ id: '1', name: 'Season 1', number: 1, episodeCount: 20 }] }));
    getEpisodePage.mockResolvedValue(eps(1, 20));
    mount();
    expect(await screen.findByText('Episode e20')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Load more episodes' })).toBeNull();
  });

  it('says so when the podcast cannot load and retries', async () => {
    getPodcast.mockRejectedValueOnce(new Error('down'));
    mount();
    expect(await screen.findByText('Couldn’t load this podcast')).toBeTruthy();
    getPodcast.mockResolvedValueOnce(podcast());
    getEpisodePage.mockResolvedValue([ep('a')]);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Episode a')).toBeTruthy();
  });

  it('keeps the header when the episodes fail, with a retry', async () => {
    getPodcast.mockResolvedValue(podcast());
    getEpisodePage.mockRejectedValueOnce(new Error('down'));
    mount();
    expect(await screen.findByText('Couldn’t load the episodes.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Talking Music' })).toBeTruthy();
    getEpisodePage.mockResolvedValueOnce([ep('a')]);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByText('Episode a')).toBeTruthy());
  });

  it('has an empty state for a season without episodes', async () => {
    getPodcast.mockResolvedValue(podcast());
    getEpisodePage.mockResolvedValue([]);
    mount();
    expect(await screen.findByText('No episodes yet')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Play all' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows skeletons while the podcast loads', () => {
    getPodcast.mockReturnValue(new Promise(() => undefined));
    const { container } = mount();
    expect(container.querySelectorAll('.skeleton, [class*="skeleton"]').length).toBeGreaterThan(0);
  });
});
