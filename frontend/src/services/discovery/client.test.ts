// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/native', () => ({ isNativePlatform: () => false }));

import { discoveryLabel, discoveryStateNote, fetchDiscoveries, readDiscovery, type Discovery } from './client';

const evidence = (over: Record<string, unknown> = {}) => ({
  url: 'https://charts.example/telugu',
  title: 'Top Telugu songs — October 2026',
  sourceType: 'chart',
  observedAt: '2026-10-02T12:00:00.000Z',
  publishedAt: '2026-10-01T00:00:00.000Z',
  period: '2026-10',
  ...over,
});

const item = (over: Record<string, unknown> = {}) => ({
  catalogId: 'cat-1',
  title: 'Nee Kosam',
  artist: 'Sai Kiran',
  language: 'telugu',
  matchConfidence: 1,
  sourceType: 'chart',
  rank: 3,
  evidence: [evidence()],
  ...over,
});

const body = (over: Record<string, unknown> = {}) => ({
  state: 'ok',
  stale: false,
  evidenceAt: '2026-10-02T12:00:00.000Z',
  region: 'IN',
  language: 'telugu',
  intent: 'charting',
  items: [item()],
  note: '1 song verified.',
  ...over,
});

function serve(payload: unknown, init: { ok?: boolean } = {}): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => ({ ok: init.ok ?? true, json: async () => payload }) as unknown as Response);
  vi.stubGlobal('fetch', fn);
  return fn as unknown as ReturnType<typeof vi.fn>;
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe('readDiscovery — every field re-validated, nothing repaired', () => {
  it('reads a well-formed item', () => {
    const d = readDiscovery(item());
    expect(d).toMatchObject({ catalogId: 'cat-1', title: 'Nee Kosam', sourceType: 'chart', rank: 3 });
    expect(d!.evidence[0].url).toBe('https://charts.example/telugu');
  });

  it('drops an item with no catalogue id or no title', () => {
    expect(readDiscovery(item({ catalogId: '' }))).toBeNull();
    expect(readDiscovery(item({ title: null }))).toBeNull();
  });

  it('drops an item whose source kind this build does not know', () => {
    expect(readDiscovery(item({ sourceType: 'tiktok-rumour' }))).toBeNull();
  });

  it('drops an item the server was not confident about', () => {
    expect(readDiscovery(item({ matchConfidence: 0.4 }))).toBeNull();
    expect(readDiscovery(item({ matchConfidence: 'high' }))).toBeNull();
    expect(readDiscovery(item({ matchConfidence: 2 }))).toBeNull();
  });

  it('drops an item with no openable evidence', () => {
    expect(readDiscovery(item({ evidence: [] }))).toBeNull();
    expect(readDiscovery(item({ evidence: [evidence({ url: 'http://insecure.example/x' })] }))).toBeNull();
    expect(readDiscovery(item({ evidence: [evidence({ url: 'javascript:alert(1)' })] }))).toBeNull();
    expect(readDiscovery(item({ evidence: 'a page' }))).toBeNull();
  });

  it('drops a rank that no chart stated — whatever the server sent', () => {
    // An editorial list is not a chart, so its "position" is not a position.
    expect(readDiscovery(item({ sourceType: 'editorial', rank: 1 }))!.rank).toBeNull();
    expect(readDiscovery(item({ sourceType: 'release', rank: 2 }))!.rank).toBeNull();
    expect(readDiscovery(item({ sourceType: 'search-result', rank: 5 }))!.rank).toBeNull();
    // And an impossible rank on a real chart is dropped too.
    expect(readDiscovery(item({ rank: 0 }))!.rank).toBeNull();
    expect(readDiscovery(item({ rank: 5_000 }))!.rank).toBeNull();
  });

  it('keeps a publication date only when the server reported one', () => {
    expect(readDiscovery(item({ evidence: [evidence({ publishedAt: null })] }))!.evidence[0].publishedAt).toBeNull();
    expect(readDiscovery(item({ evidence: [evidence({ publishedAt: 'last tuesday' })] }))!.evidence[0].publishedAt).toBeNull();
  });

  it('survives junk', () => {
    for (const junk of [null, undefined, 'x', 42, [], {}]) expect(readDiscovery(junk)).toBeNull();
  });
});

