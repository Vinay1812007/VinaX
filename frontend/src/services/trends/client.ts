import { isNativePlatform } from '@/services/native';

/**
 * 7.2 — verified trends (GET /api/trends; contract in docs/trends.md).
 *
 * A verified trend is a CATALOGUE song that the server matched with
 * confidence to an entry of an outside chart or an editorial pick, with the
 * source, its rank, the region, when it was observed and an evidence link.
 * Nothing here is a catalogue search result, and nothing may be labelled as a
 * public chart unless it came through this client.
 *
 * `fetchVerifiedTrends` never throws. It resolves `null` when the read is
 * unavailable (offline, timeout, HTTP error, malformed answer), so callers
 * can fall back to catalogue lists that are labelled as catalogue lists. Every
 * field is re-validated here; an item that fails is dropped, never repaired.
 *
 * Load this module lazily (`import('@/services/trends/client')`): it is not
 * part of the first-load bundle.
 */

export interface TrendSourceStatus {
  id: string;
  /** Owner-configured display label, e.g. "Public video chart". */
  label: string;
  kind: 'public-chart' | 'editorial';
  status: 'ok' | 'stale' | 'unavailable' | 'disabled' | 'not_configured';
  lastSuccessAt: string | null;
  region: string;
}

export interface VerifiedTrend {
  catalogId: string;
  title: string;
  artist: string;
  language: string | null;
  region: string;
  source: string;
  sourceLabel: string;
  sourceKind: 'public-chart' | 'editorial';
  /** Position in the source's own list (1 = top). */
  sourceRank: number;
  /** Evidence a person can open; https only, else null. */
  sourceUrl: string | null;
  observedAt: string;
  expiresAt: string;
  /** 0.8–1: only confident or reviewed matches are ever returned. */
  mappingConfidence: number;
  /** Only when two comparable snapshots exist AND the source's terms allow a derived metric. */
  momentum: { rankDelta: number; windowHours: number } | null;
  /** In the newest snapshot but not the comparable previous one; false whenever no comparison exists. */
  newEntry: boolean;
}

export interface TrendsSnapshot {
  generatedAt: string;
  sources: TrendSourceStatus[];
  items: VerifiedTrend[];
}

const ENDPOINT = isNativePlatform() ? 'https://www.sirimillavinay.online/api/trends' : '/api/trends';
const TIMEOUT_MS = 8_000;
const KINDS = new Set(['public-chart', 'editorial']);
const STATUSES = new Set(['ok', 'stale', 'unavailable', 'disabled', 'not_configured']);

const text = (v: unknown, max = 300): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const isoTime = (v: unknown): string | null => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null);
const httpsUrl = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
};

function readSource(raw: unknown): TrendSourceStatus | null {
  const s = raw as Record<string, unknown> | null;
  if (!s || typeof s !== 'object') return null;
  const id = text(s.id, 40);
  const label = text(s.label, 60);
  const region = text(s.region, 2);
  if (!id || !label || !region || !KINDS.has(String(s.kind)) || !STATUSES.has(String(s.status))) return null;
  return { id, label, kind: s.kind as TrendSourceStatus['kind'], status: s.status as TrendSourceStatus['status'], lastSuccessAt: isoTime(s.lastSuccessAt), region };
}

function readItem(raw: unknown, now: number): VerifiedTrend | null {
  const i = raw as Record<string, unknown> | null;
  if (!i || typeof i !== 'object') return null;
  const catalogId = text(i.catalogId, 60);
  const title = text(i.title);
  const source = text(i.source, 40);
  const sourceLabel = text(i.sourceLabel, 60);
  const region = text(i.region, 2);
  const observedAt = isoTime(i.observedAt);
  const expiresAt = isoTime(i.expiresAt);
  const rank = Number(i.sourceRank);
  const confidence = Number(i.mappingConfidence);
  if (!catalogId || !title || !source || !sourceLabel || !region || !observedAt || !expiresAt) return null;
  if (!KINDS.has(String(i.sourceKind)) || !Number.isInteger(rank) || rank < 1 || !(confidence >= 0.8 && confidence <= 1)) return null;
  if (Date.parse(expiresAt) <= now) return null;
  const m = i.momentum as Record<string, unknown> | null;
  const momentum =
    m && typeof m === 'object' && Number.isFinite(Number(m.rankDelta)) && Number.isFinite(Number(m.windowHours)) && Number(m.windowHours) > 0
      ? { rankDelta: Math.trunc(Number(m.rankDelta)), windowHours: Math.round(Number(m.windowHours)) }
      : null;
  return {
    catalogId,
    title,
    artist: text(i.artist) ?? '',
    language: text(i.language, 20),
    region,
    source,
    sourceLabel,
    sourceKind: i.sourceKind as VerifiedTrend['sourceKind'],
    sourceRank: rank,
    sourceUrl: httpsUrl(i.sourceUrl),
    observedAt,
    expiresAt,
    mappingConfidence: confidence,
    momentum,
    newEntry: i.newEntry === true && momentum === null,
  };
}

export async function fetchVerifiedTrends(opts: { region?: string; language?: string; limit?: number; signal?: AbortSignal }): Promise<TrendsSnapshot | null> {
  const params = new URLSearchParams();
  const region = (opts.region ?? '').trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(region)) params.set('region', region);
  const language = (opts.language ?? '').trim().toLowerCase();
  if (/^[a-z]{2,20}$/.test(language)) params.set('language', language);
  if (Number.isFinite(opts.limit)) params.set('limit', String(Math.min(50, Math.max(1, Math.floor(opts.limit as number)))));
  if (opts.signal?.aborted) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const relay = (): void => controller.abort();
  opts.signal?.addEventListener('abort', relay, { once: true });
  try {
    const qs = params.toString();
    const res = await fetch(qs ? `${ENDPOINT}?${qs}` : ENDPOINT, { headers: { accept: 'application/json' }, signal: controller.signal });
    if (!res.ok) return null;
    const body = (await res.json()) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object' || !Array.isArray(body.sources) || !Array.isArray(body.items)) return null;
    const generatedAt = isoTime(body.generatedAt);
    if (!generatedAt) return null;
    const now = Date.now();
    return {
      generatedAt,
      sources: body.sources.map(readSource).filter((s): s is TrendSourceStatus => s !== null),
      items: body.items.map((i) => readItem(i, now)).filter((i): i is VerifiedTrend => i !== null),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', relay);
  }
}
