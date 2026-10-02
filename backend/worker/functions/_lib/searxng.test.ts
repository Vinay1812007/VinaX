/**
 * The web search client: a validated base URL, a bounded call that never
 * throws, the token header, per-isolate rest after a failure, tag-free capped
 * results, and a log line that never carries the URL or the token.
 *
 * 9.0.1 — restored with the module; fencing is covered in websearch.test.ts.
 * 9.0.2 — the prompt formatting, freshness and music helpers came back with
 * the Search expert's grounding, and so did their tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  freshnessRange,
  looksMusical,
  parseSearxngBody,
  resetSearxngCooldown,
  restForHttp,
  resultsToContext,
  SEARXNG_AUTH_COOLDOWN_MS,
  searxngBase,
  searxngCoolingDown,
  searxngCoolingRemainingMs,
  searxngLastFailure,
  searxngQuery,
  searxngReady,
  searxngSearch,
  searxngUrlSet,
  songContext,
  timeoutLimitSeconds,
} from './searxng';

const ENV = { SEARXNG_URL: 'https://search.example.org/', SEARXNG_TOKEN: 'tok-123' };
const body = (results: unknown[], extra: Record<string, unknown> = {}) => ({ query: 'q', results, answers: [], infoboxes: [], suggestions: [], unresponsive_engines: [], ...extra });
const jsonRes = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

let calls: Array<{ url: string; headers: Record<string, string> }> = [];
function stubFetch(answer: (url: URL) => Response | Promise<Response>): void {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      calls.push({ url, headers: Object.fromEntries(new Headers(init?.headers).entries()) });
      return answer(new URL(url));
    }),
  );
}

beforeEach(() => resetSearxngCooldown());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('searxngBase', () => {
  it('accepts https (trailing slashes and a path tolerated) and http only for localhost', () => {
    expect(searxngBase({ SEARXNG_URL: 'https://search.example.org/' })).toBe('https://search.example.org');
    expect(searxngBase({ SEARXNG_URL: ' https://example.org/searxng// ' })).toBe('https://example.org/searxng');
    expect(searxngBase({ SEARXNG_URL: 'http://localhost:8888' })).toBe('http://localhost:8888');
    expect(searxngBase({ SEARXNG_URL: 'http://127.0.0.1:8888/' })).toBe('http://127.0.0.1:8888');
  });
  it('refuses plain http elsewhere, credentials, query strings, junk and unset', () => {
    for (const bad of ['http://search.example.org', 'https://u:p@search.example.org', 'https://search.example.org/?x=1', 'ftp://x.org', 'not a url', '', undefined]) {
      expect(searxngBase({ SEARXNG_URL: bad })).toBeNull();
    }
  });
});

describe('parseSearxngBody', () => {
  it('strips tags, drops non-http and duplicate urls, caps, and reads both answer shapes and the infobox', () => {
    const out = parseSearxngBody(
      body(
        [
          { url: 'https://a.example/1', title: '<b>Chuttamalle</b> &amp; more', content: '<em>Devara</em> song', engines: ['e1', 'e2'], score: 2.5, category: 'videos', author: 'Label', publishedDate: '2026-09-20T10:00:00' },
          { url: 'https://a.example/1', title: 'dup', content: '' },
          { url: 'javascript:alert(1)', title: 'bad' },
          { url: 'https://a.example/2', title: '' },
          { url: 'https://a.example/3', title: 'Third', engine: 'solo' },
          { url: 'https://a.example/4', title: 'Fourth' },
        ],
        { answers: ['Plain answer', { answer: 'Object <i>answer</i>', url: 'https://x' }], infoboxes: [{ infobox: 'Devara', content: 'A 2024 film' }], unresponsive_engines: [['slow-engine', 'timeout']], suggestions: ['devara songs'] },
      ),
      2,
    );
    expect(out.results).toEqual([
      { title: 'Chuttamalle & more', url: 'https://a.example/1', content: 'Devara song', engines: ['e1', 'e2'], category: 'videos', author: 'Label', publishedDate: new Date(Date.parse('2026-09-20T10:00:00')).toISOString(), score: 2.5 },
      { title: 'Third', url: 'https://a.example/3', content: '', engines: ['solo'], category: null, author: null, publishedDate: null, score: 0 },
    ]);
    expect(out.answers).toEqual(['Plain answer', 'Object answer']);
    expect(out.infobox).toBe('Devara: A 2024 film');
    expect(out.unresponsive).toEqual(['slow-engine']);
    expect(out.suggestions).toEqual(['devara songs']);
  });
  it('tolerates a body with nothing in it', () => {
    expect(parseSearxngBody(null, 5)).toEqual({ results: [], answers: [], infobox: null, suggestions: [], unresponsive: [] });
  });
});

describe('searxngQuery', () => {
  it('sends the JSON search with categories, language, time range and the bearer token', async () => {
    stubFetch(() => jsonRes(body([{ url: 'https://a.example/1', title: 'One' }])));
    const r = await searxngQuery(ENV, '  latest   telugu songs ', { categories: ['videos', 'music'], language: 'te', timeRange: 'week', pageno: 2, limit: 5 });
    expect(r.ok).toBe(true);
    expect(r.status).toBe('ok');
    expect(r.results.map((x) => x.title)).toEqual(['One']);
    const u = new URL(calls[0].url);
    expect(`${u.origin}${u.pathname}`).toBe('https://search.example.org/search');
    // timeout_limit: the default 5 s leash less 0.7 s, so the instance answers with what it has in time.
    expect(Object.fromEntries(u.searchParams)).toEqual({ q: 'latest telugu songs', format: 'json', categories: 'videos,music', timeout_limit: '4.3', language: 'te', time_range: 'week', pageno: '2' });
    expect(calls[0].headers.authorization).toBe('Bearer tok-123');
    expect(calls[0].headers['user-agent']).toMatch(/VinaX/);
  });

  it('sends no auth header without a token, and ignores unknown categories, languages and ranges', async () => {
    stubFetch(() => jsonRes(body([])));
    await searxngQuery({ SEARXNG_URL: 'http://localhost:8888' }, 'x', { categories: ['bogus' as never], language: 'te; drop', timeRange: 'decade' as never });
    const u = new URL(calls[0].url);
    expect(u.searchParams.get('categories')).toBe('general');
    expect(u.searchParams.has('language')).toBe(false);
    expect(u.searchParams.has('time_range')).toBe(false);
    expect(calls[0].headers.authorization).toBeUndefined();
  });

  it('does nothing at all when unset, or for an empty query', async () => {
    stubFetch(() => jsonRes(body([])));
    expect((await searxngQuery({}, 'songs')).status).toBe('not_configured');
    expect((await searxngQuery(ENV, '   ')).results).toEqual([]);
    expect(calls).toHaveLength(0);
    expect(searxngReady({})).toBe(false);
  });

  it('a 5xx answers [] and rests the instance: the next call spends nothing', async () => {
    stubFetch(() => new Response('oops', { status: 502 }));
    const r = await searxngQuery(ENV, 'songs');
    expect(r).toMatchObject({ ok: false, status: 'http_error', httpStatus: 502, results: [] });
    expect(searxngCoolingDown()).toBe(true);
    expect(searxngReady(ENV)).toBe(false);
    expect(await searxngSearch(ENV, 'songs')).toEqual([]);
    expect((await searxngQuery(ENV, 'songs')).status).toBe('cooling');
    expect(calls).toHaveLength(1);
  });

  it('a refused token rests for ten minutes, not one', async () => {
    const now = Date.now();
    stubFetch(() => new Response('no', { status: 401 }));
    await searxngQuery(ENV, 'songs');
    expect(searxngCoolingDown(now + 2 * 60_000)).toBe(true);
    expect(searxngCoolingDown(now + 11 * 60_000)).toBe(false);
  });

  it('an HTML page (json format switched off) is bad_json, and a network error is network — both rest', async () => {
    stubFetch(() => new Response('<html>search</html>', { status: 200 }));
    expect((await searxngQuery(ENV, 'songs')).status).toBe('bad_json');
    resetSearxngCooldown();
    stubFetch(() => Promise.reject(new TypeError('connection refused')));
    expect((await searxngQuery(ENV, 'songs')).status).toBe('network');
    expect(searxngCoolingDown()).toBe(true);
  });

  const hang = (): void => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_u: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))),
    );
  };

  it("a caller's own shorter leash times out WITHOUT resting the instance for everyone else", async () => {
    hang();
    const r = await searxngQuery(ENV, 'songs', { timeoutMs: 500 });
    expect(r.status).toBe('timeout');
    expect(searxngCoolingDown()).toBe(false);
    expect(searxngLastFailure()).toBeNull();
  });

  it('a timeout of the full default leash rests the instance', async () => {
    vi.useFakeTimers();
    try {
      hang();
      const p = searxngQuery(ENV, 'songs');
      await vi.advanceTimersByTimeAsync(5_000);
      expect((await p).status).toBe('timeout');
      expect(searxngCoolingDown()).toBe(true);
      expect(searxngLastFailure()).toMatchObject({ status: 'timeout', httpStatus: null });
    } finally {
      vi.useRealTimers();
    }
  });

  it('asks the instance to finish before the leash: leash − 0.7 s, at least 1 s', () => {
    expect(timeoutLimitSeconds(5_000)).toBe('4.3');
    expect(timeoutLimitSeconds(3_500)).toBe('2.8');
    expect(timeoutLimitSeconds(1_200)).toBe('1.0');
    expect(timeoutLimitSeconds(500)).toBe('1.0');
  });

  it('only 401 rests for ten minutes; 403, 429 and 5xx for one; a 400 or 404 rests nothing', async () => {
    expect([401, 403, 429, 500, 503, 400, 404].map(restForHttp)).toEqual([SEARXNG_AUTH_COOLDOWN_MS, 60_000, 60_000, 60_000, 60_000, 0, 0]);
    stubFetch(() => new Response('forbidden', { status: 403 }));
    await searxngQuery(ENV, 'songs');
    expect(searxngLastFailure()).toMatchObject({ status: 'http_error', httpStatus: 403 });
    const left = searxngCoolingRemainingMs();
    expect(left).toBeGreaterThan(50_000);
    expect(left).toBeLessThanOrEqual(60_000);
    resetSearxngCooldown();
    stubFetch(() => new Response('nope', { status: 404 }));
    expect((await searxngQuery(ENV, 'songs')).status).toBe('http_error');
    expect(searxngCoolingDown()).toBe(false);
  });

  it('an error answer is never read: its body is cancelled at once', async () => {
    let cancelled = false;
    const bodyStream = new ReadableStream<Uint8Array>({
      pull(c) {
        c.enqueue(new TextEncoder().encode('x'.repeat(1024)));
      },
      cancel() {
        cancelled = true;
      },
    });
    stubFetch(() => new Response(bodyStream, { status: 502 }));
    expect((await searxngQuery(ENV, 'songs')).status).toBe('http_error');
    expect(cancelled).toBe(true);
  });

  it('a body past the cap is cut off while streaming, reported too_large, and rests nothing', async () => {
    let sent = 0;
    let cancelled = false;
    const chunk = new TextEncoder().encode(`{"results":[${'{"url":"https://a.example/x","title":"t"},'.repeat(2_000)}`);
    const bodyStream = new ReadableStream<Uint8Array>({
      pull(c) {
        sent += chunk.byteLength;
        c.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    stubFetch(() => new Response(bodyStream, { status: 200 }));
    const r = await searxngQuery(ENV, 'songs');
    expect(r.status).toBe('too_large');
    expect(cancelled).toBe(true);
    // Stopped just past the 1.5 MB cap: never buffered an endless body.
    expect(sent).toBeLessThan(1_500_000 + 2 * chunk.byteLength);
    expect(searxngCoolingDown()).toBe(false);
  });

  it('searxngUrlSet tells a set-but-invalid address from an unset one', () => {
    expect(searxngUrlSet({ SEARXNG_URL: 'http://search.example.org' })).toBe(true);
    expect(searxngBase({ SEARXNG_URL: 'http://search.example.org' })).toBeNull();
    expect(searxngUrlSet({ SEARXNG_URL: '  ' })).toBe(false);
    expect(searxngUrlSet({})).toBe(false);
  });

  it("the caller's own abort does not rest the instance", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_u: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))),
    );
    const ctrl = new AbortController();
    const p = searxngQuery(ENV, 'songs', { signal: ctrl.signal, timeoutMs: 5_000 });
    ctrl.abort();
    expect((await p).status).toBe('timeout');
    expect(searxngCoolingDown()).toBe(false);
  });

  it('logs one line with status and latency: at most 60 query characters, never the URL or the token', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    stubFetch(() => jsonRes(body([{ url: 'https://a.example/1', title: 'One' }])));
    await searxngQuery(ENV, `${'x'.repeat(70)} SECRETTAIL`, { tag: 'unit' });
    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0][0]);
    expect(line).toMatch(/^\[searxng\] unit q="x{60}" cat=general status=ok http=200 n=1 ms=\d+$/);
    expect(line).not.toMatch(/SECRETTAIL|search\.example\.org|tok-123/);
  });
});

describe('helpers', () => {
  it('freshnessRange reads the time window a question asks about', () => {
    expect(freshnessRange('who won today')).toBe('day');
    expect(freshnessRange('trending hindi songs this week')).toBe('week');
    expect(freshnessRange('latest telugu songs')).toBe('month');
    expect(freshnessRange('new tamil releases')).toBe('month');
    expect(freshnessRange(`best songs of ${new Date().getUTCFullYear()}`)).toBe('year');
    expect(freshnessRange('classic ilaiyaraaja melodies')).toBeNull();
  });

  it('resultsToContext numbers title + snippet lines, with the date when there is one', () => {
    const text = resultsToContext([
      { title: 'A', url: 'https://a', content: 'snip', engines: [], category: null, author: null, publishedDate: '2026-09-01T00:00:00.000Z', score: 1 },
      { title: 'B', url: 'https://b', content: '', engines: [], category: null, author: null, publishedDate: null, score: 1 },
    ]);
    expect(text).toBe('[1] A — snip (2026-09-01)\n[2] B');
  });

  it('songContext keeps only musical results, best score first, from video + music categories', async () => {
    stubFetch(() =>
      jsonRes(
        body([
          { url: 'https://a/1', title: 'Debian Documentation in Telugu', score: 9 },
          { url: 'https://a/2', title: 'Endhayya Saami | Ranabaali | Full Song', score: 1 },
          { url: 'https://a/3', title: 'Narayanamma Lyric Video | Aadarsha Kutumbam', score: 3 },
        ]),
      ),
    );
    const ctx = await songContext(ENV, 'new telugu songs', { tag: 'unit', timeRange: 'month' });
    expect(ctx?.count).toBe(2);
    expect(ctx?.text.split('\n')).toEqual(['[1] Narayanamma Lyric Video | Aadarsha Kutumbam', '[2] Endhayya Saami | Ranabaali | Full Song']);
    const u = new URL(calls[0].url);
    expect(u.searchParams.get('categories')).toBe('videos,music');
    expect(u.searchParams.get('time_range')).toBe('month');
    expect(looksMusical('Patta new rules in Tamil')).toBe(false);
  });

  it('songContext reuses an answer for the same query for a while, per isolate', async () => {
    stubFetch(() => jsonRes(body([{ url: 'https://a/2', title: 'Endhayya Saami | Ranabaali | Full Song', score: 1 }])));
    const first = await songContext(ENV, 'new telugu songs', { tag: 'unit', timeRange: 'month' });
    const again = await songContext(ENV, '  New Telugu   songs ', { tag: 'unit', timeRange: 'month' });
    expect(again).toEqual(first);
    expect(calls).toHaveLength(1);
    // Another query, time range or size is another entry.
    await songContext(ENV, 'new telugu songs', { tag: 'unit', timeRange: 'week' });
    expect(calls).toHaveLength(2);
    // After fifteen minutes the instance is asked again.
    const later = Date.now() + 16 * 60_000;
    vi.spyOn(Date, 'now').mockReturnValue(later);
    await songContext(ENV, 'new telugu songs', { tag: 'unit', timeRange: 'month' });
    expect(calls).toHaveLength(3);
  });

  it('songContext does not keep a failure: the next call asks again once the rest is over', async () => {
    stubFetch(() => new Response('', { status: 404 }));
    expect(await songContext(ENV, 'q', { tag: 'unit' })).toBeNull();
    stubFetch(() => jsonRes(body([{ url: 'https://a/2', title: 'Endhayya Saami | Ranabaali | Full Song', score: 1 }])));
    expect((await songContext(ENV, 'q', { tag: 'unit' }))?.count).toBe(1);
  });

  it('songContext is null when unset or resting, without a call', async () => {
    stubFetch(() => jsonRes(body([])));
    expect(await songContext({}, 'x', { tag: 'unit' })).toBeNull();
    stubFetch(() => new Response('', { status: 500 }));
    await searxngQuery(ENV, 'x');
    const before = calls.length;
    expect(await songContext(ENV, 'x', { tag: 'unit' })).toBeNull();
    expect(calls.length).toBe(before);
  });
});
