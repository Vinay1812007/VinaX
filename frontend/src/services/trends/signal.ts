import type { RecommendationContext } from '@/services/recommendation/types';

/**
 * 7.2 — verified charts as ONE bounded signal for the next song.
 *
 * The recommender never waits for a chart. `trendSignalNow()` answers from a
 * small in-memory snapshot and, when that snapshot is old, starts a refresh in
 * the background for the round after this one. A missing, stale or
 * unconfigured chart therefore costs nothing: the signal is simply empty.
 *
 * What the signal does: a candidate the catalogue already offered, which is
 * also a confidently matched entry of a public chart or an editorial pick for
 * the listener's region, earns a small, capped score bonus (highest at rank 1,
 * gone by the bottom of the list). It is subordinate to everything else: it
 * cannot admit a song the hard rules reject, it cannot break the language
 * lock, and at `TREND_MAX` it is smaller than a candidate source boost, so it
 * nudges an order rather than dictating it. Editorial picks count for less
 * than a chart position, because someone chose them by hand.
 */
export interface TrendSignal {
  /** Catalogue id → bonus in score units (already capped). */
  bonus: ReadonlyMap<string, number>;
  /** Catalogue id → the source's display label, for "Why this song?". */
  label: ReadonlyMap<string, string>;
  at: number;
  region: string | null;
  /**
   * 9.1.0 — the language the snapshot was fetched FOR. The snapshot is
   * per (region, language), so this has to be part of its identity: 9.0
   * compared the region only, so a listener who changed language kept being
   * served the previous language's chart and no refresh was ever started.
   */
  language: string | null;
  /**
   * 9.1.0 — the verified entries themselves, so a trending song can ENTER a
   * candidate pool instead of only earning a bonus when the catalogue happened
   * to return it anyway (./candidates.ts, the 'verified-trend' source).
   */
  items: readonly TrendCandidate[];
}

/** A verified chart or editorial entry, reduced to what a candidate pool needs. */
export interface TrendCandidate {
  catalogId: string;
  title: string;
  artist: string;
  language: string | null;
  sourceKind: 'public-chart' | 'editorial';
  sourceLabel: string;
  sourceRank: number;
  sourceUrl: string | null;
  observedAt: string;
  mappingConfidence: number;
}

/** The largest bonus a chart position can add (rank 1). */
export const TREND_MAX = 0.06;
/** An editorial pick is a person's choice, not a measured position. */
export const TREND_EDITORIAL_MAX = 0.03;
/** How long a snapshot is used before a refresh is started. */
const FRESH_MS = 15 * 60_000;
/** How long a failed read is remembered, so a dead endpoint is not polled every round. */
const RETRY_MS = 10 * 60_000;
/** Chart entries considered; beyond this the bonus is zero anyway. */
const CONSIDER = 50;

const EMPTY: TrendSignal = { bonus: new Map(), label: new Map(), at: 0, region: null, language: null, items: [] };

let signal: TrendSignal = EMPTY;
let loading: Promise<void> | null = null;
let retryAfter = 0;

/** Test hook. */
export function resetTrendSignal(): void {
  signal = EMPTY;
  loading = null;
  retryAfter = 0;
}

function bonusFor(rank: number, kind: 'public-chart' | 'editorial', confidence: number): number {
  const cap = kind === 'editorial' ? TREND_EDITORIAL_MAX : TREND_MAX;
  const position = Math.max(0, 1 - (Math.max(1, rank) - 1) / CONSIDER);
  // A match the server is less sure of is worth less, and never more than the cap.
  return Math.min(cap, cap * position * Math.max(0, Math.min(1, confidence)));
}

async function refresh(region: string | null, language: string | null): Promise<void> {
  try {
    const { fetchVerifiedTrends } = await import('./client');
    const snapshot = await fetchVerifiedTrends({ region: region ?? undefined, language: language ?? undefined, limit: CONSIDER });
    if (!snapshot) {
      retryAfter = Date.now() + RETRY_MS;
      return;
    }
    const bonus = new Map<string, number>();
    const label = new Map<string, string>();
    const items = new Map<string, TrendCandidate>();
    for (const item of snapshot.items) {
      const value = bonusFor(item.sourceRank, item.sourceKind, item.mappingConfidence);
      if (!(value > 0)) continue;
      // One entry per song: the strongest source wins.
      if ((bonus.get(item.catalogId) ?? 0) >= value) continue;
      bonus.set(item.catalogId, value);
      label.set(item.catalogId, item.sourceLabel);
      items.set(item.catalogId, {
        catalogId: item.catalogId,
        title: item.title,
        artist: item.artist,
        language: item.language,
        sourceKind: item.sourceKind,
        sourceLabel: item.sourceLabel,
        sourceRank: item.sourceRank,
        sourceUrl: item.sourceUrl,
        observedAt: item.observedAt,
        mappingConfidence: item.mappingConfidence,
      });
    }
    signal = { bonus, label, at: Date.now(), region, language, items: [...items.values()].sort((a, b) => a.sourceRank - b.sourceRank) };
    retryAfter = 0;
  } catch {
    retryAfter = Date.now() + RETRY_MS;
  } finally {
    loading = null;
  }
}

/**
 * The signal as it stands. Never waits: when the snapshot is stale (or for
 * another region) a refresh starts for the next round and the current one is
 * returned as it is.
 */
export function trendSignalNow(ctx: Pick<RecommendationContext, 'region' | 'pinnedLanguages'>): TrendSignal {
  const region = ctx.region?.country ?? null;
  const language = ctx.pinnedLanguages[0] ?? null;
  // 9.1.0 — the LANGUAGE counts too. A snapshot fetched for Telugu is not an
  // answer for a listener who has since pinned Hindi: 9.0 compared the region
  // alone, so that listener was served the Telugu chart until the 15-minute
  // freshness window happened to lapse, and the mismatch never triggered a
  // refresh of its own.
  const stale = Date.now() - signal.at > FRESH_MS || signal.region !== region || signal.language !== language;
  if (stale && !loading && Date.now() >= retryAfter) {
    loading = refresh(region, language);
  }
  return signal.region === region && signal.language === language ? signal : EMPTY;
}
