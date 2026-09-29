/**
 * 7.2 — verified trends: the shared vocabulary.
 *
 * A trend provider reports what an OUTSIDE source says is popular. What it
 * returns is evidence about the source's own item (a video, an editorial
 * entry) — never a claim about a catalogue song. Matching a raw item to a
 * catalogue song is a separate, scored step (matcher.ts), and only confident
 * matches are ever shown to listeners. See docs/trends.md.
 */
import type { SearxngEnv } from '../searxng';
import type { SupabaseEnv } from '../supabase';

/** 8.3.1 — `web`: songs found through web search and accepted by a person (webSignal.ts). */
export type ProviderKind = 'public-chart' | 'editorial' | 'web';
export type ProviderStatus = 'ok' | 'not_configured' | 'disabled';

/** Worker env the trend code reads. Every name is documented in backend/.env.example. */
export interface TrendsEnv extends SupabaseEnv, SearxngEnv {
  /** The video platform's Data API key. Missing → that provider is `not_configured`. */
  YOUTUBE_API_KEY?: string;
  /** Comma-separated ISO 3166-1 alpha-2 regions to ingest. Default `IN`. */
  TRENDS_REGIONS?: string;
  /** Owner-chosen label for the video platform's chart (UI text). */
  TRENDS_VIDEO_CHART_LABEL?: string;
  /** Owner-chosen label for editorial pins (UI text). */
  TRENDS_EDITORIAL_LABEL?: string;
  /** Comma-separated provider ids the owner switched off. */
  TRENDS_DISABLED_SOURCES?: string;
  /** Daily quota-unit ceiling this app allows itself for the video chart. Default 200. */
  TRENDS_VIDEO_DAILY_UNIT_BUDGET?: string;
  /** Chart category id for the video chart. Default `10` (see docs/trends.md). */
  TRENDS_VIDEO_CATEGORY_ID?: string;
  /** Pages of 50 to read per region per run, 1–4. Default 1. */
  TRENDS_VIDEO_PAGES?: string;
  /**
   * Provider ids whose terms permit derived metrics (rank change, new entry).
   * Empty by default: the video platform's developer policies forbid derived
   * metrics unless its derived-metrics amendment has been accepted.
   */
  TRENDS_DERIVED_METRICS_SOURCES?: string;
  /** 8.3.0 — languages the web source searches, comma-separated. Default telugu,hindi,tamil. */
  TRENDS_WEB_LANGUAGES?: string;
  /** 8.3.0 — owner-chosen label for the web source (UI text). */
  TRENDS_WEB_LABEL?: string;
}

/** One item exactly as a source reported it, before any catalogue matching. */
export interface RawTrendItem {
  /** Provider id (`youtube`, `editorial`, …). */
  source: string;
  /** The SOURCE's own id for the item (a video id, an editorial row id). Never a catalogue id. */
  sourceItemId: string;
  /** Evidence link a person can open to check the claim. */
  sourceUrl: string | null;
  /** The item's title as the source wrote it. */
  title: string;
  /** Uploader / credit line as the source wrote it (channel title, editorial artist). */
  credit: string | null;
  region: string;
  /** 1-based position in the source's list. */
  sourceRank: number;
  /** When the source said this (ISO). */
  observedAt: string;
  /** Language signals the source carried (declared audio language, title script…). Evidence, not a verdict. */
  languageEvidence: Record<string, string>;
  /** Counts the source returned, exactly as returned. Never compared across sources. */
  statistics: Record<string, number> | null;
  /** Where the item came from: endpoint, parameters, the policy that governs storing it. */
  provenance: Record<string, unknown>;
  /** Editorial only: the catalogue id the editor named. Still verified before it is trusted. */
  catalogIdHint?: string | null;
  /** Editorial only: the artist the editor named. */
  artistHint?: string | null;
  /** Editorial only: when the pin stops being shown. */
  expiresAt?: string | null;
}

export interface FetchOptions {
  region: string;
  signal?: AbortSignal;
  /** Incremented once per request sent to a metered API (every request costs quota, even a failed one). */
  meter?: { units: number };
  now?: Date;
}

export interface TrendProvider {
  id: string;
  kind: ProviderKind;
  /** The chart this provider reads; snapshots are only compared within one chart. */
  chart: string;
  /**
   * How a run names its snapshot. `hourly`: one snapshot per source/region/chart
   * per UTC hour (a re-run inside the hour inserts nothing). `content`: the
   * snapshot key is a hash of the items, so an unchanged list inserts nothing.
   */
  snapshotPolicy: 'hourly' | 'content';
  /** How long after observation a chart item may be shown; null = the item's own `expiresAt`. */
  displayHours: number | null;
  label(env: TrendsEnv): string;
  status(env: TrendsEnv): ProviderStatus;
  /** Why the status is not `ok`, in words an owner can act on. */
  statusReason(env: TrendsEnv): string | null;
  /** Quota units one run may spend at most (all attempts). 0 = unmetered. */
  maxUnitsPerRun(env: TrendsEnv): number;
  /** The daily unit ceiling this app allows itself for the provider; null = unmetered. */
  dailyUnitBudget(env: TrendsEnv): number | null;
  /** Whether the provider's terms permit derived metrics (rank change, new entry). */
  derivedMetricsAllowed(env: TrendsEnv): boolean;
  /**
   * 8.3.0 — every match waits for the owner's review, however confident: the
   * source is evidence that people mention a song, not a verified chart.
   */
  requiresReview?: boolean;
  /** 8.3.0 — deadline for one fetch attempt when the default 8 s is too short. */
  attemptTimeoutMs?: number;
  /** 8.3.1 — the largest share (0–1) of a run's catalogue-match budget this provider may spend, across its regions. Unset = no cap. */
  maxMatchShare?: number;
  fetch(env: TrendsEnv, opts: FetchOptions): Promise<RawTrendItem[]>;
}

/** A provider failure with enough shape to decide whether retrying can help. */
export class TrendFetchError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly httpStatus: number | null;
  /** 8.3.1 — nothing failed, there is just nothing to store this time: the run is recorded `skipped` and the last snapshot stays. */
  readonly skip: boolean;
  constructor(code: string, message: string, opts: { retryable: boolean; httpStatus?: number | null; skip?: boolean }) {
    super(message);
    this.name = 'TrendFetchError';
    this.code = code;
    this.retryable = opts.retryable;
    this.httpStatus = opts.httpStatus ?? null;
    this.skip = opts.skip === true;
  }
}

/** Parse a comma-separated env list into trimmed, lower-cased ids. */
export function envList(value: string | undefined): string[] {
  return String(value ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function envInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export const REGION_RE = /^[A-Z]{2}$/;

/** Regions the job ingests (TRENDS_REGIONS, default IN), validated and de-duplicated. */
export function configuredRegions(env: TrendsEnv): string[] {
  const list = String(env.TRENDS_REGIONS ?? 'IN')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => REGION_RE.test(s));
  const unique = [...new Set(list)];
  return unique.length ? unique.slice(0, 8) : ['IN'];
}
