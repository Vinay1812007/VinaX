// @vitest-environment jsdom
/**
 * Charts page labels. Pins: a verified public chart shows its source label,
 * rank, region, update time and evidence link; "Rising" and "New entry"
 * appear only when the snapshot carries them; editorial picks say so; an
 * out-of-date, unavailable, offline or unconnected source says so; and the
 * catalogue lists are always labelled as catalogue lists — nothing on the
 * page claims a song is trending anywhere without verified data.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrendsSnapshot, VerifiedTrend } from '@/services/trends/client';
import { makeSong } from '@/__fixtures__/songs';

const fetchVerifiedTrends = vi.fn<(opts: unknown) => Promise<TrendsSnapshot | null>>();
const getSong = vi.fn();
const playQueue = vi.fn();
let online = true;

vi.mock('@/services/trends/client', () => ({ fetchVerifiedTrends: (opts: unknown) => fetchVerifiedTrends(opts) }));
vi.mock('@/services/api', () => ({ getSong: (id: string) => getSong(id) }));
vi.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => online }));
vi.mock('@/features/location/useRegion', () => ({ useRegion: () => ({ country: 'IN', regionLabel: null, source: 'manual' }) }));
vi.mock('@/store/playerStore', () => ({ usePlayerStore: (sel: (s: { playQueue: typeof playQueue }) => unknown) => sel({ playQueue }) }));
vi.mock('@/store/historyStore', () => ({ useHistoryStore: (sel: (s: { entries: unknown[] }) => unknown) => sel({ entries: [] }) }));
const catalogueSongs = [makeSong('p1', { title: 'Catalogue One' }), makeSong('p2', { title: 'Catalogue Two' })];
vi.mock('@/features/search/useInfiniteSongs', () => ({
  useInfiniteSongs: () => ({ isLoading: false, isError: false, data: { pages: [catalogueSongs] }, refetch: vi.fn() }),
  flattenSongPages: (pages?: unknown[][]) => (pages ?? []).flat(),
}));

import ChartsPage from './ChartsPage';

const NOW = Date.now();
const iso = (hoursAgo: number) => new Date(NOW - hoursAgo * 3_600_000).toISOString();
const later = new Date(NOW + 48 * 3_600_000).toISOString();

const chartSource = { id: 'youtube', label: 'Public video chart', kind: 'public-chart' as const, status: 'ok' as const, lastSuccessAt: iso(2), region: 'IN' };
const shortVideo = { id: 'instagram', label: 'Short-video audio', kind: 'public-chart' as const, status: 'disabled' as const, lastSuccessAt: null, region: 'IN' };
const editorialSource = { id: 'editorial', label: 'Editor’s picks', kind: 'editorial' as const, status: 'ok' as const, lastSuccessAt: iso(1), region: 'IN' };

function trend(over: Partial<VerifiedTrend>): VerifiedTrend {
  return {
    catalogId: 'c1',
    title: 'Chuttamalle',
    artist: 'Shilpa Rao',
    language: 'telugu',
    region: 'IN',
    source: 'youtube',
    sourceLabel: 'Public video chart',
    sourceKind: 'public-chart',
    sourceRank: 3,
    sourceUrl: 'https://example.org/evidence/1',
    observedAt: iso(2),
    expiresAt: later,
    mappingConfidence: 0.98,
    momentum: null,
    newEntry: false,
    ...over,
  };
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ChartsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const pageText = () => document.body.textContent ?? '';
const noUnverifiedClaims = () => {
  expect(pageText()).not.toMatch(/trending on/i);
  expect(pageText()).not.toMatch(/What India is playing/i);
};

beforeEach(() => {
  online = true;
  fetchVerifiedTrends.mockReset();
  getSong.mockReset();
  playQueue.mockReset();
  window.sessionStorage.clear();
});
afterEach(cleanup);

describe('ChartsPage', () => {
  it('without a connected chart, says so and labels the catalogue lists as catalogue lists', async () => {
    fetchVerifiedTrends.mockResolvedValue({ generatedAt: iso(0), sources: [{ ...chartSource, status: 'not_configured', lastSuccessAt: null }, shortVideo, { ...editorialSource, status: 'not_configured', lastSuccessAt: null }], items: [] });
    mount();
    expect(await screen.findByText(/No public chart is connected yet/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Popular in the catalogue' })).toBeTruthy();
    expect(screen.getByText(/not a live chart/)).toBeTruthy();
    expect(screen.getByText('Catalogue One')).toBeTruthy();
    // The disabled short-video source is never presented as a chart.
    expect(pageText()).not.toMatch(/Short-video audio/);
    noUnverifiedClaims();
  });

  it('shows a verified entry with its source label, rank, region, update time and evidence link', async () => {
    fetchVerifiedTrends.mockResolvedValue({ generatedAt: iso(0), sources: [chartSource, shortVideo], items: [trend({})] });
    mount();
    expect(await screen.findByText('Chuttamalle')).toBeTruthy();
    expect(screen.getByText('#3 on Public video chart · IN · seen 2 h ago')).toBeTruthy();
    expect(screen.getByText('Public video chart · IN · updated 2 h ago')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Evidence for Chuttamalle: Public video chart' });
    expect(link.getAttribute('href')).toBe('https://example.org/evidence/1');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    // No movement markers without comparable observations.
    expect(pageText()).not.toMatch(/Rising|New entry/);
    expect(fetchVerifiedTrends).toHaveBeenCalledWith(expect.objectContaining({ region: 'IN', limit: 50 }));
    noUnverifiedClaims();
  });

  it('shows "Rising" and "New entry" only when the snapshot carries them', async () => {
    fetchVerifiedTrends.mockResolvedValue({
      generatedAt: iso(0),
      sources: [chartSource],
      items: [
        trend({ catalogId: 'c1', title: 'Riser', sourceRank: 1, momentum: { rankDelta: 4, windowHours: 12 } }),
        trend({ catalogId: 'c2', title: 'Newcomer', sourceRank: 2, newEntry: true }),
        trend({ catalogId: 'c3', title: 'Faller', sourceRank: 3, momentum: { rankDelta: -2, windowHours: 12 } }),
        trend({ catalogId: 'c4', title: 'Steady', sourceRank: 4 }),
      ],
    });
    mount();
    expect(await screen.findByText('Rising ▲4')).toBeTruthy();
    expect(screen.getAllByText('New entry')).toHaveLength(1);
    expect(screen.getAllByText(/Rising/)).toHaveLength(1);
  });

  it('labels editorial picks as editorial and filters by source', async () => {
    fetchVerifiedTrends.mockResolvedValue({
      generatedAt: iso(0),
      sources: [chartSource, editorialSource],
      items: [trend({ catalogId: 'c1', title: 'Chart Song' }), trend({ catalogId: 'c9', title: 'Picked Song', source: 'editorial', sourceLabel: 'Editor’s picks', sourceKind: 'editorial', sourceRank: 1, momentum: null })],
    });
    mount();
    expect(await screen.findByText('Picked Song')).toBeTruthy();
    expect(screen.getByText(/^Editorial pick · IN · until /)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Editor’s picks' }));
    expect(screen.queryByText('Chart Song')).toBeNull();
    expect(screen.getByText('Picked Song')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'All sources' }));
    expect(screen.getByText('Chart Song')).toBeTruthy();
  });

  it('8.3.1 — a song found on the web is labelled as found on the web, never as an editorial pick', async () => {
    const webSource = { id: 'web', label: 'New on the web', kind: 'web' as const, status: 'ok' as const, lastSuccessAt: iso(1), region: 'IN' };
    fetchVerifiedTrends.mockResolvedValue({
      generatedAt: iso(0),
      sources: [chartSource, editorialSource, webSource],
      items: [trend({ catalogId: 'w1', title: 'Web Song', source: 'web', sourceLabel: 'New on the web', sourceKind: 'web', sourceRank: 1, sourceUrl: 'https://example.org/upload/1' })],
    });
    mount();
    expect(await screen.findByText('Web Song')).toBeTruthy();
    expect(screen.getByText('Web')).toBeTruthy();
    expect(screen.getByText('New on the web · found on the web, checked by VinaX · IN · seen 2 h ago')).toBeTruthy();
    expect(screen.queryByText(/Editorial pick/)).toBeNull();
    expect(screen.queryByText('Pick')).toBeNull();
    expect(screen.getByRole('link', { name: 'Evidence for Web Song: the web page it was found on' })).toBeTruthy();
  });

  it('labels an out-of-date source as out of date and still shows its entries', async () => {
    fetchVerifiedTrends.mockResolvedValue({ generatedAt: iso(0), sources: [{ ...chartSource, status: 'stale', lastSuccessAt: iso(20) }], items: [trend({ observedAt: iso(20) })] });
    mount();
    expect(await screen.findByText('Public video chart · IN · out of date — last updated 20 h ago')).toBeTruthy();
    expect(screen.getByText('Chuttamalle')).toBeTruthy();
  });

  it('says so when the verified read is unavailable, keeps the catalogue lists, and retries', async () => {
    fetchVerifiedTrends.mockResolvedValueOnce(null);
    mount();
    expect(await screen.findByText('Public charts are unavailable right now.')).toBeTruthy();
    expect(screen.getByText('Catalogue One')).toBeTruthy();
    fetchVerifiedTrends.mockResolvedValueOnce({ generatedAt: iso(0), sources: [chartSource], items: [trend({})] });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    });
    expect(await screen.findByText('Chuttamalle')).toBeTruthy();
    noUnverifiedClaims();
  });

  it('says so when offline', async () => {
    online = false;
    fetchVerifiedTrends.mockResolvedValue(null);
    mount();
    expect(await screen.findByText(/You’re offline\. Public charts need a connection/)).toBeTruthy();
  });

  it('says so when a connected source has nothing matched yet', async () => {
    fetchVerifiedTrends.mockResolvedValue({ generatedAt: iso(0), sources: [chartSource], items: [] });
    mount();
    expect(await screen.findByText('No chart entries have been matched to catalogue songs yet.')).toBeTruthy();
  });

  it('plays a verified entry through the catalogue copy of the song', async () => {
    const song = makeSong('c1', { title: 'Chuttamalle' });
    getSong.mockResolvedValue(song);
    fetchVerifiedTrends.mockResolvedValue({ generatedAt: iso(0), sources: [chartSource], items: [trend({})] });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Play Chuttamalle' }));
    await waitFor(() => expect(playQueue).toHaveBeenCalledWith([song], 0));
    expect(getSong).toHaveBeenCalledWith('c1');
  });

  it('tells the listener when the catalogue cannot load a verified entry', async () => {
    getSong.mockRejectedValue(new Error('down'));
    fetchVerifiedTrends.mockResolvedValue({ generatedAt: iso(0), sources: [chartSource], items: [trend({})] });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Play Chuttamalle' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(playQueue).not.toHaveBeenCalled();
  });
});
