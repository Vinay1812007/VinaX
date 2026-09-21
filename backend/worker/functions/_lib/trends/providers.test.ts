/**
 * Provider adapters and the retry wrapper, against recorded responses shaped
 * exactly like the documented `videoListResponse` (not verified against the
 * live API: this project has no key). Pins the request parameters, quota
 * metering per request, pagination, error classification, the honest
 * not_configured / disabled states and bounded retries with jitter.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { editorialProvider } from './editorial';
import { backoffDelay, RetryFailure, withRetries } from './retry';
import { SHORT_VIDEO_DISABLED_REASON, shortVideoProvider } from './shortVideo';
import { TrendFetchError } from './types';
import { apiError, parseVideoItem, VIDEO_CHART_DEFAULT_LABEL, videoChartProvider } from './videoChart';

afterEach(() => vi.unstubAllGlobals());

/** Two items as the documented `video` resource: statistics arrive as decimal strings. */
const RECORDED_PAGE_1 = {
  kind: 'youtube#videoListResponse',
  etag: 'etag-1',
  nextPageToken: 'PAGE2',
  pageInfo: { totalResults: 3, resultsPerPage: 2 },
  items: [
    {
      kind: 'youtube#video',
      etag: 'e1',
      id: 'AbCdEfGhI01',
      snippet: {
        publishedAt: '2026-09-01T10:00:00Z',
        channelId: 'UC1',
        title: 'Chuttamalle - Lyrical | Devara Part - 1 | NTR | Janhvi Kapoor | Anirudh | Shilpa Rao',
        description: '…',
        channelTitle: 'Some Music Label',
        categoryId: '10',
        defaultLanguage: 'en',
        defaultAudioLanguage: 'te',
      },
      statistics: { viewCount: '1234567', likeCount: '8910', favoriteCount: '0', commentCount: '321' },
    },
    { kind: 'youtube#video', etag: 'e2', id: 'broken', snippet: {} },
  ],
};
const RECORDED_PAGE_2 = {
  kind: 'youtube#videoListResponse',
  etag: 'etag-2',
  prevPageToken: 'PAGE1',
  pageInfo: { totalResults: 3, resultsPerPage: 2 },
  items: [
    {
      kind: 'youtube#video',
      etag: 'e3',
      id: 'ZyXwVuTsR02',
      snippet: { publishedAt: '2026-09-10T10:00:00Z', title: 'నాటు నాటు | Rahul Sipligunj', channelTitle: 'Label Two', categoryId: '10' },
      statistics: { viewCount: '99' },
    },
  ],
};

const ok = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const err = (status: number, reason: string): Response => new Response(JSON.stringify({ error: { code: status, message: `failed: ${reason}`, errors: [{ reason, domain: 'youtube.quota' }] } }), { status });

describe('video chart adapter', () => {
  it('is not_configured without a key, disabled when the owner switches it off, ok with a key', () => {
    expect(videoChartProvider.status({})).toBe('not_configured');
    expect(videoChartProvider.statusReason({})).toMatch(/YOUTUBE_API_KEY/);
    expect(videoChartProvider.status({ YOUTUBE_API_KEY: 'k', TRENDS_DISABLED_SOURCES: 'youtube' })).toBe('disabled');
    expect(videoChartProvider.status({ YOUTUBE_API_KEY: 'k' })).toBe('ok');
  });

  it('uses a neutral label unless the owner sets one', () => {
    expect(videoChartProvider.label({})).toBe(VIDEO_CHART_DEFAULT_LABEL);
    expect(videoChartProvider.label({ TRENDS_VIDEO_CHART_LABEL: 'Video chart' })).toBe('Video chart');
  });

  it('refuses to fetch without a key and sends no request', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    await expect(videoChartProvider.fetch({}, { region: 'IN' })).rejects.toMatchObject({ code: 'not_configured', retryable: false });
    expect(spy).not.toHaveBeenCalled();
  });

  it('asks for the most-popular music chart of the region with the documented parameters', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => (urls.push(u), ok({ ...RECORDED_PAGE_1, nextPageToken: undefined }))));
    const meter = { units: 0 };
    await videoChartProvider.fetch({ YOUTUBE_API_KEY: 'secret' }, { region: 'IN', meter });
    const u = new URL(urls[0]);
    expect(u.origin + u.pathname).toBe('https://www.googleapis.com/youtube/v3/videos');
    expect(Object.fromEntries(u.searchParams)).toEqual({ part: 'snippet,statistics', chart: 'mostPopular', regionCode: 'IN', videoCategoryId: '10', maxResults: '50', key: 'secret' });
    expect(meter.units).toBe(1);
  });

  it('parses items, keeps the source id and link apart from any catalogue id, and keeps ranks when an item is malformed', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => ok(u.includes('pageToken=PAGE2') ? RECORDED_PAGE_2 : RECORDED_PAGE_1)));
    const meter = { units: 0 };
    const items = await videoChartProvider.fetch({ YOUTUBE_API_KEY: 'k', TRENDS_VIDEO_PAGES: '2' }, { region: 'IN', meter, now: new Date('2026-09-19T06:00:00Z') });
    expect(meter.units).toBe(2); // one unit per page request
    expect(items).toHaveLength(2);
    const [first, second] = items;
    expect(first).toMatchObject({
      source: 'youtube',
      sourceItemId: 'AbCdEfGhI01',
      sourceUrl: 'https://www.youtube.com/watch?v=AbCdEfGhI01',
      credit: 'Some Music Label',
      region: 'IN',
      sourceRank: 1,
      observedAt: '2026-09-19T06:00:00.000Z',
      statistics: { viewCount: 1234567, likeCount: 8910, commentCount: 321 },
      languageEvidence: { declaredAudioLanguage: 'te', declaredMetadataLanguage: 'en' },
    });
    expect(first).not.toHaveProperty('catalogId');
    expect(first.provenance).toMatchObject({ method: 'videos.list', chart: 'mostPopular', regionCode: 'IN', videoCategoryId: '10' });
    // The malformed second item is skipped but still holds rank 2, so page 2 starts at rank 3.
    expect(second).toMatchObject({ sourceItemId: 'ZyXwVuTsR02', sourceRank: 3, languageEvidence: { titleScript: 'telugu' } });
  });

  it('classifies documented errors: quota and chart errors are final, 5xx and 429 are retryable', () => {
    expect(apiError(403, { error: { errors: [{ reason: 'quotaExceeded' }] } })).toMatchObject({ code: 'quotaExceeded', retryable: false });
    expect(apiError(400, { error: { errors: [{ reason: 'videoChartNotFound' }] } })).toMatchObject({ code: 'videoChartNotFound', retryable: false });
    expect(apiError(503, null)).toMatchObject({ code: 'http_503', retryable: true });
    expect(apiError(429, null)).toMatchObject({ code: 'rateLimitExceeded', retryable: true });
  });

  it('turns an error answer into a TrendFetchError and still meters the request', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => err(403, 'quotaExceeded')));
    const meter = { units: 0 };
    await expect(videoChartProvider.fetch({ YOUTUBE_API_KEY: 'k' }, { region: 'IN', meter })).rejects.toBeInstanceOf(TrendFetchError);
    expect(meter.units).toBe(1);
  });

  it('rejects a video resource without an id or title', () => {
    const ctx = { rank: 1, region: 'IN', observedAt: '2026-09-19T00:00:00Z', categoryId: '10', pageToken: null };
    expect(parseVideoItem({ id: 'AbCdEfGhI01', snippet: {} }, ctx)).toBeNull();
    expect(parseVideoItem({ snippet: { title: 'x' } }, ctx)).toBeNull();
    expect(parseVideoItem({ id: 'bad id with spaces', snippet: { title: 'x' } }, ctx)).toBeNull();
  });

  it('allows derived metrics only when the owner declares the provider permits them', () => {
    expect(videoChartProvider.derivedMetricsAllowed({ YOUTUBE_API_KEY: 'k' })).toBe(false);
    expect(videoChartProvider.derivedMetricsAllowed({ YOUTUBE_API_KEY: 'k', TRENDS_DERIVED_METRICS_SOURCES: 'youtube' })).toBe(true);
  });
});

