import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearxngResponse, SearxngResult } from './searxng';

/* ---- the two things outside this module: the search instance and the catalogue ---- */

const searxngQuery = vi.fn<(...a: unknown[]) => Promise<SearxngResponse>>();
const searxngConfigured = vi.fn(() => true);
vi.mock('./searxng', async (importActual) => {
  const actual = await importActual<typeof import('./searxng')>();
  return { ...actual, searxngQuery: (...a: unknown[]) => searxngQuery(...a), searxngConfigured: () => searxngConfigured() };
});

const chat = vi.fn<(...a: unknown[]) => Promise<{ content: string | null; model: string | null; error?: string }>>();
vi.mock('./ai', async (importActual) => {
  const actual = await importActual<typeof import('./ai')>();
  return { ...actual, chat: (...a: unknown[]) => chat(...a) };
});

const searchCatalogSongs = vi.fn<(q: string, n: number) => Promise<unknown[]>>();
vi.mock('./trends/catalog', () => ({ searchCatalogSongs: (q: string, n: number) => searchCatalogSongs(q, n) }));

import {
  CACHE_MAX_AGE_MS,
  CACHE_WINDOW_MS,
  FRESH_MS,
  MAX_SEARCHES,
  QUOTA_PER_HOUR,
  cachedDiscovery,
  classifySource,
  discoverMusic,
  discoveryCacheKey,
  discoveryHealth,
  discoveryQueries,
  readExtractions,
  readPeriod,
  resetDiscoveryState,
} from './discovery';

const NOW = Date.UTC(2026, 9, 2, 12, 0, 0); // 2 October 2026

const result = (over: Partial<SearxngResult> = {}): SearxngResult => ({
  title: 'Top Telugu songs chart — October 2026',
  url: 'https://charts.example/telugu/2026-10',
  content: '1. Nee Kosam by Sai Kiran. 2. Vennela Ratri by Madhura Vani.',
  engines: ['e'],
  category: 'general',
  author: null,
  publishedDate: '2026-10-01T00:00:00.000Z',
  score: 1,
  ...over,
});

const ok = (results: SearxngResult[]): SearxngResponse => ({ ok: true, status: 'ok', results, httpStatus: 200, ms: 10 } as unknown as SearxngResponse);
const down = (): SearxngResponse => ({ ok: false, status: 'timeout', results: [], httpStatus: null, ms: 10 } as unknown as SearxngResponse);

/** A catalogue that contains the two songs the fixture pages name. */
const CATALOGUE = [
  { id: 'cat-1', title: 'Nee Kosam', primaryArtists: ['Sai Kiran'], featuredArtists: [], credits: [], language: 'telugu' },
  { id: 'cat-2', title: 'Vennela Ratri', primaryArtists: ['Madhura Vani'], featuredArtists: [], credits: [], language: 'telugu' },
];

function catalogueServes(rows = CATALOGUE): void {
  searchCatalogSongs.mockImplementation(async (q: string) => rows.filter((r) => q.toLowerCase().includes(r.title.toLowerCase())));
}

function readerSays(songs: unknown): void {
  chat.mockResolvedValue({ content: JSON.stringify({ songs }), model: 'm' });
}

beforeEach(() => {
  resetDiscoveryState();
  searxngQuery.mockReset();
  searxngConfigured.mockReset();
  searxngConfigured.mockReturnValue(true);
  chat.mockReset();
  searchCatalogSongs.mockReset();
  searxngQuery.mockResolvedValue(ok([result()]));
  catalogueServes();
  readerSays([
    { title: 'Nee Kosam', artist: 'Sai Kiran', source: 1, rank: 1 },
    { title: 'Vennela Ratri', artist: 'Madhura Vani', source: 1, rank: 2 },
  ]);
});
afterEach(() => vi.useRealTimers());

const query = { region: 'IN', language: 'telugu', intent: 'charting' as const, now: NOW };

describe('discoveryQueries', () => {
  it('names today’s month and the language, bounded by the search budget', () => {
    const qs = discoveryQueries(query);
    expect(qs.length).toBeLessThanOrEqual(MAX_SEARCHES);
    expect(qs.every((q) => q.includes('telugu'))).toBe(true);
    expect(qs.some((q) => q.includes('October 2026'))).toBe(true);
  });

  it('falls back to the region when no language is named', () => {
    const qs = discoveryQueries({ ...query, language: null });
    expect(qs.some((q) => q.includes('IN'))).toBe(true);
  });

  it('asks different things for each intent', () => {
    const charting = discoveryQueries(query).join(' ');
    const releases = discoveryQueries({ ...query, intent: 'new-releases' }).join(' ');
    expect(charting).not.toBe(releases);
    expect(releases).toMatch(/new|latest|released/);
  });

  it('never lets a crafted language leak into the query', () => {
    const qs = discoveryQueries({ ...query, language: 'telugu"&cmd=1' });
    expect(qs.join(' ')).not.toContain('&');
    expect(qs.join(' ')).not.toContain('"');
  });
});

