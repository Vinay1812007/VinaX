import { beforeEach, expect, it, vi } from 'vitest';
const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('./client', () => ({ orchestratedRequest: request }));
import { searchAll } from './saavn';
beforeEach(() => {
  request.mockReset();
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