describe('short-video adapter', () => {
  it('is honestly disabled, says why, and never fetches', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    expect(shortVideoProvider.status({ YOUTUBE_API_KEY: 'k' })).toBe('disabled');
    expect(shortVideoProvider.statusReason({})).toBe(SHORT_VIDEO_DISABLED_REASON);
    await expect(shortVideoProvider.fetch({}, { region: 'IN' })).rejects.toMatchObject({ code: 'disabled', retryable: false });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('editorial adapter', () => {
  it('needs the database and can be switched off', () => {
    expect(editorialProvider.status({})).toBe('not_configured');
    expect(editorialProvider.status({ SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'k' })).toBe('ok');
    expect(editorialProvider.status({ SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'k', TRENDS_DISABLED_SOURCES: 'editorial' })).toBe('disabled');
    expect(editorialProvider.derivedMetricsAllowed({})).toBe(false);
  });
});

describe('withRetries', () => {
  const retryable = () => new TrendFetchError('http_503', 'down', { retryable: true });

  it('retries retryable failures with exponential backoff plus jitter, then succeeds', async () => {
    const sleep = vi.fn(async (_ms: number) => undefined);
    let calls = 0;
    const out = await withRetries(
      async () => {
        calls++;
        if (calls < 3) throw retryable();
        return 'ok';
      },
      { attempts: 3, baseDelayMs: 100, jitterMs: 50, random: () => 0.5, sleep },
    );
    expect(out).toEqual({ value: 'ok', attempts: 3 });
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([125, 225]);
  });

  it('stops at the attempt limit and reports how many were made', async () => {
    const run = vi.fn(async () => {
      throw retryable();
    });
    const failure = await withRetries(run, { attempts: 3, sleep: async () => undefined }).catch((e) => e);
    expect(failure).toBeInstanceOf(RetryFailure);
    expect(failure.attempts).toBe(3);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('never retries a final error', async () => {
    const run = vi.fn(async () => {
      throw new TrendFetchError('quotaExceeded', 'quota', { retryable: false });
    });
    const failure = await withRetries(run, { attempts: 3, sleep: async () => undefined }).catch((e) => e);
    expect(failure.last.code).toBe('quotaExceeded');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('cuts a hung attempt at its deadline, counts it as a timeout and retries', async () => {
    let calls = 0;
    const run = vi.fn(() => {
      calls++;
      return calls < 2 ? new Promise<string>(() => undefined) : Promise.resolve('late but fine');
    });
    const out = await withRetries(run, { attempts: 3, attemptTimeoutMs: 20, sleep: async () => undefined });
    expect(out).toEqual({ value: 'late but fine', attempts: 2 });
  });

  it('reports a timeout when every attempt hangs', async () => {
    const failure = await withRetries(() => new Promise<string>(() => undefined), { attempts: 2, attemptTimeoutMs: 10, sleep: async () => undefined }).catch((e) => e);
    expect(failure.last.code).toBe('timeout');
    expect(failure.attempts).toBe(2);
  });

  it('caps the backoff', () => {
    expect(backoffDelay(10, { baseDelayMs: 500, maxDelayMs: 4000, jitterMs: 0 })).toBe(4000);
  });
});
