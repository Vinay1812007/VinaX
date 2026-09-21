/**
 * The video platform's public "most popular" chart, read through its Data API
 * (`videos.list` with `chart=mostPopular`). Adapter id `youtube`.
 *
 * What the documentation says (verified 2026-09-19, cited in docs/trends.md):
 *   - one `videos.list` call costs 1 quota unit; every request, even an
 *     invalid one, costs at least 1; the default project quota is 10,000
 *     units a day;
 *   - `regionCode` (ISO 3166-1 alpha-2) and `videoCategoryId` only work with
 *     `chart`; `maxResults` is 1–50; further pages come from `pageToken`;
 *   - data read without user credentials may be stored for at most 30
 *     calendar days, then deleted or refreshed (retention in ingest.ts);
 *   - derived metrics are not allowed by default (see derivedMetricsAllowed).
 *
 * A chart entry is a VIDEO. A popular video does not prove a known song: the
 * item keeps the video id and link, and matcher.ts decides separately whether
 * it is confidently one catalogue recording.
 *
 * Not verified against the live API: this project has no key. Tests replay
 * responses shaped exactly like the documented `videoListResponse`.
 */
import { envInt, envList, TrendFetchError, type FetchOptions, type RawTrendItem, type TrendProvider, type TrendsEnv } from './types';
import { scriptLanguage } from './matcher';

const ENDPOINT = 'https://www.googleapis.com/youtube/v3/videos';
const PAGE_SIZE = 50;
export const VIDEO_CHART_DEFAULT_LABEL = 'Public video chart';

interface ApiErrorBody {
  error?: { code?: number; message?: string; errors?: Array<{ reason?: string; domain?: string }> };
}

interface VideoResource {
  id?: unknown;
  snippet?: {
    title?: unknown;
    channelTitle?: unknown;
    publishedAt?: unknown;
    categoryId?: unknown;
    defaultLanguage?: unknown;
    defaultAudioLanguage?: unknown;
  };
  statistics?: Record<string, unknown>;
}

