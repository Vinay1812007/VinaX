import { beforeEach, expect, it, vi } from 'vitest';
const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('./client', () => ({ orchestratedRequest: request }));
import { setSearchSynonyms } from '@/services/search/synonyms';
import {
  searchAll,
  searchAlbums,
  searchAlbumsPage,
  searchArtists,
  searchArtistsPage,
  searchPlaylists,
  searchPlaylistsPage,
  searchSongs,
  searchSongsPage,
} from './saavn';
beforeEach(() => {
  request.mockReset();
  setSearchSynonyms(null);
});
it('accepts supported empty search results without a provider retry storm', async () => {
  request.mockImplementation(({ validate }) =>
    Promise.resolve(validate({ data: { songs: { results: [] }, albums: { results: [] } } })),
  );
  expect(await searchAll('no such song')).toEqual({
    songs: [],
    albums: [],
    artists: [],
    playlists: [],
  });
});
it('continues rejecting unsupported empty response shapes', async () => {
  request.mockImplementation(({ validate }) => Promise.resolve(validate({ data: {} })));
  expect(await searchAll('query')).toBeNull();
});
it('runs the admin synonym rewrite on every search endpoint', async () => {
  setSearchSynonyms({ arr: 'A. R. Rahman' });
  request.mockResolvedValue([]);
  const want = encodeURIComponent('A. R. Rahman');
  const calls: (() => Promise<unknown>)[] = [
    () => searchAll('arr'),
    () => searchSongs('arr'),
    () => searchSongsPage('arr', 1),
    () => searchAlbums('arr'),
    () => searchAlbumsPage('arr', 2),
    () => searchArtists('arr'),
    () => searchArtistsPage('arr', 2),
    () => searchPlaylists('arr'),
    () => searchPlaylistsPage('arr', 2),
  ];
  for (const call of calls) {
    request.mockClear();
    await call();
    const { paths } = request.mock.calls[0][0] as { paths: string[] };
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(path).toContain(`query=${want}`);
      expect(path).not.toContain('query=arr');
    }
  }
});