describe('classifySource', () => {
  it('calls a chart a chart, and understates rather than overstates', () => {
    expect(classifySource(result())).toBe('chart');
    expect(classifySource(result({ title: 'The 20 best new Telugu songs', content: 'our picks', url: 'https://mag.example/best' }))).toBe('editorial');
    expect(classifySource(result({ title: 'Nee Kosam is out now', content: 'the single drops today', url: 'https://label.example/releases/x' }))).toBe('release');
    expect(classifySource(result({ title: 'Some page about music', content: 'words', url: 'https://example.com/a' }))).toBe('search-result');
  });

  it('survives a malformed URL', () => {
    expect(classifySource({ title: 'plain', content: '', url: 'not a url' })).toBe('search-result');
  });
});

describe('readPeriod', () => {
  it('reads only a period the text states', () => {
    expect(readPeriod('Chart for 2026-W40')).toBe('2026-W40');
    expect(readPeriod('The best of October 2026')).toBe('2026-10');
    expect(readPeriod('published 2026-10-01')).toBe('2026-10-01');
    expect(readPeriod('a page with no date at all')).toBeNull();
  });
});

describe('readExtractions — the model cannot smuggle anything in', () => {
  it('keeps well-formed rows', () => {
    const out = readExtractions({ songs: [{ title: 'A', artist: 'B', source: 1, rank: 3 }] }, 2);
    expect(out).toEqual([{ title: 'A', artist: 'B', source: 1, rank: 3 }]);
  });

  it('drops a row citing a result we never supplied', () => {
    expect(readExtractions({ songs: [{ title: 'A', artist: 'B', source: 9, rank: null }] }, 2)).toEqual([]);
    expect(readExtractions({ songs: [{ title: 'A', artist: 'B', source: 0, rank: null }] }, 2)).toEqual([]);
    expect(readExtractions({ songs: [{ title: 'A', artist: 'B', source: 'one', rank: null }] }, 2)).toEqual([]);
  });

  it('drops a row with no title or no artist', () => {
    expect(readExtractions({ songs: [{ title: 'A', source: 1 }, { artist: 'B', source: 1 }, { title: '', artist: 'B', source: 1 }] }, 2)).toEqual([]);
  });

  it('rejects an out-of-range rank rather than passing it through', () => {
    expect(readExtractions({ songs: [{ title: 'A', artist: 'B', source: 1, rank: 0 }] }, 1)[0].rank).toBeNull();
    expect(readExtractions({ songs: [{ title: 'A', artist: 'B', source: 1, rank: 9999 }] }, 1)[0].rank).toBeNull();
    expect(readExtractions({ songs: [{ title: 'A', artist: 'B', source: 1, rank: 1.5 }] }, 1)[0].rank).toBeNull();
  });

  it('folds two spellings of one song', () => {
    const out = readExtractions({ songs: [
      { title: 'Nee Kosam', artist: 'Sai Kiran', source: 1, rank: 1 },
      { title: 'Nee Kosam (From "Film")', artist: 'Sai Kiran', source: 1, rank: 2 },
    ] }, 1);
    expect(out).toHaveLength(1);
  });

  it('survives junk in place of an answer', () => {
    for (const junk of [null, undefined, 'text', 42, {}, { songs: 'no' }, { songs: [null, 7] }]) {
      expect(readExtractions(junk, 2)).toEqual([]);
    }
  });
});

