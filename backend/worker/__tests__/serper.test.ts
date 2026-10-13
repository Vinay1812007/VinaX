/**
 * 11.8 — _lib/serper.ts: the response mapping, the credit guards (edge cache,
 * daily cap, out-of-credits rest), failure → empty results, and the query
 * builder. fetch and caches are mocked everywhere: no test reaches Serper.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildSearchQuery,
  cleanForQuery,
  creditsExhausted,
  mapSerperResponse,
  resetSerperState,
  serperCacheKey,
  serperDailyLimit,
  serperSearch,
  serperResting,
  SERPER_NEWS_URL,
  SERPER_SEARCH_URL,
} from '../functions/_lib/serper';

const KEY = 'serper-test-key-0123456789';
const ENV = { SERPER_API_KEY: KEY };
const DB = { SUPABASE_URL: 'https://db.example.test', SUPABASE_SERVICE_ROLE_KEY: 'svc' };

const ORGANIC = {
  searchParameters: { q: 'x', gl: 'in', hl: 'en' },
  answerBox: { snippet: 'The <b>answer</b> &amp; more' },
  knowledgeGraph: { description: 'A graph description' },
  organic: [
    { title: 'One <em>first</em>', link: 'https://one.example/a', snippet: 'Snippet <b>one</b>', position: 1 },
    { title: 'Not web', link: 'ftp://two.example/b', snippet: 'skip me' },
    { title: 'Script', link: 'javascript:alert(1)', snippet: 'skip me' },
    { title: 'x'.repeat(300), link: 'http://three.example/c', snippet: 'y'.repeat(900) },
    { title: 'Dup', link: 'https://one.example/a', snippet: 'dup' },
    { title: 'Four', link: 'https://four.example/' },
    { title: 'Five', link: 'https://five.example/', snippet: 's5' },
    { title: 'Six', link: 'https://six.example/', snippet: 's6' },
    { title: 'Seven', link: 'https://seven.example/', snippet: 's7' },
  ],
};

interface Seen { url: string; init?: RequestInit }
function stubFetch(answer: (url: string, init?: RequestInit) => Response | Promise<Response>): Seen[] {
  const seen: Seen[] = [];
  vi.stubGlobal('fetch', vi.fn(async (u: unknown, init?: RequestInit) => {
    const url = String(u);
    seen.push({ url, init });
    return answer(url, init);
  }));
  return seen;
}
const serperCalls = (seen: Seen[]): Seen[] => seen.filter((s) => s.url.startsWith('https://google.serper.dev/'));
const ok = (j: unknown): Response => new Response(JSON.stringify(j), { status: 200, headers: { 'content-type': 'application/json' } });

function memoryCache(): Map<string, Response> {
  const store = new Map<string, Response>();
  vi.stubGlobal('caches', {
    default: {
      match: async (k: Request) => store.get(k.url)?.clone(),
      put: async (k: Request, r: Response) => {
        store.set(k.url, r.clone());
      },
    },
  });
  return store;
}

beforeEach(() => resetSerperState());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('mapSerperResponse', () => {
  it('keeps at most 5 http(s) results, de-duplicated, markup stripped and clipped', () => {
    const out = mapSerperResponse(ORGANIC);
    expect(out.results.map((r) => r.url)).toEqual(['https://one.example/a', 'http://three.example/c', 'https://four.example/', 'https://five.example/', 'https://six.example/']);
    expect(out.results[0]).toEqual({ url: 'https://one.example/a', title: 'One first', snippet: 'Snippet one' });
    expect(out.results[1].title.length).toBeLessThanOrEqual(160);
    expect(out.results[1].snippet.length).toBeLessThanOrEqual(400);
    expect(out.results[2].snippet).toBe('');
    for (const r of out.results) expect(`${r.title}${r.snippet}`).not.toMatch(/[<>]/);
  });

  it('quick = answerBox.answer, else answerBox.snippet, else knowledgeGraph.description (≤ 400)', () => {
    expect(mapSerperResponse({ ...ORGANIC, answerBox: { answer: '42', snippet: 'no' } }).quick).toBe('42');
    expect(mapSerperResponse(ORGANIC).quick).toBe('The answer & more');
    expect(mapSerperResponse({ organic: [], knowledgeGraph: { description: 'k'.repeat(900) } }).quick?.length).toBeLessThanOrEqual(400);
    expect(mapSerperResponse({ organic: [] })).toEqual({ results: [] });
  });

  it('reads news[] for the news endpoint, and survives junk', () => {
    const news = { news: [{ title: 'Headline', link: 'https://news.example/1', snippet: 'Today', date: '1 hour ago', source: 'X' }], organic: [{ title: 'no', link: 'https://no.example' }] };
    expect(mapSerperResponse(news, true).results).toEqual([{ url: 'https://news.example/1', title: 'Headline', snippet: 'Today' }]);
    for (const junk of [null, 'x', 42, [], { organic: 'nope' }, { organic: [null, 1, { link: 'https://a.example' }] }]) expect(mapSerperResponse(junk).results).toEqual([]);
  });
});

describe('creditsExhausted', () => {
  it('401, 402, 403 and 429, or a 400 that names credits or quota', () => {
    for (const s of [401, 402, 403, 429]) expect(creditsExhausted(s, '')).toBe(true);
    expect(creditsExhausted(400, '{"message":"Not enough credits"}')).toBe(true);
    expect(creditsExhausted(400, 'Quota exceeded')).toBe(true);
    expect(creditsExhausted(400, 'Missing query')).toBe(false);
    expect(creditsExhausted(500, 'credits')).toBe(false);
  });
});

describe('serperSearch', () => {
  it('POSTs { q, gl, hl, num ≤ 10 } with the key header only, and returns the mapped results', async () => {
    memoryCache();
    const seen = stubFetch(() => ok(ORGANIC));
    const out = await serperSearch(ENV, '  Weather   in Hyderabad today ', { country: 'GB', lang: 'te' });
    expect(out.results).toHaveLength(5);
    expect(out.quick).toBe('The answer & more');
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe(SERPER_SEARCH_URL);
    expect(seen[0].init?.method).toBe('POST');
    expect((seen[0].init?.headers as Record<string, string>)['X-API-KEY']).toBe(KEY);
    expect(seen[0].init?.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(String(seen[0].init?.body)) as Record<string, unknown>;
    expect(body).toEqual({ q: 'Weather in Hyderabad today', gl: 'gb', hl: 'te', num: 10 });
    expect(JSON.stringify(out)).not.toContain(KEY);
  });

  it('uses the news endpoint for news, and defaults gl to "in" and hl to "en"', async () => {
    memoryCache();
    const seen = stubFetch(() => ok({ news: [] }));
    await serperSearch(ENV, 'cricket news', { news: true, country: 'not-a-country', lang: null });
    expect(seen[0].url).toBe(SERPER_NEWS_URL);
    expect(JSON.parse(String(seen[0].init?.body))).toMatchObject({ gl: 'in', hl: 'en' });
  });

  it('does nothing without a key or a query', async () => {
    const seen = stubFetch(() => ok(ORGANIC));
    expect(await serperSearch({}, 'news today')).toEqual({ results: [] });
    expect(await serperSearch({ SERPER_API_KEY: '   ' }, 'news today')).toEqual({ results: [] });
    expect(await serperSearch(ENV, '   ')).toEqual({ results: [] });
    expect(seen).toHaveLength(0);
  });

  it('a timeout, a network error, a 5xx or an unreadable body is empty results — never a throw', async () => {
    memoryCache();
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    stubFetch(() => Promise.reject(timeout));
    expect(await serperSearch(ENV, 'q one today')).toEqual({ results: [] });
    stubFetch(() => Promise.reject(new TypeError('network')));
    expect(await serperSearch(ENV, 'q two today')).toEqual({ results: [] });
    stubFetch(() => new Response('upstream', { status: 503 }));
    expect(await serperSearch(ENV, 'q three today')).toEqual({ results: [] });
    stubFetch(() => new Response('not json', { status: 200 }));
    expect(await serperSearch(ENV, 'q four today')).toEqual({ results: [] });
    // None of those is an out-of-credits answer.
    expect(serperResting()).toBe(false);
  });

  it('an out-of-credits answer stops every call for 24 h, logged once, never with the key', async () => {
    memoryCache();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const seen = stubFetch(() => new Response('{"message":"Not enough credits"}', { status: 400 }));
    expect(await serperSearch(ENV, 'first query today')).toEqual({ results: [] });
    expect(serperResting()).toBe(true);
    expect(serperResting(Date.now() + 25 * 60 * 60_000)).toBe(false);
    expect(await serperSearch(ENV, 'second query today')).toEqual({ results: [] });
    expect(serperCalls(seen)).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).not.toContain(KEY);
    for (const status of [401, 402, 403, 429]) {
      resetSerperState();
      stubFetch(() => new Response('', { status }));
      await serperSearch(ENV, `query ${status}`);
      expect(serperResting()).toBe(true);
    }
  });

  it('a cache hit spends nothing; results and empty answers are cached with their own lifetimes', async () => {
    const store = memoryCache();
    const seen = stubFetch(() => ok(ORGANIC));
    const first = await serperSearch(ENV, 'Weather Hyderabad TODAY');
    const again = await serperSearch(ENV, '  weather   hyderabad today ');
    expect(serperCalls(seen)).toHaveLength(1);
    expect(again).toEqual(first);
    const key = serperCacheKey('https://serper-cache.vinax.internal', false, 'weather hyderabad today', 'in').url;
    expect(store.get(key)?.headers.get('cache-control')).toBe('public, max-age=3600');
    // A different country is a different entry.
    await serperSearch(ENV, 'weather hyderabad today', { country: 'us' });
    expect(serperCalls(seen)).toHaveLength(2);
    // News: 15 minutes. Empty: 2 minutes.
    stubFetch(() => ok({ news: [{ title: 'N', link: 'https://n.example/' }] }));
    await serperSearch(ENV, 'cricket news', { news: true });
    expect(store.get(serperCacheKey('https://serper-cache.vinax.internal', true, 'cricket news', 'in').url)?.headers.get('cache-control')).toBe('public, max-age=900');
    stubFetch(() => ok({ organic: [] }));
    await serperSearch(ENV, 'gibberish zzqx today');
    expect(store.get(serperCacheKey('https://serper-cache.vinax.internal', false, 'gibberish zzqx today', 'in').url)?.headers.get('cache-control')).toBe('public, max-age=120');
  });

  it('a failed call is not cached (the next turn may try again)', async () => {
    const store = memoryCache();
    stubFetch(() => new Response('', { status: 500 }));
    await serperSearch(ENV, 'flaky today');
    expect(store.size).toBe(0);
  });

  it('the daily cap blocks calls once SERPER_DAILY_LIMIT successful calls are made (isolate count, no database)', async () => {
    memoryCache();
    const seen = stubFetch(() => ok(ORGANIC));
    const env = { ...ENV, SERPER_DAILY_LIMIT: '2' };
    await serperSearch(env, 'one today');
    await serperSearch(env, 'two today');
    expect(await serperSearch(env, 'three today')).toEqual({ results: [] });
    expect(serperCalls(seen)).toHaveLength(2);
    // 0 means no calls at all; junk means the default.
    expect(await serperSearch({ ...ENV, SERPER_DAILY_LIMIT: '0' }, 'four today')).toEqual({ results: [] });
    expect(serperCalls(seen)).toHaveLength(2);
    expect(serperDailyLimit({})).toBe(80);
    expect(serperDailyLimit({ SERPER_DAILY_LIMIT: 'lots' })).toBe(80);
    expect(serperDailyLimit({ SERPER_DAILY_LIMIT: ' 120 ' })).toBe(120);
  });

  it('the daily cap reads today\'s logged web-search rows, and each call is logged without the query or key', async () => {
    memoryCache();
    let today = 79;
    const logged: Record<string, unknown>[] = [];
    const seen = stubFetch((url, init) => {
      if (url.includes('/rest/v1/vinax_ai_events') && (init?.method ?? 'GET') === 'GET') return new Response('[]', { status: 200, headers: { 'content-range': `0-0/${today}` } });
      if (url.includes('/rest/v1/vinax_ai_events')) {
        logged.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(null, { status: 201 });
      }
      return ok(ORGANIC);
    });
    const waits: Promise<unknown>[] = [];
    await serperSearch({ ...ENV, ...DB }, 'secret topic today', { waitUntil: (p) => waits.push(p), client: 'app' });
    await Promise.all(waits);
    const countRead = seen.find((s) => s.url.includes('/rest/v1/vinax_ai_events') && !s.init?.body);
    expect(countRead?.url).toContain('feature=eq.web-search');
    expect(countRead?.url).toContain('model=eq.serper');
    expect(countRead?.url).toContain('ok=eq.true');
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ feature: 'web-search', model: 'serper', ok: true, status: 200, client: 'app' });
    expect(JSON.stringify(logged)).not.toContain('secret topic');
    expect(JSON.stringify(logged)).not.toContain(KEY);
    // 79 logged + this isolate's 1 = the default cap of 80: the next call is refused.
    today = 79;
    expect(await serperSearch({ ...ENV, ...DB }, 'another topic today')).toEqual({ results: [] });
    expect(serperCalls(seen)).toHaveLength(1);
  });

  it('the database already at the cap means no call at all', async () => {
    memoryCache();
    const seen = stubFetch((url) => (url.includes('/rest/v1/') ? new Response('[]', { status: 200, headers: { 'content-range': '0-0/80' } }) : ok(ORGANIC)));
    expect(await serperSearch({ ...ENV, ...DB }, 'news today')).toEqual({ results: [] });
    expect(serperCalls(seen)).toHaveLength(0);
  });
});

describe('websites (11.8.1)', () => {
  it('mentionsSite: a domain or a link, not code, abbreviations or an email address', async () => {
    const { mentionsSite } = await import('../functions/_lib/serper');
    for (const yes of ['sportsmart.com', 'what is sportsmart.com?', 'is www.example.in down', 'https://news.example.org/a/b', 'check vinax.app', '(see example.co.uk)']) expect(mentionsSite(yes)).toBe(true);
    for (const no of ['node.js is great', 'e.g. this', 'i.e. that', 'mail me at a@b.com', 'console.log(x)', 'version 1.2.3', 'plain words']) expect(mentionsSite(no)).toBe(false);
  });

  it('a bare domain is searched as itself, never padded with the previous message', () => {
    expect(buildSearchQuery('sportsmart.com', 'Tell me about Pushpa 3')).toBe('sportsmart.com');
    expect(buildSearchQuery('what is https://shop.example.com/p/123?token=abc', 'earlier topic here')).toBe('what is shop.example.com');
  });
});

describe('buildSearchQuery', () => {
  it('drops attached file text, fenced code and URLs, and collapses whitespace', () => {
    const msg = 'What is the   latest version of React?\n```js\nconsole.log(1)\n```\nsee https://example.com/x?y=1 and www.example.org\n\n--- File: notes.txt ---\nsecret notes 2026 news\n\n--- File: b.pdf (excerpt) ---\nmore';
    const q = buildSearchQuery(msg);
    // A link keeps only its host: never a path, a query or a token.
    expect(q).toBe('What is the latest version of React? see example.com and example.org');
    expect(cleanForQuery('--- File: a.txt ---\nonly a file')).toBe('');
    expect(buildSearchQuery('\n\n--- File: a.txt ---\nonly a file', 'previous')).toBe('');
  });

  it('clips to 300 characters', () => {
    const long = Array.from({ length: 120 }, (_, i) => `word${i}`).join(' ');
    expect(buildSearchQuery(long).length).toBeLessThanOrEqual(300);
    expect(buildSearchQuery(long, 'Pushpa movie release').length).toBeLessThanOrEqual(300);
  });

  it('a follow-up gets up to 8 content words of the previous user message', () => {
    const prev = 'Tell me about the new Pushpa 3 movie starring Allu Arjun and directed by Sukumar with music';
    expect(buildSearchQuery('when is it releasing?', prev)).toBe('new Pushpa 3 movie starring Allu Arjun directed when is it releasing?');
    expect(buildSearchQuery('it is out today?', 'Coldplay new album')).toBe('Coldplay new album it is out today?');
    expect(buildSearchQuery('release date?', 'Coldplay new album')).toBe('Coldplay new album release date?');
    // A self-contained question stays as it is, and so does a follow-up with nothing before it.
    expect(buildSearchQuery('who won the IPL final in 2026 yesterday', prev)).toBe('who won the IPL final in 2026 yesterday');
    expect(buildSearchQuery('when is it releasing?')).toBe('when is it releasing?');
    // The previous message's files, code and links never leak in.
    expect(buildSearchQuery('price today?', 'Pixel phone https://shop.example/p?token=abc\n\n--- File: x.txt ---\nprivate')).toBe('Pixel phone shop.example price today?');
  });
});
