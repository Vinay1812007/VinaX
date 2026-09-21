/**
 * The public read behind GET /api/trends.
 *
 * Only confident, unexpired matches are returned: a raw item reaches a
 * listener only when its match is `matched` (automatic, at or above the
 * threshold), `accepted` or `corrected` (a person checked it), and its
 * observation has not expired. Every item names its source, rank, evidence
 * link and observation time. Nothing is hidden silently: a source whose last
 * success is older than TRENDS_POLICY.staleAfterHours is labelled `stale`,
 * one that never succeeded is `unavailable`, and switched-off or unconfigured
 * sources say so.
 *
 * Momentum is computed only from two comparable snapshots — same source,
 * region and chart — and only for providers whose terms permit derived
 * metrics (see computeMomentum). Counts from different platforms are never
 * combined; statistics are not part of this read at all.
 */
import { sbSelectResult, supabaseConfigured } from '../supabase';
import { inList } from './ingest';
import { AUTO_MATCH_THRESHOLD } from './matcher';
import { PROVIDERS, TRENDS_POLICY } from './registry';
import type { ProviderKind, TrendProvider, TrendsEnv } from './types';

export type PublicSourceStatus = 'ok' | 'stale' | 'unavailable' | 'disabled' | 'not_configured';

export interface PublicTrendSource {
  id: string;
  label: string;
  kind: ProviderKind;
  status: PublicSourceStatus;
  lastSuccessAt: string | null;
  region: string;
}

export interface Momentum {
  /** Previous rank minus current rank: positive = moved up. */
  rankDelta: number;
  /** Hours between the two snapshots compared. */
  windowHours: number;
}

export interface PublicTrendItem {
  catalogId: string;
  title: string;
  artist: string;
  language: string | null;
  region: string;
  source: string;
  sourceLabel: string;
  sourceKind: ProviderKind;
  sourceRank: number;
  sourceUrl: string | null;
  observedAt: string;
  expiresAt: string;
  mappingConfidence: number;
  momentum: Momentum | null;
  /** In this snapshot but not in the comparable previous one. False whenever no comparable snapshot exists. */
  newEntry: boolean;
}

export interface PublicTrendsSnapshot {
  generatedAt: string;
  sources: PublicTrendSource[];
  items: PublicTrendItem[];
}

export interface ReadOptions {
  region: string;
  language?: string | null;
  source?: string | null;
  limit: number;
  now?: Date;
  providers?: readonly TrendProvider[];
}

interface SnapshotRow {
  id: number;
  source: string;
  chart: string;
  observed_at: string;
  fetched_at: string;
}
interface ObservationRow {
  snapshot_id: number;
  source: string;
  source_item_id: string;
  url: string | null;
  source_rank: number;
  observed_at: string;
  expires_at: string;
}
interface MatchRow {
  source: string;
  source_item_id: string;
  catalog_id: string | null;
  catalog_title: string | null;
  catalog_artist: string | null;
  catalog_language: string | null;
  mapping_confidence: number;
}

export const ELIGIBLE_STATUSES = ['matched', 'accepted', 'corrected'] as const;

/**
 * Momentum for the items of one snapshot against the newest earlier snapshot
 * of the SAME source/region/chart observed between
 * TRENDS_POLICY.momentumMinWindowHours and momentumMaxWindowHours before it:
 *
 *   rankDelta   = previous rank − current rank   (positive = rose)
 *   windowHours = hours between the two observations, rounded
 *   newEntry    = the item is absent from that previous snapshot
 *
 * With no comparable previous snapshot every item gets momentum null and
 * newEntry false: one snapshot never implies growth.
 */
export function computeMomentum(
  current: Array<{ sourceItemId: string; sourceRank: number }>,
  currentObservedAt: string,
  previous: { observedAt: string; ranks: Map<string, number> } | null,
): Map<string, { momentum: Momentum | null; newEntry: boolean }> {
  const out = new Map<string, { momentum: Momentum | null; newEntry: boolean }>();
  const hours = previous ? (Date.parse(currentObservedAt) - Date.parse(previous.observedAt)) / 3_600_000 : NaN;
  const comparable = !!previous && Number.isFinite(hours) && hours >= TRENDS_POLICY.momentumMinWindowHours && hours <= TRENDS_POLICY.momentumMaxWindowHours;
  for (const item of current) {
    if (!comparable || !previous) {
      out.set(item.sourceItemId, { momentum: null, newEntry: false });
      continue;
    }
    const before = previous.ranks.get(item.sourceItemId);
    out.set(
      item.sourceItemId,
      before === undefined ? { momentum: null, newEntry: true } : { momentum: { rankDelta: before - item.sourceRank, windowHours: Math.round(hours) }, newEntry: false },
    );
  }
  return out;
}

