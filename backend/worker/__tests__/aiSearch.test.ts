/**
 * VinaX AI — web search: when it runs, the query, both providers with the
 * cache and the daily cap, and placing grounding's [n] markers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetSearch, applyMarkers, buildQuery, dailyLimit, hasRecencyCue, placeMarkers, searchWeb, toSources, topicOf, wantsSearch,
} from '../functions/_lib/ai/search';
import { gemini, geminiBody, groundingEvent } from '../functions/_lib/ai/adapters/gemini';
import { MODELS, modelById } from '../functions/_lib/ai/models';
import type { AiEnv, ChatRequest, ProviderEvent } from '../functions/_lib/ai/types';
import { DB_ENV, fakeDb, type FakeDb } from './helpers/fakeDb';
import { fixture, sseResponse } from './helpers/aiStreams';

const NOW = new Date(Date.UTC(2026, 9, 31));

describe('when to search', () => {
  it.each([
    ['What is the latest iPhone?', true],
    ['Who won the match yesterday?', true],
    ['petrol price in Hyderabad', true],
    ['Is the Charminar museum open on Mondays?', true],
    ['what happened in 2026 so far', true],
    ['summarise https://example.com/article', true],
    ['check vinaxmusic.online for me', true],
    ['Explain recursion', false],
    ['Write a poem about rain', false],
    ['What happened in 1947?', false],
    ['rename utils.py to helpers.py', false],
  ])('%s → %s', (text, want) => {
    expect(hasRecencyCue(text, NOW)).toBe(want);
  });
  it('the toggle wins: on always, off never', () => {
    expect(wantsSearch('Explain recursion', 'on', NOW)).toBe(true);
    expect(wantsSearch('latest news', 'off', NOW)).toBe(false);
    expect(wantsSearch('latest news', 'auto', NOW)).toBe(true);
  });
  it('news-like questions are news', () => {
    expect(topicOf('cricket score today')).toBe('news');
    expect(topicOf('history of the sitar')).toBe('general');
  });
});

describe('buildQuery', () => {
  it('uses the latest message, links cut to host names, no file text, ≤ 300 characters', () => {
    expect(buildQuery('What does https://www.example.com/a/b?x=1 say about ragas?')).toBe('What does example.com say about ragas?');
    expect(buildQuery('Summarise <document name="a.txt">secret text</document> latest news')).toBe('Summarise latest news');
    expect(buildQuery('x'.repeat(500))).toHaveLength(300);
  });
  it('a short follow-up borrows key words from the previous question', () => {
    expect(buildQuery('and tomorrow?', 'What is the weather in Hyderabad today?')).toBe('weather hyderabad today and tomorrow?');
    expect(buildQuery('What about the bowling figures in that match?', 'India vs Australia final score')).toBe('What about the bowling figures in that match?');
  });
});

describe('toSources', () => {
  it('numbers http(s) results, drops duplicates and other schemes, keeps six', () => {
    const raw = [
      { url: 'https://www.a.com/x', title: ' A  title ', snippet: 'one' },
      { url: 'https://www.a.com/x', title: 'dup' },
      { url: 'javascript:alert(1)', title: 'bad' },
      ...Array.from({ length: 8 }, (_, i) => ({ url: `https://s${i}.org/`, title: `S${i}` })),
    ];
    const out = toSources(raw);
    expect(out).toHaveLength(6);
    expect(out[0]).toEqual({ n: 1, url: 'https://www.a.com/x', title: 'A title', site: 'a.com', snippet: 'one' });
    expect(out.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('searchWeb', () => {
  let fake: FakeDb;
  let calls: Array<{ url: string; init?: RequestInit }>;
  let store: Map<string, Response>;
  let answer: (url: string) => Response;
  const env = (over: Partial<AiEnv> = {}): AiEnv => ({ ...DB_ENV, SEARCH_API_KEY: 'tvly-test', ...over });

  beforeEach(() => {
    _resetSearch();
    calls = [];
    store = new Map();
    answer = () => new Response(JSON.stringify({ results: [{ url: 'https://news.example.com/a', title: 'Result A', content: 'Snippet A' }] }), { status: 200 });
    fake = fakeDb({}, (url, init) => { calls.push({ url, init }); return answer(url); });
    fake.answer('rpc/ai_take_daily', () => new Response('true', { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('caches', { default: { match: async (k: string) => store.get(k)?.clone(), put: async (k: string, r: Response) => { store.set(k, r); } } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('Tavily: bearer key, the query and topic; results become sources; the answer is cached', async () => {
    const r = await searchWeb(env(), 'india final score', 'news');
    expect(r).toMatchObject({ ok: true, cached: false, provider: 'tavily', sources: [{ n: 1, site: 'news.example.com', title: 'Result A', snippet: 'Snippet A' }] });
    expect(calls[0].url).toBe('https://api.tavily.com/search');
    expect((calls[0].init?.headers as Record<string, string>).authorization).toBe('Bearer tvly-test');
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({ query: 'india final score', topic: 'news', max_results: 8 });
    const again = await searchWeb(env(), 'India Final Score', 'news');
    expect(again).toMatchObject({ ok: true, cached: true });
    expect(calls).toHaveLength(1);
    expect(fake.calls.filter((c) => c.table === 'rpc/ai_take_daily')).toHaveLength(1); // a cached answer is free
  });

  it('Serper: X-API-KEY and q; news endpoint for news', async () => {
    answer = () => new Response(JSON.stringify({ news: [{ link: 'https://s.example.org/n', title: 'N', snippet: 's' }] }), { status: 200 });
    const r = await searchWeb(env({ SEARCH_API_PROVIDER: 'serper' }), 'score today', 'news');
    expect(r).toMatchObject({ ok: true, provider: 'serper', sources: [{ url: 'https://s.example.org/n' }] });
    expect(calls[0].url).toBe('https://google.serper.dev/news');
    expect((calls[0].init?.headers as Record<string, string>)['X-API-KEY']).toBe('tvly-test');
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({ q: 'score today' });
  });

  it('the daily cap: a spent day makes no request', async () => {
    fake.answer('rpc/ai_take_daily', () => new Response('false', { status: 200, headers: { 'content-type': 'application/json' } }));
    expect(await searchWeb(env(), 'q', 'general')).toEqual({ ok: false, reason: 'daily_limit' });
    expect(calls).toHaveLength(0);
    expect(fake.calls.find((c) => c.table === 'rpc/ai_take_daily')?.body).toEqual({ p_kind: 'search', p_limit: 100 });
  });

  it('SEARCH_DAILY_LIMIT: default 100, 0 is off, junk is the default', () => {
    expect(dailyLimit({})).toBe(100);
    expect(dailyLimit({ SEARCH_DAILY_LIMIT: '0' })).toBe(0);
    expect(dailyLimit({ SEARCH_DAILY_LIMIT: '25' })).toBe(25);
    expect(dailyLimit({ SEARCH_DAILY_LIMIT: 'lots' })).toBe(100);
  });

  it('not configured without a key or with the limit at 0', async () => {
    expect(await searchWeb(env({ SEARCH_API_KEY: '' }), 'q', 'general')).toEqual({ ok: false, reason: 'not_configured' });
    expect(await searchWeb(env({ SEARCH_DAILY_LIMIT: '0' }), 'q', 'general')).toEqual({ ok: false, reason: 'not_configured' });
  });

  it.each([401, 402, 403, 429, 432, 433])('a %i rests the provider for a day', async (status) => {
    answer = () => new Response('{}', { status });
    expect(await searchWeb(env(), 'first', 'general')).toEqual({ ok: false, reason: 'failed' });
    expect(await searchWeb(env(), 'second', 'general')).toEqual({ ok: false, reason: 'resting' });
    expect(calls).toHaveLength(1);
  });

  it('a 500 does not rest it', async () => {
    answer = () => new Response('{}', { status: 500 });
    await searchWeb(env(), 'first', 'general');
    await searchWeb(env(), 'second', 'general');
    expect(calls).toHaveLength(2);
  });
});

describe('grounding', () => {
  const req = (over: Partial<ChatRequest> = {}): ChatRequest => ({
    model: modelById(MODELS, 'gemini:gemini-2.5-flash')!, system: 'S', messages: [{ role: 'user', text: 'who won' }], maxOutputTokens: 100,
    reasoning: 'default', webSearch: true, signal: new AbortController().signal, ...over,
  });
  afterEach(() => vi.unstubAllGlobals());

  it('only the 2.5 Flash models ground; Gemini 3.x does not (not free on the free tier)', () => {
    const grounded = MODELS.filter((m) => m.flags.grounding).map((m) => m.id);
    expect(grounded).toEqual(['gemini:gemini-2.5-flash', 'gemini:gemini-2.5-flash-lite']);
    expect(geminiBody(req())).toMatchObject({ tools: [{ googleSearch: {} }] });
    expect(geminiBody(req({ model: modelById(MODELS, 'gemini:gemini-3.6-flash')! }))).not.toHaveProperty('tools');
    expect(geminiBody(req({ webSearch: false }))).not.toHaveProperty('tools');
  });

  it('a grounded stream yields its sources (numbered, Google redirect links, the entry point) after the text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(fixture('gemini-grounded.sse'), 11)));
    const events: ProviderEvent[] = [];
    for await (const ev of gemini.stream({ GEMINI_API_KEY: 'k' }, req())) events.push(ev);
    const i = events.findIndex((e) => e.type === 'sources');
    expect(i).toBeGreaterThan(events.findIndex((e) => e.type === 'text'));
    const src = events[i] as Extract<ProviderEvent, { type: 'sources' }>;
    expect(src.items.map((s) => [s.n, s.site])).toEqual([[1, 'espncricinfo.com'], [2, 'bbc.com']]);
    expect(src.queries).toEqual(['india final result']);
    expect(src.entryPointHtml).toContain('class="chip"');
    expect(src.supports?.[0]).toMatchObject({ ns: [1, 2], text: 'India won the final by 6 runs.' });
  });

  it('when grounding itself is refused, asks once more without it', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return bodies.length === 1
        ? new Response('{"error":{"message":"Search Grounding is not supported for this key"}}', { status: 400 })
        : sseResponse('data: {"candidates":[{"content":{"parts":[{"text":"ok"}]},"finishReason":"STOP"}]}\n\n');
    }));
    const events: ProviderEvent[] = [];
    for await (const ev of gemini.stream({ GEMINI_API_KEY: 'k' }, req())) events.push(ev);
    expect(bodies[0]).toHaveProperty('tools');
    expect(bodies[1]).not.toHaveProperty('tools');
    expect(events.some((e) => e.type === 'sources')).toBe(false);
  });

  it('groundingEvent ignores chunks without links and out-of-range indices', () => {
    expect(groundingEvent({ groundingChunks: [] })).toBeNull();
    const ev = groundingEvent({ groundingChunks: [{ web: { uri: 'https://x', title: 'x.com' } }, {}], groundingSupports: [{ segment: { text: 'a', endIndex: 1 }, groundingChunkIndices: [0, 5] }] });
    expect(ev?.items).toHaveLength(1);
    expect(ev?.supports).toEqual([{ text: 'a', endIndex: 1, ns: [1] }]);
  });
});

describe('placeMarkers', () => {
  const text = 'India won the final by 6 runs. The next match is on Sunday — in Chennai.';
  it('puts [n] after each supported stretch, found by its text', () => {
    const m = placeMarkers(text, [{ text: 'India won the final by 6 runs.', endIndex: 30, ns: [1, 2] }, { text: 'The next match is on Sunday — in Chennai.', endIndex: 76, ns: [2] }]);
    expect(applyMarkers(text, m)).toBe('India won the final by 6 runs.[1][2] The next match is on Sunday — in Chennai.[2]');
  });
  it('falls back to the UTF-8 byte offset (non-ASCII text before it)', () => {
    const m = placeMarkers(text, [{ text: '', endIndex: new TextEncoder().encode(text).length, ns: [1] }]);
    expect(applyMarkers(text, m)).toBe(`${text}[1]`);
  });
  it('moves to the end of a word and never into a code block', () => {
    expect(applyMarkers('Hello world', placeMarkers('Hello world', [{ text: 'Hello wor', endIndex: -1, ns: [1] }]))).toBe('Hello world[1]');
    const code = 'See:\n```\nconst a = 1;\n```\nDone.';
    expect(placeMarkers(code, [{ text: 'const a', endIndex: -1, ns: [1] }])).toEqual([]);
  });
});
