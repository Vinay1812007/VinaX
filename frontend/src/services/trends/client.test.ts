/**
 * fetchVerifiedTrends: never throws, resolves null when the read is
 * unavailable, and re-validates every field — an item that is not a
 * confident, unexpired, well-formed match is dropped, never repaired.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/native', () => ({ isNativePlatform: () => false }));

import { fetchVerifiedTrends } from './client';

const later = new Date(Date.now() + 86_400_000).toISOString();
const earlier = new Date(Date.now() - 3_600_000).toISOString();

const goodItem = {
  catalogId: 'c1',
  title: 'Chuttamalle',
  artist: 'Shilpa Rao',
  language: 'telugu',
  region: 'IN',
  source: 'youtube',
  sourceLabel: 'Public video chart',
  sourceKind: 'public-chart',
  sourceRank: 3,
  sourceUrl: 'https://example.org/v/1',
  observedAt: earlier,
  expiresAt: later,
  mappingConfidence: 0.98,
  momentum: { rankDelta: 2, windowHours: 12 },
  newEntry: false,
};
const body = (over: Record<string, unknown> = {}) => ({
  generatedAt: new Date().toISOString(),
  sources: [
    { id: 'youtube', label: 'Public video chart', kind: 'public-chart', status: 'ok', lastSuccessAt: earlier, region: 'IN' },
    { id: 'bogus', label: 'x', kind: 'weird', status: 'ok', lastSuccessAt: null, region: 'IN' },
  ],
  items: [goodItem],
  ...over,
});

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(JSON.stringify(body()), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('fetchVerifiedTrends', () => {
  it('reads the documented shape and asks for the region, language and limit', async () => {
    const snap = await fetchVerifiedTrends({ region: 'in', language: 'Telugu', limit: 25 });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/trends?region=IN&language=telugu&limit=25');
    expect(snap?.sources).toEqual([{ id: 'youtube', label: 'Public video chart', kind: 'public-chart', status: 'ok', lastSuccessAt: earlier, region: 'IN' }]);
    expect(snap?.items).toEqual([goodItem]);
  });

  it('drops items that are not confident, have expired, or are malformed', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          body({
            items: [
              goodItem,
              { ...goodItem, catalogId: 'low', mappingConfidence: 0.6 },
              { ...goodItem, catalogId: 'old', expiresAt: earlier },
              { ...goodItem, catalogId: 'kind', sourceKind: 'viral' },
              { ...goodItem, catalogId: 'rank', sourceRank: 0 },
              { ...goodItem, catalogId: '' },
              'junk',
            ],
          }),
        ),
        { status: 200 },
      ),
    );
    const snap = await fetchVerifiedTrends({});
    expect(snap?.items.map((i) => i.catalogId)).toEqual(['c1']);
  });

  it('drops a source or item of a kind this build does not know, never showing it or crashing on it', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          body({
            sources: [
              { id: 'editorial', label: 'Editor’s picks', kind: 'editorial', status: 'ok', lastSuccessAt: earlier, region: 'IN' },
              { id: 'future', label: 'Future source', kind: 'some-later-kind', status: 'ok', lastSuccessAt: earlier, region: 'IN' },
            ],
            items: [{ ...goodItem, catalogId: 'e1', source: 'editorial', sourceLabel: 'Editor’s picks', sourceKind: 'editorial', sourceRank: 1, momentum: null }, { ...goodItem, catalogId: 'f1', source: 'future', sourceKind: 'some-later-kind' }],
          }),
        ),
        { status: 200 },
      ),
    );
    const snap = await fetchVerifiedTrends({});
    expect(snap?.sources.map((s) => [s.id, s.kind])).toEqual([['editorial', 'editorial']]);
    expect(snap?.items.map((i) => [i.catalogId, i.sourceKind])).toEqual([['e1', 'editorial']]);
  });

  it('keeps only https evidence links and never reports a new entry alongside a rank change', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body({ items: [{ ...goodItem, sourceUrl: 'javascript:alert(1)', newEntry: true }] })), { status: 200 }));
    const snap = await fetchVerifiedTrends({});
    expect(snap?.items[0].sourceUrl).toBeNull();
    expect(snap?.items[0].newEntry).toBe(false);
  });

  it('keeps momentum null when the server sends none', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body({ items: [{ ...goodItem, momentum: null, newEntry: true }] })), { status: 200 }));
    const snap = await fetchVerifiedTrends({});
    expect(snap?.items[0]).toMatchObject({ momentum: null, newEntry: true });
  });

  it('resolves null — never throws — on HTTP errors, bad bodies and network failures', async () => {
    fetchMock.mockResolvedValueOnce(new Response('oops', { status: 503 }));
    expect(await fetchVerifiedTrends({})).toBeNull();
    fetchMock.mockResolvedValueOnce(new Response('<html>', { status: 200 }));
    expect(await fetchVerifiedTrends({})).toBeNull();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { status: 200 }));
    expect(await fetchVerifiedTrends({})).toBeNull();
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await fetchVerifiedTrends({})).toBeNull();
  });

  it('resolves null when the caller cancels', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    expect(await fetchVerifiedTrends({ signal: ctrl.signal })).toBeNull();
    fetchMock.mockImplementationOnce(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const live = new AbortController();
    const pending = fetchVerifiedTrends({ signal: live.signal });
    live.abort();
    expect(await pending).toBeNull();
  });

  it('ignores an invalid region instead of sending it', async () => {
    await fetchVerifiedTrends({ region: 'india', limit: 900 });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/trends?limit=50');
  });
});
