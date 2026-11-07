// @vitest-environment jsdom
/**
 * New Releases. Pins: albums and songs from the catalogue's /new-releases in
 * the pinned languages; when that feed fails, the search-based "new this
 * week" songs for the first language instead.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSong } from '@/__fixtures__/songs';
import type { Song } from '@/types';

const getNewReleases = vi.fn();
const fallback = vi.fn<(lang: string) => { data: Song[] | undefined; isLoading: boolean }>();
vi.mock('@/services/api', () => ({ API_LANGUAGES: ['hindi', 'telugu', 'tamil'], getNewReleases: (...a: unknown[]) => getNewReleases(...a) }));
vi.mock('@/features/home/useHomeShelves', () => ({ useNewForLanguage: (l: string) => fallback(l) }));
vi.mock('@/features/player/playEntity', () => ({ playAlbum: vi.fn() }));

import NewReleasesPage from './NewReleasesPage';
import { useSettingsStore } from '@/store/settingsStore';

const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <NewReleasesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  getNewReleases.mockReset();
  fallback.mockReset();
  fallback.mockReturnValue({ data: [makeSong('f1', { title: 'Fallback Song' })], isLoading: false });
  useSettingsStore.setState({ pinnedLanguages: ['telugu', 'hindi'] });
});
afterEach(cleanup);

describe('NewReleasesPage', () => {
  it('lists the catalogue feed’s albums and songs for the pinned languages', async () => {
    getNewReleases.mockResolvedValue({
      albums: [{ kind: 'album', id: 'al1', title: 'Fresh Album', subtitle: 'Someone', images: [], artists: [], songs: [], songCount: 5, year: '2026', language: 'telugu' }],
      songs: [makeSong('n1', { title: 'Fresh Song' })],
    });
    mount();
    expect(await screen.findByText('Fresh Album')).toBeTruthy();
    expect(screen.getByText('Fresh Song')).toBeTruthy();
    expect(getNewReleases.mock.calls[0][0]).toEqual(['telugu', 'hindi']);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('falls back to new songs in the first language when the feed fails', async () => {
    getNewReleases.mockRejectedValue(new Error('down'));
    mount();
    expect(await screen.findByText('Fallback Song')).toBeTruthy();
    expect(fallback).toHaveBeenCalledWith('telugu');
    expect(screen.getByRole('heading', { name: 'New this week in Telugu' })).toBeTruthy();
  });
});
