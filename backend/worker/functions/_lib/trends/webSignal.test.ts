/**
 * 8.3.0 — the `web` trend source. Pins: only one-song uploads survive the
 * heuristic (titles below are real results from a live probe, 2026-09-28);
 * mentions merge across queries and languages; the source runs only with
 * SEARXNG_URL; a dead instance is a retryable failure; and — the point of the
 * design — even a confident catalogue match is filed for review, never shown.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSearxngCooldown, type SearxngResponse, type SearxngResult } from '../searxng';
import { createFakeRest, type FakeRest } from './fakeRest.testutil';
import { holdForReview, providerBudget, runIngest } from './ingest';
import type { CatalogCandidate, MatchDecision } from './matcher';
import { PROVIDERS, providerById } from './registry';
import { TrendFetchError } from './types';
import { extractWebCandidates, looksLikeOneSong, mentionKey, toRawItems, webLanguages, webQueries, webRunFailure, webSignalProvider } from './webSignal';
import { editorialProvider } from './editorial';

const result = (title: string, over: Partial<SearxngResult> = {}): SearxngResult => ({ title, url: `https://v.example/${encodeURIComponent(title).slice(0, 40)}`, content: '', engines: ['e1'], category: 'videos', author: null, publishedDate: null, score: 1, ...over });
const ok = (results: SearxngResult[]): SearxngResponse => ({ ok: true, status: 'ok', httpStatus: 200, latencyMs: 10, results, answers: [], infobox: null, suggestions: [], unresponsive: [] });

beforeEach(() => {
  resetSearxngCooldown();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('looksLikeOneSong', () => {
  it('keeps song uploads', () => {
    for (const t of [
      'Endhayya Saami | Ranabaali | Full Song | Vijay Deverakonda, Rashmika | Rahul Sankrityan | Ajay–Atul | Music Label',
      'Narayanamma Lyric Video | Aadarsha Kutumbam | Venkatesh, Srinidhi, Nivetha, Dimple Hayati | Thaman S | Music Label',
      'Vibe Venuma - Music Video | Meesaya Murukku 2 | Hiphop Tamizha | VJ Siddhu',
      'Sulochana - Lyrical | Sigma (Telugu) | Catherine Tresa Alexander | Sundeep | Thaman S',
      'SAMMAKKA Full Song | The Paradise | Nani | Anirudh Ravichander | Srikanth Odela | Folk Songs Telugu | Music Label',
    ]) expect(looksLikeOneSong(t), t).toBe(true);
  });

  it('drops lists, generic pages, non-music and non-songs', () => {
    for (const t of [
      'New Tollywood Hits Musical Video Playlist | Latest Telugu Songs | Yaalalo Yaalalo | Guruthunda',
      'The Paradise - Audio Jukebox | Nani | Kayadu Lohar | Anirudh Ravichander',
      'Latest Telugu Romantic Songs | Trending Love Hits - Video Site',
      'Hindi sad songs new | songs breakup | Heart Touching Sad Songs |breakup songs 2022 | sad mashup song',
      'Teen Dress Style Shootout | Which One Wins? | Youth Fashion Trends',
      'Iron Heart | M-alasle | Powerful Music Edit | Dark Cinematic Vibes | Veloura Edits',
      'Trending Songs 2026 ❤️ Best Romantic Songs | Latest Bollywood Songs 2026 | New Hindi Love Song',
      'New Live',
      'Debian Documentation in Telugu',
      'Devara Trailer | NTR | Telugu',
      'Chuttamalle #shorts | Telugu song',
    ]) expect(looksLikeOneSong(t), t).toBe(false);
  });
});

describe('extractWebCandidates', () => {
  it('merges one song across queries and languages, sums agreement, ranks and drops junk', () => {
    const endhayya = 'Endhayya Saami | Ranabaali | Full Song | Vijay Deverakonda, Rashmika | Rahul Sankrityan';
    const out = extractWebCandidates([
      { language: 'telugu', query: 'new telugu songs', res: ok([result(endhayya, { score: 1.6, engines: ['e1', 'e2'], author: 'Label' }), result('Latest Telugu Songs | Playlist'), result('Narayanamma Lyric Video | Aadarsha Kutumbam | Thaman S', { score: 5 })]) },
      { language: 'telugu', query: 'trending telugu songs this week', res: ok([result(`${endhayya} | Label`, { url: 'https://v.example/other', score: 2 })]) },
      { language: 'tamil', query: 'new tamil songs', res: ok([result(endhayya, { score: 0.5 })]) },
    ]);
    expect(out.map((c) => c.title)).toEqual(['Narayanamma Lyric Video | Aadarsha Kutumbam | Thaman S', endhayya]);
    const e = out[1];
    expect(e.languages).toEqual(['telugu', 'tamil']);
    expect(e.queries).toEqual(['new telugu songs', 'trending telugu songs this week', 'new tamil songs']);
    expect(e.engines).toEqual(['e1', 'e2']);
    expect(e.author).toBe('Label');
    expect(e.score).toBeCloseTo(1.6 + 0.25 + 2 + 0.5, 5);
    expect(mentionKey(endhayya)).toBe(mentionKey(`${endhayya} | Label`));
  });

  it('never gives two songs, or two versions of one song, the same identity (a reviewed mapping is reused by it)', async () => {
    const remix = 'Chuttamalle (DJ Remix) | Devara | Telugu Song';
    const lyrical = '#Chuttamalle Lyrical Video Song | Devara | Telugu';
    const fullVideo = 'Chuttamalle Full Video Song | Devara | Telugu';
    const neeveA = 'Neeve Neeve Song | Amma Nanna O Tamila Ammayi | Ravi Teja';
    const neeveB = 'Neeve Neeve | Happy | Allu Arjun | Telugu';
    const neeveFrom = 'Neeve Neeve (From "Happy") | Telugu';
    expect(mentionKey(remix)).not.toBe(mentionKey(lyrical));
    expect(mentionKey(neeveA)).not.toBe(mentionKey(neeveB));
    // Two uploads of the SAME song and version still merge.
    expect(mentionKey(lyrical)).toBe(mentionKey(fullVideo));
    // A title with no film segment is told apart by its uploader.
    expect(mentionKey('Neeve Neeve - Telugu Song', 'Label A')).not.toBe(mentionKey('Neeve Neeve - Telugu Song', 'Label B'));
    expect(mentionKey(neeveFrom, 'Label A')).toBe(mentionKey(neeveFrom, 'Label B'));

    const cands = extractWebCandidates([{ language: 'telugu', query: 'q', res: ok([result(remix, { score: 3 }), result(lyrical, { score: 2 }), result(neeveA, { score: 1.5 }), result(neeveB, { score: 1 })]) }]);
    expect(cands).toHaveLength(4);
    const items = await toRawItems(cands, 'IN', '2026-09-28T06:00:00.000Z');
    expect(new Set(items.map((i) => i.sourceItemId)).size).toBe(4);
  });

  it('keeps at most twelve per leading language', () => {
    const many = Array.from({ length: 20 }, (_, i) => result(`Song Number ${String.fromCharCode(65 + i)}${String.fromCharCode(65 + i)} | Film ${i} | Full Song`, { score: 20 - i }));
    expect(extractWebCandidates([{ language: 'hindi', query: 'q', res: ok(many) }])).toHaveLength(12);
  });
});

describe('webSignalProvider', () => {
  it('is registered last, is its own `web` kind, review-gated, capped to a third of the match budget, and needs SEARXNG_URL', () => {
    expect(PROVIDERS.map((p) => p.id)).toEqual(['youtube', 'instagram', 'editorial', 'web']);
    expect(providerById('web')).toBe(webSignalProvider);
    expect(webSignalProvider.kind).toBe('web');
    expect(webSignalProvider.maxMatchShare).toBeCloseTo(1 / 3, 5);
    expect(webSignalProvider.requiresReview).toBe(true);
    expect(webSignalProvider.derivedMetricsAllowed({})).toBe(false);
    expect(webSignalProvider.status({})).toBe('not_configured');
    expect(webSignalProvider.statusReason({})).toMatch(/SEARXNG_URL/);
    expect(webSignalProvider.status({ SEARXNG_URL: 'https://search.example.org' })).toBe('ok');
    expect(webSignalProvider.status({ SEARXNG_URL: 'https://search.example.org', TRENDS_DISABLED_SOURCES: 'web' })).toBe('disabled');
    expect(webSignalProvider.label({})).toBe('New on the web');
    expect(webSignalProvider.label({ TRENDS_WEB_LABEL: 'Buzz' })).toBe('Buzz');
  });

  it('searches each configured language twice, in videos from the last week', async () => {
    expect(webLanguages({})).toEqual(['telugu', 'hindi', 'tamil']);
    expect(webLanguages({ TRENDS_WEB_LANGUAGES: 'Kannada, klingon, kannada, malayalam' })).toEqual(['kannada', 'malayalam']);
    expect(webQueries('telugu')).toEqual(['new telugu songs', 'trending telugu songs this week']);
    const urls: URL[] = [];
    vi.stubGlobal('fetch', async (input: string | URL) => {
      const u = new URL(String(input));
      urls.push(u);
      return new Response(JSON.stringify({ results: [{ url: 'https://v.example/1', title: 'Hookstep | Film X | Full Song | Composer', score: 2, engines: ['e1'] }] }), { status: 200 });
    });
    const items = await webSignalProvider.fetch({ SEARXNG_URL: 'https://search.example.org', TRENDS_WEB_LANGUAGES: 'kannada' }, { region: 'IN', now: new Date('2026-09-28T06:00:00Z') });
    expect(urls.map((u) => u.searchParams.get('q'))).toEqual(['new kannada songs', 'trending kannada songs this week']);
    expect(urls.every((u) => u.searchParams.get('categories') === 'videos' && u.searchParams.get('time_range') === 'week')).toBe(true);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      source: 'web',
      sourceUrl: 'https://v.example/1',
      title: 'Hookstep | Film X | Full Song | Composer',
      region: 'IN',
      sourceRank: 1,
      observedAt: '2026-09-28T06:00:00.000Z',
      languageEvidence: { searchLanguage: 'kannada' },
      statistics: null,
      expiresAt: null,
    });
    expect(items[0].sourceItemId).toMatch(/^web-[0-9a-f]{24}$/);
    expect(items[0].provenance).toMatchObject({ kind: 'web-search', queries: ['new kannada songs', 'trending kannada songs this week'] });
  });

  it('a dead instance is a retryable failure, not an empty chart', async () => {
    vi.stubGlobal('fetch', async () => new Response('down', { status: 503 }));
    const err = await webSignalProvider.fetch({ SEARXNG_URL: 'https://search.example.org' }, { region: 'IN' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TrendFetchError);
    expect(err).toMatchObject({ code: 'searxng_http_error', retryable: true, httpStatus: 503 });
  });

  it('a retry that finds the instance resting does not spin: not retryable, and it keeps the ORIGINAL cause', async () => {
    vi.stubGlobal('fetch', async () => new Response('bad gateway', { status: 502 }));
    await webSignalProvider.fetch({ SEARXNG_URL: 'https://search.example.org' }, { region: 'IN' }).catch(() => undefined);
    const err = await webSignalProvider.fetch({ SEARXNG_URL: 'https://search.example.org' }, { region: 'IN' }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'searxng_cooling', retryable: false, httpStatus: 502 });
    expect((err as Error).message).toContain('http_error, HTTP 502');
  });

  it('a refused token is not retried', async () => {
    vi.stubGlobal('fetch', async () => new Response('no', { status: 401 }));
    const err = await webSignalProvider.fetch({ SEARXNG_URL: 'https://search.example.org' }, { region: 'IN' }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'searxng_http_error', retryable: false, httpStatus: 401 });
  });

  it('answers with no result at all are a retryable failure (naming the engines that did not answer), never an empty snapshot', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ results: [], unresponsive_engines: [['video-engine', 'timeout']] }), { status: 200 }));
    const err = await webSignalProvider.fetch({ SEARXNG_URL: 'https://search.example.org' }, { region: 'IN' }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'web_no_results', retryable: true, skip: false });
    expect((err as Error).message).toContain('video-engine');
  });

  it('results with no single-song upload skip the run and keep the last snapshot', () => {
    const e = webRunFailure([{ res: ok([result('Latest Telugu Songs | Playlist')]) }], 0);
    expect(e).toMatchObject({ code: 'web_no_songs', retryable: false, skip: true });
    expect(webRunFailure([{ res: ok([result('x')]) }], 1)).toBeNull();
  });
});

describe('a run with nothing to store', () => {
  it('is recorded as skipped — no empty snapshot hides accepted items — and does not fail the job', async () => {
    const db = createFakeRest();
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const handled = db.handle(url, init);
      if (handled) return handled;
      if (url.startsWith('https://search.example.org/')) return Promise.resolve(new Response(JSON.stringify({ results: [{ url: 'https://v.example/p', title: 'Latest Telugu Songs | Playlist', score: 1 }] }), { status: 200 }));
      return Promise.resolve(new Response('not stubbed', { status: 599 }));
    });
    const out = await runIngest(
      { SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'srk', SEARXNG_URL: 'https://search.example.org', TRENDS_WEB_LANGUAGES: 'telugu' },
      { trigger: 'cron', sources: ['web'] },
      { now: () => new Date('2026-09-28T06:05:00Z'), search: async () => [], lookup: async () => null, sleep: async () => undefined, random: () => 0 },
    );
    expect(out.ok).toBe(true);
    expect(out.runs[0]).toMatchObject({ source: 'web', status: 'skipped', attempts: 1 });
    expect(out.runs[0].reason).toMatch(/^web_no_songs/);
    expect(db.tables.vinax_trend_snapshots ?? []).toHaveLength(0);
  });
});

describe('match budget share', () => {
  it('a capped provider gets at most its share of the whole run, less what it already spent; others get what remains', () => {
    expect(providerBudget(webSignalProvider, 20, 20, 0)).toBe(6);
    expect(providerBudget(webSignalProvider, 20, 20, 4)).toBe(2);
    expect(providerBudget(webSignalProvider, 3, 20, 0)).toBe(3);
    expect(providerBudget(webSignalProvider, 20, 20, 9)).toBe(0);
    expect(providerBudget(editorialProvider, 14, 20, 0)).toBe(14);
  });

  it('in a real run the web source stops at its share and defers the rest', async () => {
    const db = createFakeRest();
    const titles = Array.from({ length: 10 }, (_, i) => ({ url: `https://v.example/${i}`, title: `Song${String.fromCharCode(65 + i)} Title | Film ${String.fromCharCode(65 + i)} | Full Song | Composer`, score: 10 - i, engines: ['e1'] }));
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const handled = db.handle(url, init);
      if (handled) return handled;
      if (url.startsWith('https://search.example.org/')) return Promise.resolve(new Response(JSON.stringify({ results: titles }), { status: 200 }));
      return Promise.resolve(new Response('not stubbed', { status: 599 }));
    });
    let searches = 0;
    const out = await runIngest(
      { SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'srk', SEARXNG_URL: 'https://search.example.org', TRENDS_WEB_LANGUAGES: 'telugu' },
      { trigger: 'cron', sources: ['web'] },
      { now: () => new Date('2026-09-28T06:05:00Z'), matchBudget: 9, search: async () => { searches += 1; return []; }, lookup: async () => null, sleep: async () => undefined, random: () => 0 },
    );
    expect(searches).toBeLessThanOrEqual(3);
    expect(out.runs[0].deferred).toBeGreaterThan(0);
  });
});

describe('review gating', () => {
  const decision: MatchDecision = { status: 'matched', catalogId: 'c1', catalogTitle: 'T', catalogArtist: 'A', catalogLanguage: 'telugu', confidence: 0.98, method: 'title:exact+artist+film', reason: null, candidates: [], searches: 1 };

  it('holdForReview files a confident web match for review, keeping the proposal; other sources are untouched', () => {
    expect(holdForReview(webSignalProvider, decision)).toEqual({ ...decision, status: 'review', reason: 'needs_review_web_source' });
    expect(holdForReview(providerById('youtube')!, decision)).toBe(decision);
    const review = { ...decision, status: 'review' as const, reason: 'ambiguous' };
    expect(holdForReview(webSignalProvider, review)).toBe(review);
  });

  describe('through a real ingest run', () => {
    let db: FakeRest;
    beforeEach(() => {
      db = createFakeRest();
      vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const handled = db.handle(url, init);
        if (handled) return handled;
        if (url.startsWith('https://search.example.org/')) {
          return Promise.resolve(new Response(JSON.stringify({ results: [{ url: 'https://v.example/c', title: 'Chuttamalle - Lyrical | Devara Part - 1 | Shilpa Rao | Anirudh', score: 3, engines: ['e1', 'e2'] }] }), { status: 200 }));
        }
        return Promise.resolve(new Response('not stubbed', { status: 599 }));
      });
    });

    it('a match the chart matcher would auto-publish waits in the review queue', async () => {
      const catalog: CatalogCandidate[] = [{ id: 'c1', title: 'Chuttamalle (From "Devara Part 1")', primaryArtists: ['Shilpa Rao'], featuredArtists: [], credits: ['Anirudh Ravichander'], album: 'Devara Part 1', language: 'telugu', year: 2024 }];
      const out = await runIngest(
        { SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'srk', SEARXNG_URL: 'https://search.example.org', TRENDS_WEB_LANGUAGES: 'telugu' },
        { trigger: 'cron', sources: ['web'] },
        { now: () => new Date('2026-09-28T06:05:00Z'), search: async () => catalog, lookup: async () => null, sleep: async () => undefined, random: () => 0 },
      );
      expect(out.ok).toBe(true);
      expect(out.runs[0]).toMatchObject({ source: 'web', status: 'ok', fetched: 1, inserted: 1, matched: 0, review: 1 });
      const match = db.tables.vinax_trend_matches[0];
      expect(match).toMatchObject({ source: 'web', status: 'review', reason: 'needs_review_web_source', catalog_id: 'c1' });
      expect(Number(match.mapping_confidence)).toBeGreaterThanOrEqual(0.8);
      expect(db.tables.vinax_trend_observations[0]).toMatchObject({ source: 'web', url: 'https://v.example/c', chart: 'web-new-songs' });
    });
  });
});