describe('discoverMusic', () => {
  it('returns catalogue-resolved items with their evidence', async () => {
    const out = await discoverMusic({} as never, query);
    expect(out.state).toBe('ok');
    expect(out.items.map((i) => i.catalogId).sort()).toEqual(['cat-1', 'cat-2']);
    const first = out.items[0];
    expect(first.evidence[0]).toMatchObject({
      url: 'https://charts.example/telugu/2026-10',
      sourceType: 'chart',
      publishedAt: '2026-10-01T00:00:00.000Z',
      period: '2026-10',
    });
    expect(first.evidence[0].observedAt).toBeTruthy();
  });

  it('keeps a stated chart position only from a chart page', async () => {
    const charted = await discoverMusic({} as never, query);
    expect(charted.items[0].rank).toBe(1);

    // The same answer, but the page is an editorial round-up: the number the
    // model offered is NOT a measured position and must not be reported as one.
    resetDiscoveryState();
    searxngQuery.mockResolvedValue(ok([result({ title: 'The best new Telugu songs', url: 'https://mag.example/best', content: 'our favourite picks' })]));
    const editorial = await discoverMusic({} as never, query);
    expect(editorial.items[0].sourceType).toBe('editorial');
    expect(editorial.items.every((i) => i.rank === null)).toBe(true);
  });

  it('drops a song that does not exist in the catalogue — never invents one', async () => {
    readerSays([
      { title: 'Nee Kosam', artist: 'Sai Kiran', source: 1, rank: 1 },
      { title: 'A Song That Does Not Exist', artist: 'Nobody At All', source: 1, rank: 2 },
    ]);
    const out = await discoverMusic({} as never, query);
    expect(out.items.map((i) => i.catalogId)).toEqual(['cat-1']);
  });

  it('says `empty` when nothing resolves, and reports no items', async () => {
    readerSays([{ title: 'Invented', artist: 'Nobody', source: 1, rank: null }]);
    const out = await discoverMusic({} as never, query);
    expect(out.state).toBe('empty');
    expect(out.items).toEqual([]);
  });

  it('says `not_configured` without searching when there is no instance', async () => {
    searxngConfigured.mockReturnValue(false);
    const out = await discoverMusic({} as never, query);
    expect(out.state).toBe('not_configured');
    expect(searxngQuery).not.toHaveBeenCalled();
    expect(out.note).toMatch(/no web search instance is configured/i);
  });

  it('says `no_reader` when no AI lane is configured', async () => {
    chat.mockResolvedValue({ content: null, model: null, error: 'not_configured' });
    const out = await discoverMusic({} as never, query);
    expect(out.state).toBe('no_reader');
  });

  it('says `failed` when the instance does not answer', async () => {
    searxngQuery.mockResolvedValue(down());
    const out = await discoverMusic({} as never, query);
    expect(out.state).toBe('failed');
  });

  it('never throws, whatever the catalogue does', async () => {
    searchCatalogSongs.mockRejectedValue(new Error('catalogue down'));
    const out = await discoverMusic({} as never, query);
    expect(['failed', 'empty']).toContain(out.state);
  });

  it('coalesces two identical questions into one run', async () => {
    const [a, b] = await Promise.all([discoverMusic({} as never, query), discoverMusic({} as never, query)]);
    expect(a).toBe(b);
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('serves the cache instead of searching again', async () => {
    await discoverMusic({} as never, query);
    const searches = searxngQuery.mock.calls.length;
    await discoverMusic({} as never, query);
    expect(searxngQuery.mock.calls.length).toBe(searches);
  });

  it('keeps separate caches per region, language, intent and time window', () => {
    const base = discoveryCacheKey(query, NOW);
    expect(discoveryCacheKey({ ...query, region: 'LK' }, NOW)).not.toBe(base);
    expect(discoveryCacheKey({ ...query, language: 'hindi' }, NOW)).not.toBe(base);
    expect(discoveryCacheKey({ ...query, intent: 'new-releases' }, NOW)).not.toBe(base);
    expect(discoveryCacheKey(query, NOW + CACHE_WINDOW_MS + 1)).not.toBe(base);
  });

  it('labels an answer whose evidence has aged `stale` rather than passing it off as fresh', async () => {
    await discoverMusic({} as never, query);
    expect(cachedDiscovery(query, NOW)?.state).toBe('ok');
    // Same day (the cache window), but the evidence is past the freshness horizon.
    const aged = NOW + FRESH_MS + 60_000;
    const still = cachedDiscovery(query, aged);
    expect(still?.state).toBe('stale');
    expect(still?.note).toMatch(/six hours/i);
    expect(still?.items.length).toBeGreaterThan(0);
  });

  it('forgets an entry from another day entirely', async () => {
    await discoverMusic({} as never, query);
    const tomorrow = NOW + CACHE_MAX_AGE_MS + 1;
    expect(cachedDiscovery(query, tomorrow)).toBeNull();
  });

  it('cachedDiscovery never searches', () => {
    expect(cachedDiscovery(query, NOW)).toBeNull();
    expect(searxngQuery).not.toHaveBeenCalled();
  });

  it('stops running once the hourly quota is spent', async () => {
    for (let i = 0; i < QUOTA_PER_HOUR; i += 1) {
      // A different question each time, so the cache cannot absorb it.
      await discoverMusic({} as never, { ...query, language: `lang${i}` });
    }
    const out = await discoverMusic({} as never, { ...query, language: 'one-too-many' });
    expect(out.state).toBe('resting');
    expect(out.note).toMatch(/budget/i);
  });

  it('opens the breaker after repeated failures, then reports resting', async () => {
    searxngQuery.mockResolvedValue(down());
    for (let i = 0; i < 3; i += 1) await discoverMusic({} as never, { ...query, language: `f${i}` });
    const out = await discoverMusic({} as never, { ...query, language: 'after' });
    expect(out.state).toBe('resting');
    expect(discoveryHealth({} as never).breakerOpen).toBe(true);
  });

  it('reports its own health honestly', async () => {
    expect(discoveryHealth({} as never)).toMatchObject({ configured: true, breakerOpen: false, quotaUsed: 0, quotaPerHour: QUOTA_PER_HOUR });
    await discoverMusic({} as never, query);
    expect(discoveryHealth({} as never).quotaUsed).toBe(1);
  });

  it('hands the model web text as fenced DATA, never as instructions', async () => {
    await discoverMusic({} as never, query);
    const messages = chat.mock.calls[0][1] as Array<{ role: string; content: string }>;
    const userTurn = messages.find((m) => m.role === 'user')!.content;
    expect(userTurn).toMatch(/WEB RESULTS/);
    // The fence carries a nonce and an explicit "data" framing (websearch.ts).
    expect(userTurn).toMatch(/untrusted|data|do not follow/i);
  });

  it('never asks for more searches than its budget', async () => {
    await discoverMusic({} as never, query);
    expect(searxngQuery.mock.calls.length).toBeLessThanOrEqual(MAX_SEARCHES);
  });
});
