// @vitest-environment jsdom
/**
 * 1.3 — the Podcasts grid. Pins: a card per show linking to its page, with
 * a play button that starts the show; the next page loads when the end of
 * the grid scrolls in and stops at a short page; repeated shows are shown
 * once; loading, error-with-retry and empty states.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PodcastSummary } from '@/services/api';

const getPodcasts = vi.fn<(page: number, limit: number, opts?: unknown) => Promise<PodcastSummary[]>>();
const playPodcast = vi.fn();
vi.mock('@/services/api', () => ({ getPodcasts: (p: number, l: number, o?: unknown) => getPodcasts(p, l, o) }));
vi.mock('@/features/podcasts/api', () => ({ playPodcast: (id: string, name: string) => playPodcast(id, name) }));

import PodcastsPage from './PodcastsPage';

const show = (id: string, over: Partial<PodcastSummary> = {}): PodcastSummary => ({
  id,
  name: `Show ${id}`,
  season: 1,
  releaseDate: '2022-04-12',
  explicit: false,
  images: [],
  ...over,
});
const page = (from: number, n: number) => Array.from({ length: n }, (_, i) => show(String(from + i)));

let observed: IntersectionObserverCallback[] = [];
const scrollToEnd = () =>
  act(() => {
    for (const cb of observed) cb([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
  });

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PodcastsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getPodcasts.mockReset();
  playPodcast.mockReset();
  observed = [];
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(cb: IntersectionObserverCallback) {
        observed.push(cb);
      }
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PodcastsPage', () => {
  it('shows a card per podcast linking to its page, and plays one from its card', async () => {
    getPodcasts.mockResolvedValue([show('62', { name: 'Talking Music', season: 3, releaseDate: '2021-06-22' }), show('175427', { name: 'Such a Drag' })]);
    mount();
    expect(await screen.findByText('Talking Music')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Podcasts' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Talking Music' }).getAttribute('href')).toBe('/podcast/talking-music-62');
    expect(screen.getByText('3 seasons · 2021')).toBeTruthy();
    expect(screen.getByText('Podcast · 2022')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Play Such a Drag' }));
    expect(playPodcast).toHaveBeenCalledWith('175427', 'Such a Drag');
    expect(getPodcasts).toHaveBeenCalledWith(1, 24, expect.objectContaining({ priority: 'interactive' }));
  });

  it('loads the next page at the end of the grid, once per show, and stops at a short page', async () => {
    getPodcasts.mockImplementation(async (p) => (p === 1 ? page(1, 24) : [show('24'), ...page(100, 3)]));
    mount();
    expect(await screen.findByText('Show 24')).toBeTruthy();
    await scrollToEnd();
    expect(await screen.findByText('Show 102')).toBeTruthy();
    expect(getPodcasts).toHaveBeenLastCalledWith(2, 24, expect.anything());
    // Show 24 came back on page 2 as well: still one card.
    expect(screen.getAllByText('Show 24')).toHaveLength(1);
    await scrollToEnd();
    expect(getPodcasts).toHaveBeenCalledTimes(2);
  });

  it('shows skeletons while loading', () => {
    getPodcasts.mockReturnValue(new Promise(() => undefined));
    const { container } = mount();
    expect(container.querySelectorAll('.skeleton, [class*="skeleton"]').length).toBeGreaterThan(0);
  });

  it('says so when the catalogue is down and retries', async () => {
    getPodcasts.mockRejectedValueOnce(new Error('down'));
    mount();
    expect(await screen.findByText('Couldn’t load podcasts')).toBeTruthy();
    getPodcasts.mockResolvedValueOnce([show('62', { name: 'Talking Music' })]);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Talking Music')).toBeTruthy();
  });

  it('keeps the shows it has when a later page fails, with a retry for the rest', async () => {
    getPodcasts.mockResolvedValueOnce(page(1, 24)).mockRejectedValueOnce(new Error('down'));
    mount();
    expect(await screen.findByText('Show 1')).toBeTruthy();
    await scrollToEnd();
    expect(await screen.findByText('Couldn’t load more podcasts.')).toBeTruthy();
    expect(screen.getByText('Show 1')).toBeTruthy();
    getPodcasts.mockResolvedValueOnce(page(200, 2));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByText('Show 201')).toBeTruthy());
  });

  it('has an empty state', async () => {
    getPodcasts.mockResolvedValue([]);
    mount();
    expect(await screen.findByText('No podcasts to show right now')).toBeTruthy();
  });
});