describe('fetchDiscoveries', () => {
  it('reads a snapshot and only asks for what it was given', async () => {
    const fetchMock = serve(body());
    const snap = await fetchDiscoveries({ region: 'IN', language: 'telugu', intent: 'charting' });
    expect(snap).toMatchObject({ state: 'ok', region: 'IN', language: 'telugu', intent: 'charting' });
    expect(snap!.items).toHaveLength(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('region=IN');
    expect(url).toContain('language=telugu');
    expect(url).not.toContain('wait=1');
  });

  it('asks the server to wait only when told to', async () => {
    const fetchMock = serve(body());
    await fetchDiscoveries({ wait: true });
    expect(String(fetchMock.mock.calls[0][0])).toContain('wait=1');
  });

  it('refuses to send a crafted region or language', async () => {
    const fetchMock = serve(body());
    await fetchDiscoveries({ region: 'IN; DROP', language: 'telugu"&x=1' });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).not.toContain('DROP');
    expect(url).not.toContain('x=1');
  });

  it('answers null for an HTTP error, a non-JSON body and an unknown state', async () => {
    serve('<!doctype html>', { ok: false });
    expect(await fetchDiscoveries({})).toBeNull();
    serve({ items: 'none' });
    expect(await fetchDiscoveries({})).toBeNull();
    serve(body({ state: 'something-new' }));
    expect(await fetchDiscoveries({})).toBeNull();
  });

  it('answers null when the request fails outright', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await fetchDiscoveries({})).toBeNull();
  });

  it('keeps the good items from an answer that also carries bad ones', async () => {
    serve(body({ items: [item(), item({ catalogId: '' }), item({ catalogId: 'cat-2', sourceType: 'nonsense' })] }));
    const snap = await fetchDiscoveries({});
    expect(snap!.items.map((i) => i.catalogId)).toEqual(['cat-1']);
  });

  it('reports a stale or unconfigured server honestly, with no items', async () => {
    serve(body({ state: 'not_configured', items: [], note: 'No web search instance is configured on this deployment.' }));
    const snap = await fetchDiscoveries({});
    expect(snap).toMatchObject({ state: 'not_configured', items: [] });
    serve(body({ state: 'stale', stale: true }));
    expect((await fetchDiscoveries({}))!.stale).toBe(true);
  });

  it('does not fetch when the caller has already gone away', async () => {
    const fetchMock = serve(body());
    const ctrl = new AbortController();
    ctrl.abort();
    expect(await fetchDiscoveries({ signal: ctrl.signal })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('labels never overclaim', () => {
  const base: Discovery = readDiscovery(item())!;

  it('claims a chart position only with one', () => {
    expect(discoveryLabel(base)).toBe('Charting at #3');
    expect(discoveryLabel({ ...base, rank: null })).toBe('On a current chart');
    expect(discoveryLabel({ ...base, sourceType: 'editorial', rank: null })).toBe('A current editorial pick');
    expect(discoveryLabel({ ...base, sourceType: 'release', rank: null })).toBe('A new release');
    expect(discoveryLabel({ ...base, sourceType: 'search-result', rank: null })).toBe('Named by a current web source');
  });

  it('never says "trending today" for a plain search result', () => {
    for (const type of ['editorial', 'release', 'search-result'] as const) {
      expect(discoveryLabel({ ...base, sourceType: type, rank: null }).toLowerCase()).not.toContain('trending');
    }
  });

  it('says what is wrong rather than nothing', () => {
    expect(discoveryStateNote(null)).toMatch(/could not be reached/i);
    expect(discoveryStateNote({ state: 'ok' } as never)).toBe('');
    expect(discoveryStateNote({ state: 'not_configured' } as never)).toMatch(/not set up/i);
    expect(discoveryStateNote({ state: 'resting' } as never)).toMatch(/resting/i);
    expect(discoveryStateNote({ state: 'no_reader' } as never)).toMatch(/no ai engine/i);
    expect(discoveryStateNote({ state: 'stale' } as never)).toMatch(/hours old/i);
  });
});