async function previousRanks(env: TrendsEnv, snap: SnapshotRow, region: string): Promise<{ observedAt: string; ranks: Map<string, number> } | null> {
  const t1 = Date.parse(snap.observed_at);
  const newest = new Date(t1 - TRENDS_POLICY.momentumMinWindowHours * 3_600_000).toISOString();
  const oldest = new Date(t1 - TRENDS_POLICY.momentumMaxWindowHours * 3_600_000).toISOString();
  const prev = await sbSelectResult<SnapshotRow>(
    env,
    'vinax_trend_snapshots',
    `select=id,source,chart,observed_at,fetched_at&source=eq.${encodeURIComponent(snap.source)}&region=eq.${encodeURIComponent(region)}&chart=eq.${encodeURIComponent(snap.chart)}&observed_at=lte.${encodeURIComponent(newest)}&observed_at=gte.${encodeURIComponent(oldest)}&order=observed_at.desc&limit=1`,
  );
  if (!prev.ok || !prev.rows[0]) return null;
  const obs = await sbSelectResult<{ source_item_id: string; source_rank: number }>(env, 'vinax_trend_observations', `select=source_item_id,source_rank&snapshot_id=eq.${prev.rows[0].id}&limit=500`);
  if (!obs.ok || !obs.rows.length) return null;
  return { observedAt: prev.rows[0].observed_at, ranks: new Map(obs.rows.map((r) => [r.source_item_id, r.source_rank])) };
}

