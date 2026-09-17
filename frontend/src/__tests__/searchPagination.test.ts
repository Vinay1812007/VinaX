/**
 * P2-30 — artist/playlist search pagination. The tabs were hard-capped at 20;
 * now they page like songs/albums. The critical guard: mirrors that IGNORE
 * the page param serve page 1 forever, which must read as end-of-results
 * instead of an infinite loop of identical fetches.
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/services/api/client', () => ({ orchestratedRequest: request }));

import {
  clearRescuedQueries,
  fetchSongsPage,
  flattenPages,
  pageAddedNothing,
} from '../features/search/useInfiniteSongs';
import type { Song } from '../types';
import { artistSongsNextPage } from '../features/artists/useArtist';
import { getArtistTopSongs } from '../services/api/saavn';

const items = (...ids: string[]) => ids.map((id) => ({ id }));

describe('pageAddedNothing (mirror-ignores-paging guard)', () => {
  it('false while pages contribute fresh ids', () => {
    expect(pageAddedNothing(items('a', 'b'), [items('a', 'b')])).toBe(false);
    expect(pageAddedNothing(items('c', 'd'), [items('a', 'b'), items('c', 'd')])).toBe(false);
    // Partial overlap still counts as progress.
    expect(pageAddedNothing(items('b', 'c'), [items('a', 'b'), items('b', 'c')])).toBe(false);
  });

  it('true when the mirror serves the same page again (stop condition)', () => {
    const p1 = items('a', 'b', 'c');
    expect(pageAddedNothing(items('a', 'b', 'c'), [p1, items('a', 'b', 'c')])).toBe(true);
  });

  it('an empty page adds nothing', () => {
    expect(pageAddedNothing([], [items('a'), []])).toBe(true);
  });
});

describe('flattenPages', () => {
  it('de-dupes by id across pages, preserving first-seen order', () => {
    const out = flattenPages([items('a', 'b'), items('b', 'c'), items('a', 'd')]);
    expect(out.map((x) => x.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('handles undefined (no data yet)', () => {
    expect(flattenPages(undefined)).toEqual([]);
  });
});

describe('artist catalogue paging', () => {
  beforeEach(() => request.mockReset());

  interface Req {
    paths: string[];
    validate: (json: unknown) => unknown;
  }
  const lastRequest = (): Req => request.mock.calls[request.mock.calls.length - 1][0] as Req;
  const rawSong = (id: string) => ({ id, name: `Song ${id}`, downloadUrl: [{ quality: '160kbps', url: `https://x/${id}.mp4` }] });

  it('offers the unpaged dialect on the first page only', async () => {
    request.mockResolvedValue([]);
    await getArtistTopSongs('42');
    expect(lastRequest().paths).toHaveLength(2);
    await getArtistTopSongs('42', 3);
    expect(lastRequest().paths).toEqual(['/artists/42/songs?page=3&sortBy=popularity&sortOrder=desc']);
  });

  it('reads a well-formed empty later page as the end, not a shape miss', async () => {
    request.mockResolvedValue([]);
    await getArtistTopSongs('42', 2);
    expect(lastRequest().validate({ data: { songs: [] } })).toEqual([]);
    expect(lastRequest().validate({ data: { nothing: true } })).toBeNull();
    // Page 0 keeps falling through so the next dialect / base gets a turn.
    await getArtistTopSongs('42', 0);
    expect(lastRequest().validate({ data: { songs: [] } })).toBeNull();
    expect(lastRequest().validate({ data: { songs: [rawSong('a')] } })).toHaveLength(1);
  });

  it('stops when a mirror serves page 1 again', () => {
    const p1 = items(...Array.from({ length: 10 }, (_, i) => `s${i}`));
    const p2 = items(...Array.from({ length: 10 }, (_, i) => `t${i}`));
    expect(artistSongsNextPage(p1, [p1])).toBe(1);
    expect(artistSongsNextPage(p2, [p1, p2])).toBe(2);
    expect(artistSongsNextPage([...p1], [p1, [...p1]])).toBeUndefined();
    expect(artistSongsNextPage([], [p1, []])).toBeUndefined();
  });
});

describe('Songs tab typo rescue', () => {
  beforeEach(() => clearRescuedQueries());

  const hit = { id: 'a' } as unknown as Song;
  const catalogue = (answers: Record<string, Song[]>) =>
    vi.fn((q: string, _page: number, _limit: number, _opts?: { signal?: AbortSignal }) =>
      Promise.resolve(answers[q] ?? []),
    );

  it('retries an empty first page with the relaxed query', async () => {
    const fetchPage = catalogue({ 'arijit singh': [hit] });
    expect(await fetchSongsPage('arijittt singh!!', 1, true, undefined, fetchPage)).toEqual([hit]);
    expect(fetchPage.mock.calls.map((c) => c[0])).toEqual(['arijittt singh!!', 'arijit singh']);
  });

  it('keeps paging with the form that worked', async () => {
    const fetchPage = catalogue({ 'arijit singh': [hit] });
    await fetchSongsPage('arijittt singh!!', 1, true, undefined, fetchPage);
    fetchPage.mockClear();
    await fetchSongsPage('arijittt singh!!', 2, true, undefined, fetchPage);
    expect(fetchPage.mock.calls.map((c) => [c[0], c[1]])).toEqual([['arijit singh', 2]]);
  });

  it('does not retry when there is nothing to relax, results came back, or off the Search page', async () => {
    const empty = catalogue({});
    expect(await fetchSongsPage('clean query', 1, true, undefined, empty)).toEqual([]);
    expect(empty).toHaveBeenCalledTimes(1);

    const found = catalogue({ 'tum hi ho!': [hit] });
    await fetchSongsPage('tum hi ho!', 1, true, undefined, found);
    expect(found).toHaveBeenCalledTimes(1);

    const shelf = catalogue({});
    await fetchSongsPage('top hits!!', 1, false, undefined, shelf);
    expect(shelf).toHaveBeenCalledTimes(1);
  });

  it('an empty later page is the end of the list, never a second question', async () => {
    const fetchPage = catalogue({});
    await fetchSongsPage('arijittt singh!!', 3, true, undefined, fetchPage);
    expect(fetchPage.mock.calls.map((c) => c[0])).toEqual(['arijittt singh!!']);
  });

  it('threads the abort signal through both attempts', async () => {
    const fetchPage = catalogue({});
    const { signal } = new AbortController();
    await fetchSongsPage('kesariyaaa', 1, true, signal, fetchPage);
    expect(fetchPage.mock.calls.map((c) => c[3]?.signal)).toEqual([signal, signal]);
  });
});
