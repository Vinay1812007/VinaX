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
import { holdForReview, runIngest } from './ingest';
import type { CatalogCandidate, MatchDecision } from './matcher';
import { PROVIDERS, providerById } from './registry';
import { TrendFetchError } from './types';
import { extractWebCandidates, looksLikeOneSong, mentionKey, webLanguages, webQueries, webSignalProvider } from './webSignal';

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

  it('keeps at most twelve per leading language', () => {
    const many = Array.from({ length: 20 }, (_, i) => result(`Song Number ${String.fromCharCode(65 + i)}${String.fromCharCode(65 + i)} | Film ${i} | Full Song`, { score: 20 - i }));
    expect(extractWebCandidates([{ language: 'hindi', query: 'q', res: ok(many) }])).toHaveLength(12);
  });
});

describe('webSignalProvider', () => {
  it('is registered before editorial, editorial-kind, review-gated, and needs SEARXNG_URL', () => {
    expect(PROVIDERS.map((p) => p.id)).toEqual(['youtube', 'instagram', 'web', 'editorial']);
    expect(providerById('web')).toBe(webSignalProvider);
    expect(webSignalProvider.kind).toBe('editorial');
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
    expect(err).toMatchObject({ retryable: true, httpStatus: 503 });
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