export async function readPublicTrends(env: TrendsEnv, opts: ReadOptions): Promise<{ body: PublicTrendsSnapshot; degraded: boolean }> {
  const now = opts.now ?? new Date();
  const providers = opts.providers ?? PROVIDERS;
  const region = opts.region;
  const base = providers.map((p) => ({ provider: p, configured: p.status(env) }));
  const sources: PublicTrendSource[] = base.map(({ provider, configured }) => ({
    id: provider.id,
    label: provider.label(env),
    kind: provider.kind,
    status: configured === 'ok' ? 'unavailable' : configured,
    lastSuccessAt: null,
    region,
  }));
  const body: PublicTrendsSnapshot = { generatedAt: now.toISOString(), sources, items: [] };
  const active = base.filter((b) => b.configured === 'ok').map((b) => b.provider);
  if (!active.length || !supabaseConfigured(env)) return { body, degraded: !supabaseConfigured(env) };

  const activeIds = active.map((p) => p.id);
  const [snaps, runs] = await Promise.all([
    sbSelectResult<SnapshotRow>(env, 'vinax_trend_snapshots', `select=id,source,chart,observed_at,fetched_at&region=eq.${encodeURIComponent(region)}&source=in.${encodeURIComponent(inList(activeIds))}&order=observed_at.desc&limit=40`),
    sbSelectResult<{ source: string; finished_at: string | null }>(env, 'vinax_trend_runs', `select=source,finished_at&region=eq.${encodeURIComponent(region)}&ok=eq.true&order=finished_at.desc.nullslast&limit=40`),
  ]);
  if (!snaps.ok) return { body, degraded: true };

  const latest = new Map<string, SnapshotRow>();
  for (const s of snaps.rows) {
    const p = active.find((a) => a.id === s.source);
    if (p && s.chart === p.chart && !latest.has(s.source)) latest.set(s.source, s);
  }
  const lastRun = new Map<string, string>();
  if (runs.ok) for (const r of runs.rows) if (r.finished_at && !lastRun.has(r.source)) lastRun.set(r.source, r.finished_at);

  for (const src of sources) {
    if (!activeIds.includes(src.id)) continue;
    const times = [lastRun.get(src.id), latest.get(src.id)?.fetched_at].filter((v): v is string => !!v && Number.isFinite(Date.parse(v)));
    const last = times.length ? new Date(Math.max(...times.map((t) => Date.parse(t)))).toISOString() : null;
    src.lastSuccessAt = last;
    if (!last) src.status = 'unavailable';
    else src.status = now.getTime() - Date.parse(last) > TRENDS_POLICY.staleAfterHours * 3_600_000 ? 'stale' : 'ok';
  }

  const snapshotIds = [...latest.values()].map((s) => s.id);
  if (!snapshotIds.length) return { body, degraded: !runs.ok };
  const obs = await sbSelectResult<ObservationRow>(
    env,
    'vinax_trend_observations',
    `select=snapshot_id,source,source_item_id,url,source_rank,observed_at,expires_at&snapshot_id=in.(${snapshotIds.join(',')})&expires_at=gt.${encodeURIComponent(now.toISOString())}&order=source_rank.asc&limit=500`,
  );
  if (!obs.ok) return { body, degraded: true };
  if (!obs.rows.length) return { body, degraded: !runs.ok };

  const itemIds = [...new Set(obs.rows.map((o) => o.source_item_id))];
  const matches = await sbSelectResult<MatchRow>(
    env,
    'vinax_trend_matches',
    `select=source,source_item_id,catalog_id,catalog_title,catalog_artist,catalog_language,mapping_confidence&source_item_id=in.${encodeURIComponent(inList(itemIds))}&status=in.(${ELIGIBLE_STATUSES.join(',')})&mapping_confidence=gte.${AUTO_MATCH_THRESHOLD}&limit=500`,
  );
  if (!matches.ok) return { body, degraded: true };
  const matchBy = new Map(matches.rows.filter((m) => m.catalog_id).map((m) => [`${m.source}|${m.source_item_id}`, m]));

  // Momentum only where the provider's terms allow a derived metric.
  const momentumBy = new Map<string, Map<string, { momentum: Momentum | null; newEntry: boolean }>>();
  await Promise.all(
    active.map(async (p) => {
      const snap = latest.get(p.id);
      if (!snap || !p.derivedMetricsAllowed(env)) return;
      const prev = await previousRanks(env, snap, region);
      const current = obs.rows.filter((o) => o.snapshot_id === snap.id).map((o) => ({ sourceItemId: o.source_item_id, sourceRank: o.source_rank }));
      momentumBy.set(p.id, computeMomentum(current, snap.observed_at, prev));
    }),
  );

  const language = opts.language?.toLowerCase() || null;
  const seen = new Set<string>();
  const items: PublicTrendItem[] = [];
  const order = new Map(providers.map((p, i) => [p.id, i]));
  const sortedObs = [...obs.rows].sort((a, b) => (order.get(a.source) ?? 99) - (order.get(b.source) ?? 99) || a.source_rank - b.source_rank);
  for (const o of sortedObs) {
    const p = active.find((a) => a.id === o.source);
    const m = matchBy.get(`${o.source}|${o.source_item_id}`);
    if (!p || !m || !m.catalog_id) continue;
    if (opts.source && o.source !== opts.source) continue;
    if (language && (m.catalog_language ?? '').toLowerCase() !== language) continue;
    // Two entries of one source mapping to the same song (a lyric video and a video song): keep the higher rank.
    const key = `${o.source}|${m.catalog_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const mom = momentumBy.get(o.source)?.get(o.source_item_id) ?? { momentum: null, newEntry: false };
    items.push({
      catalogId: m.catalog_id,
      title: m.catalog_title ?? '',
      artist: m.catalog_artist ?? '',
      language: m.catalog_language,
      region,
      source: p.id,
      sourceLabel: p.label(env),
      sourceKind: p.kind,
      sourceRank: o.source_rank,
      sourceUrl: o.url,
      observedAt: o.observed_at,
      expiresAt: o.expires_at,
      mappingConfidence: Math.round(Number(m.mapping_confidence) * 100) / 100,
      momentum: mom.momentum,
      newEntry: mom.newEntry,
    });
  }
  body.items = items.slice(0, opts.limit);
  return { body, degraded: !runs.ok };
}
