// @vitest-environment jsdom
/** Share to VinaX: /share opens the page, the search or Import a playlist. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/personalization/updater', () => ({ recordFavorite: () => undefined, recordDislike: () => undefined, recordPlaylistAdd: () => undefined }));
vi.mock('@/services/api', () => ({ searchSongs: async () => [] }));
vi.mock('@/store/playerStore', () => ({
  usePlayerStore: (sel: (s: { playQueue: () => void }) => unknown) => sel({ playQueue: () => undefined }),
}));

import SharePage from './SharePage';

function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{`${pathname}${search}`}</p>;
}

const mount = (at: string) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[at]}>
        <Routes>
          <Route path="/share" element={<SharePage />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('SharePage', () => {
  afterEach(cleanup);

  it('opens a shared VinaX link in place', () => {
    mount(`/share?text=${encodeURIComponent('come https://www.vinaxmusic.online/together?code=AB12CD')}`);
    expect(screen.getByTestId('where').textContent).toBe('/together?code=AB12CD');
  });

  it('searches one shared line', () => {
    mount(`/share?text=${encodeURIComponent('Kesariya - Arijit Singh')}`);
    expect(screen.getByTestId('where').textContent).toBe(`/search/${encodeURIComponent('Kesariya Arijit Singh')}`);
  });

  it('opens Import a playlist with a shared list filled in, and goes to Library when closed', () => {
    mount(`/share?text=${encodeURIComponent('Kesariya - Arijit Singh\nNaatu Naatu')}`);
    expect(screen.getByText('Import a playlist')).toBeTruthy();
    expect((screen.getByLabelText('Songs, one per line') as HTMLTextAreaElement).value).toBe('Kesariya - Arijit Singh\nNaatu Naatu');
    expect(screen.getByText('2 songs to look up')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByTestId('where').textContent).toBe('/library');
  });

  it('says what to share when there is nothing to look up', () => {
    mount('/share?url=https%3A%2F%2Fopen.spotify.com%2Ftrack%2Fabc');
    expect(screen.getByText('Nothing to look up')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Search' }).getAttribute('href')).toBe('/search');
  });
});
