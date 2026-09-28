/**
 * 8.3.0 — liveSearch: the owner's SearXNG instance leads when configured
 * (general results, plus news in the question's time window when it is
 * time-sensitive, answers and the infobox first); the keyless sources are the
 * fallback when it is unset, resting or empty. The SearchHit shape is unchanged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { liveSearch, searxngHit } from './websearch';
import { resetSearxngCooldown } from './searxng';

const ENV = { SEARXNG_URL: 'https://search.example.org' };
const jsonRes = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const DDG_HTML = '<a class="result__a" href="https://fallback.example/page">Fallback title</a><a class="result__snippet">fallback snippet</a>';

let seen: string[] = [];
function stubFetch(searx: (u: URL) => Response): void {
  seen = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      seen.push(url);
      const u = new URL(url);
      if (u.hostname === 'search.example.org') return searx(u);
      if (u.hostname === 'html.duckduckgo.com') return new Response(DDG_HTML, { status: 200 });
      return new Response('', { status: 404 });
    }),
  );
}

beforeEach(() => {
  resetSearxngCooldown();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('liveSearch with SearXNG configured', () => {
  it('a timeless question: one general search, answers and infobox lead, no fallback source is called', async () => {
    stubFetch((u) =>
      jsonRes({
        results: [
          { url: 'https://a.example/1', title: 'Ilaiyaraaja', content: 'Composer', score: 3 },
          { url: 'https://a.example/2', title: 'Discography', content: 'Albums', score: 1 },
        ],
        answers: [{ answer: 'Ilaiyaraaja is a composer' }],
        infoboxes: [{ infobox: 'Ilaiyaraaja', content: 'Indian composer' }],
        category: u.searchParams.get('categories'),
      }),
    );
    const hit = await liveSearch(ENV, 'who is ilaiyaraaja');
    expect(seen.every((s) => s.startsWith('https://search.example.org/search?'))).toBe(true);
    expect(seen).toHaveLength(1);
    expect(new URL(seen[0]).searchParams.get('categories')).toBe('general');
    expect(hit?.sources).toEqual(['https://a.example/1', 'https://a.example/2']);
    expect(hit?.text.split('\n').slice(0, 3)).toEqual(['Direct answer: Ilaiyaraaja is a composer', 'Summary: Ilaiyaraaja: Indian composer', '']);
    expect(hit?.text).toContain('[1] Ilaiyaraaja\nComposer\nhttps://a.example/1');
  });

  it('a time-sensitive question adds news in its time window, news first', async () => {
    stubFetch((u) =>
      u.searchParams.get('categories') === 'news'
        ? jsonRes({ results: [{ url: 'https://news.example/1', title: 'Fresh release', content: 'out this week', publishedDate: '2026-09-25T00:00:00Z' }] })
        : jsonRes({ results: [{ url: 'https://a.example/1', title: 'Evergreen page' }] }),
    );
    const hit = await liveSearch(ENV, 'trending hindi songs this week');
    const news = seen.map((s) => new URL(s)).find((u) => u.searchParams.get('categories') === 'news');
    expect(news?.searchParams.get('time_range')).toBe('week');
    expect(hit?.sources).toEqual(['https://news.example/1', 'https://a.example/1']);
    expect(hit?.text).toContain('out this week (2026-09-25)');
  });

  it('SearXNG empty → the keyless sources answer, same shape', async () => {
    stubFetch(() => jsonRes({ results: [] }));
    const hit = await liveSearch(ENV, 'something obscure');
    expect(seen.some((s) => s.includes('html.duckduckgo.com'))).toBe(true);
    expect(hit).toEqual({ text: '[1] Fallback title\nfallback snippet\nhttps://fallback.example/page', sources: ['https://fallback.example/page'] });
  });

  it('SearXNG down → fallback now, and the next search skips it entirely while it rests', async () => {
    stubFetch(() => new Response('bad gateway', { status: 502 }));
    expect((await liveSearch(ENV, 'q one'))?.sources).toEqual(['https://fallback.example/page']);
    const searxCalls = seen.filter((s) => s.startsWith('https://search.example.org')).length;
    await liveSearch(ENV, 'q two');
    expect(seen.filter((s) => s.startsWith('https://search.example.org')).length).toBe(searxCalls);
    expect(await searxngHit(ENV, 'q three')).toBeNull();
  });
});

describe('liveSearch without SearXNG', () => {
  it('never calls it and keeps the previous sources', async () => {
    stubFetch(() => jsonRes({ results: [{ url: 'https://a.example/1', title: 'x' }] }));
    const hit = await liveSearch({}, 'latest telugu songs');
    expect(seen.some((s) => s.includes('search.example.org'))).toBe(false);
    expect(hit?.sources).toEqual(['https://fallback.example/page']);
  });
});