interface VideoListResponse {
  kind?: unknown;
  nextPageToken?: unknown;
  items?: unknown;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Counts arrive as decimal strings; keep only the ones that parse. */
function parseStatistics(raw: Record<string, unknown> | undefined): Record<string, number> | null {
  if (!raw || typeof raw !== 'object') return null;
  const out: Record<string, number> = {};
  for (const key of ['viewCount', 'likeCount', 'commentCount']) {
    const v = raw[key];
    const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN;
    if (Number.isFinite(n) && n >= 0) out[key] = n;
  }
  return Object.keys(out).length ? out : null;
}

/** Map one documented `video` resource to a raw item; null when it lacks an id or a title. */
export function parseVideoItem(
  raw: unknown,
  ctx: { rank: number; region: string; observedAt: string; categoryId: string; pageToken: string | null },
): RawTrendItem | null {
  const v = raw as VideoResource | null;
  if (!v || typeof v !== 'object') return null;
  const id = str(v.id);
  const title = str(v.snippet?.title);
  if (!id || !title || !/^[A-Za-z0-9_-]{6,20}$/.test(id)) return null;
  const evidence: Record<string, string> = {};
  const audio = str(v.snippet?.defaultAudioLanguage);
  const meta = str(v.snippet?.defaultLanguage);
  if (audio) evidence.declaredAudioLanguage = audio.slice(0, 16);
  if (meta) evidence.declaredMetadataLanguage = meta.slice(0, 16);
  const script = scriptLanguage(title);
  if (script) evidence.titleScript = script;
  const published = str(v.snippet?.publishedAt);
  return {
    source: 'youtube',
    sourceItemId: id,
    sourceUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`,
    title: title.slice(0, 300),
    credit: str(v.snippet?.channelTitle)?.slice(0, 200) ?? null,
    region: ctx.region,
    sourceRank: ctx.rank,
    observedAt: ctx.observedAt,
    languageEvidence: evidence,
    statistics: parseStatistics(v.statistics),
    provenance: {
      api: 'data-api-v3',
      method: 'videos.list',
      chart: 'mostPopular',
      regionCode: ctx.region,
      videoCategoryId: ctx.categoryId,
      pageToken: ctx.pageToken,
      categoryId: str(v.snippet?.categoryId),
      publishedAt: published,
      storage: 'non-authorized data: delete or refresh within 30 calendar days',
    },
  };
}

/** Turn a documented error body into a TrendFetchError; only 429 and 5xx are worth retrying. */
export function apiError(status: number, body: ApiErrorBody | null): TrendFetchError {
  const reason = body?.error?.errors?.[0]?.reason ?? (status === 429 ? 'rateLimitExceeded' : `http_${status}`);
  const message = (body?.error?.message ?? `The chart API answered ${status}`).slice(0, 300);
  return new TrendFetchError(String(reason).slice(0, 60), message, { retryable: status === 429 || status >= 500, httpStatus: status });
}

export const videoChartProvider: TrendProvider = {
  id: 'youtube',
  kind: 'public-chart',
  chart: 'most-popular-music',
  snapshotPolicy: 'hourly',
  displayHours: 72,
  label(env) {
    return (env.TRENDS_VIDEO_CHART_LABEL ?? '').trim().slice(0, 40) || VIDEO_CHART_DEFAULT_LABEL;
  },
  status(env) {
    if (envList(env.TRENDS_DISABLED_SOURCES).includes('youtube')) return 'disabled';
    return env.YOUTUBE_API_KEY ? 'ok' : 'not_configured';
  },
  statusReason(env) {
    if (envList(env.TRENDS_DISABLED_SOURCES).includes('youtube')) return 'Switched off by the owner (TRENDS_DISABLED_SOURCES).';
    if (!env.YOUTUBE_API_KEY) return 'No Data API key is set (YOUTUBE_API_KEY). Nothing is fetched and nothing is shown for this source.';
    return null;
  },
  maxUnitsPerRun(env) {
    // Up to 3 attempts per page, 1 unit per request.
    return pages(env) * 3;
  },
  dailyUnitBudget(env) {
    return envInt(env.TRENDS_VIDEO_DAILY_UNIT_BUDGET, 200, 1, 10_000);
  },
  derivedMetricsAllowed(env) {
    return envList(env.TRENDS_DERIVED_METRICS_SOURCES).includes('youtube');
  },
  async fetch(env: TrendsEnv, opts: FetchOptions): Promise<RawTrendItem[]> {
    const key = env.YOUTUBE_API_KEY;
    if (!key) throw new TrendFetchError('not_configured', 'No Data API key is set', { retryable: false });
    const categoryId = /^\d{1,4}$/.test(String(env.TRENDS_VIDEO_CATEGORY_ID ?? '')) ? String(env.TRENDS_VIDEO_CATEGORY_ID) : '10';
    const observedAt = (opts.now ?? new Date()).toISOString();
    const items: RawTrendItem[] = [];
    let pageToken: string | null = null;
    // Rank = position in the chart as returned, across pages (a malformed item still holds its place).
    let offset = 0;
    for (let page = 0; page < pages(env); page++) {
      const params = new URLSearchParams({
        part: 'snippet,statistics',
        chart: 'mostPopular',
        regionCode: opts.region,
        videoCategoryId: categoryId,
        maxResults: String(PAGE_SIZE),
        key,
      });
      if (pageToken) params.set('pageToken', pageToken);
      if (opts.meter) opts.meter.units += 1;
      const res = await fetch(`${ENDPOINT}?${params.toString()}`, { headers: { accept: 'application/json' }, signal: opts.signal });
      const body = (await res.json().catch(() => null)) as (VideoListResponse & ApiErrorBody) | null;
      if (!res.ok) throw apiError(res.status, body);
      if (!body || !Array.isArray(body.items)) {
        throw new TrendFetchError('bad_payload', 'The chart API answered without an items list', { retryable: false, httpStatus: res.status });
      }
      body.items.forEach((raw, i) => {
        const item = parseVideoItem(raw, { rank: offset + i + 1, region: opts.region, observedAt, categoryId, pageToken });
        if (item) items.push(item);
      });
      offset += body.items.length;
      pageToken = str(body.nextPageToken);
      if (!pageToken) break;
    }
    return items;
  },
};

function pages(env: TrendsEnv): number {
  return envInt(env.TRENDS_VIDEO_PAGES, 1, 1, 4);
}
