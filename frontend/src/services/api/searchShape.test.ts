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

// 13.7 — the catalogue's best match comes only in topQuery: "arijit" names the
// artist Arijit Singh there, while the artist rows are duets and a namesake.
it('leads each group with its topQuery item and remembers the top artist', async () => {
  request.mockImplementation(({ validate }) =>
    Promise.resolve(
      validate({
        data: {
          topQuery: { results: [{ id: '459320', title: 'Arijit Singh', type: 'artist', image: [] }] },
          songs: { results: [] },
          albums: { results: [] },
          artists: {
            results: [
              { id: '702776', title: 'Pritam & Arijit Singh', type: 'artist', image: [] },
              { id: '1742694', title: 'Arijit', type: 'artist', image: [] },
            ],
          },
          playlists: { results: [] },
        },
      }),
    ),
  );
  const out = await searchAll('arijit');
  expect(out.artists.map((a) => a.id)).toEqual(['459320', '702776', '1742694']);
  expect(out.topArtistId).toBe('459320');
});

it('a topQuery item already in its group moves to the front, once', async () => {
  request.mockImplementation(({ validate }) =>
    Promise.resolve(
      validate({
        data: {
          topquery: { data: [{ id: '2', title: 'B', type: 'artist', image: [] }] },
          songs: { results: [] },
          artists: { results: [{ id: '1', title: 'A', type: 'artist', image: [] }, { id: '2', title: 'B', type: 'artist', image: [] }] },
        },
      }),
    ),
  );
  expect((await searchAll('b')).artists.map((a) => a.id)).toEqual(['2', '1']);
});
