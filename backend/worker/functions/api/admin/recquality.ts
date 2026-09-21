/**
 * Admin: Recommendation Quality (7.2.0).
 *
 *   GET /api/admin/recquality?days=7 →
 *     { configured, provisioned, scope: 'opt-in', days, sampled, truncated,
 *       devices, minDevices, earlySkipSec, overall, byAlg, byPicker, byVariant }
 *
 * Source: opt-in telemetry rows in vinax_events with a `meta` jsonb —
 *   rec_served  — one automatic continuation was appended to a queue;
 *   rec_outcome — one automatic song started, and how it went.
 * Only devices whose listener turned usage sharing on send these rows, so
 * every number here describes that opt-in group of N devices, never all
 * listeners. Aggregates only: no song, device id or timestamp of an
 * individual listener leaves this route, and a group of fewer than
 * MIN_DEVICES devices keeps its counts but withholds its rates.
 *
 * Small samples are shown as small: every rate carries its sample count and a
 * 95 % Wilson interval, a median carries a distribution-free interval, and a
 * p95 needs at least P95_MIN samples.
 *
 * A failed read answers 502 with the failure's kind, never zeros. A missing
 * `meta` column (the telemetry migration has not run) answers 200 with
 * `provisioned: false` and no numbers.
 */
import { isAdminAsync, unauthorized, type AdminEnv } from '../../_lib/admin';
import { percentile } from '../../_lib/laneHealth';
import { dbErrorCode, sbSelectResult, supabaseConfigured, type SupabaseEnv } from '../../_lib/supabase';

type Env = AdminEnv & SupabaseEnv;

const json = (o: unknown, status = 200): Response =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

/** Rows read per request (newest first); `truncated` says when the window held more. */
export const ROW_CAP = 20_000;
/** A group needs this many distinct devices before its rates are shown. */
export const MIN_DEVICES = 3;
/** A p95 from fewer samples is just the maximum; withheld below this. */
export const P95_MIN = 20;
/** At most this many keys per breakdown; the rest fold into "(other)". */
const MAX_GROUPS = 20;
/** Listening shorter than this counts as an early skip. */
export const EARLY_SKIP_SEC = 30;

export const FALLBACK_REASONS = ['ai_timeout', 'ai_unavailable', 'ai_rejected', 'deadline', 'error'] as const;

export interface RecEventRow {
  type: string | null;
  device_id: string | null;
  song_id?: string | null;
  created_at?: string | null;
  meta?: unknown;
}

export interface Rate { k: number; n: number; rate: number | null; low: number | null; high: number | null }
export interface Dist { n: number; p50: number | null; p50Low: number | null; p50High: number | null; p95: number | null }

export interface GroupStats {
  key: string;
  devices: number;
  continuations: number;
  exposures: number;
  /** True when fewer than MIN_DEVICES devices are in the group: counts only. */
  withheld: boolean;
  served: null | {
    songs: number;
    latencyMs: Dist;
    fallback: Rate & { byReason: Record<string, number> };
    languageViolations: { songs: number; rate: Rate };
    discovery: Rate;
    diversity: { n: number; mean: number | null };
    relaxed: Record<string, number>;
  };
  outcomes: null | {
    heardSec: Dist;
    completion: Rate;
    skip: Rate;
    earlySkip: Rate;
    likes: Rate;
    repeats: Rate;
  };
}

export interface RecQualityReport {
  devices: number;
  overall: GroupStats;
  byAlg: GroupStats[];
  byPicker: GroupStats[];
  byVariant: GroupStats[];
}

const r4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** 95 % Wilson score interval for k successes in n trials (rates as 0..1). */
export function wilson(k: number, n: number, z = 1.96): Rate {
  if (!(n > 0)) return { k, n, rate: null, low: null, high: null };
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { k, n, rate: r4(p), low: r4(Math.max(0, centre - half)), high: r4(Math.min(1, centre + half)) };
}

/**
 * Median with a distribution-free ~95 % interval (order statistics of the
 * binomial(n, ½)); for tiny samples the interval honestly spans min..max.
 */
export function distribution(values: number[]): Dist {
  const s = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const n = s.length;
  if (!n) return { n: 0, p50: null, p50Low: null, p50High: null, p95: null };
  const half = (1.96 * Math.sqrt(n)) / 2;
  const lo = Math.min(n, Math.max(1, Math.floor(n / 2 - half)));
  const hi = Math.min(n, Math.max(1, Math.ceil(1 + n / 2 + half)));
  return { n, p50: percentile(s, 50), p50Low: s[lo - 1], p50High: s[hi - 1], p95: n >= P95_MIN ? percentile(s, 95) : null };
}

// ---- sanitising untrusted meta (it is written by clients) -------------------

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const num = (v: unknown, max: number): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? v : null);
const label = (v: unknown, max = 40): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const EXP_KEY = /^[a-z0-9-]{1,40}$/;

function expPairs(v: unknown): string[] {
  const o = obj(v);
  if (!o) return [];
  const out: string[] = [];
  for (const [k, val] of Object.entries(o)) {
    const variant = label(val, 24);
    if (EXP_KEY.test(k) && variant) out.push(`${k}: ${variant}`);
    if (out.length >= 10) break;
  }
  return out;
}

interface Acc {
  devices: Set<string>;
  continuations: number;
  songs: number;
  discovery: number;
  latency: number[];
  fallback: number;
  byReason: Map<string, number>;
  violations: number;
  diversity: number[];
  relaxed: Map<string, number>;
  exposures: number;
  heard: number[];
  outcomeKnown: number;
  complete: number;
  skip: number;
  earlySkip: number;
  liked: number;
  repeatKnown: number;
  repeat: number;
}

const newAcc = (): Acc => ({
  devices: new Set(), continuations: 0, songs: 0, discovery: 0, latency: [], fallback: 0, byReason: new Map(), violations: 0,
  diversity: [], relaxed: new Map(), exposures: 0, heard: [], outcomeKnown: 0, complete: 0, skip: 0, earlySkip: 0, liked: 0,
  repeatKnown: 0, repeat: 0,
});

const bump = (m: Map<string, number>, k: string, by = 1): void => { m.set(k, (m.get(k) ?? 0) + by); };
const record = (m: Map<string, number>): Record<string, number> => Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]));

function finish(key: string, a: Acc): GroupStats {
  const withheld = a.devices.size < MIN_DEVICES;
  const base = { key, devices: a.devices.size, continuations: a.continuations, exposures: a.exposures, withheld };
  if (withheld) return { ...base, served: null, outcomes: null };
  return {
    ...base,
    served: a.continuations
      ? {
          songs: a.songs,
          latencyMs: distribution(a.latency),
          fallback: { ...wilson(a.fallback, a.continuations), byReason: record(a.byReason) },
          languageViolations: { songs: a.violations, rate: wilson(Math.min(a.violations, a.songs), a.songs) },
          discovery: wilson(Math.min(a.discovery, a.songs), a.songs),
          diversity: { n: a.diversity.length, mean: a.diversity.length ? Math.round((a.diversity.reduce((s, v) => s + v, 0) / a.diversity.length) * 100) / 100 : null },
          relaxed: record(a.relaxed),
        }
      : null,
    outcomes: a.exposures
      ? {
          heardSec: distribution(a.heard),
          completion: wilson(a.complete, a.outcomeKnown),
          skip: wilson(a.skip, a.outcomeKnown),
          earlySkip: wilson(a.earlySkip, a.outcomeKnown),
          likes: wilson(a.liked, a.exposures),
          repeats: wilson(a.repeat, a.repeatKnown),
        }
      : null,
  };
}

/** Keep the busiest MAX_GROUPS keys; fold the rest into one "(other)" row. */
function groupsOf(map: Map<string, Acc>): GroupStats[] {
  const entries = [...map.entries()].sort((a, b) => b[1].continuations + b[1].exposures - (a[1].continuations + a[1].exposures));
  const keep = entries.slice(0, MAX_GROUPS);
  const rest = entries.slice(MAX_GROUPS);
  if (rest.length) {
    const other = newAcc();
    for (const [, a] of rest) merge(other, a);
    keep.push(['(other)', other]);
  }
  return keep.map(([k, a]) => finish(k, a));
}

function merge(into: Acc, a: Acc): void {
  for (const d of a.devices) into.devices.add(d);
  into.continuations += a.continuations; into.songs += a.songs; into.discovery += a.discovery; into.fallback += a.fallback;
  into.violations += a.violations; into.exposures += a.exposures; into.outcomeKnown += a.outcomeKnown; into.complete += a.complete;
  into.skip += a.skip; into.earlySkip += a.earlySkip; into.liked += a.liked; into.repeatKnown += a.repeatKnown; into.repeat += a.repeat;
  into.latency.push(...a.latency); into.heard.push(...a.heard); into.diversity.push(...a.diversity);
  for (const [k, v] of a.byReason) bump(into.byReason, k, v);
  for (const [k, v] of a.relaxed) bump(into.relaxed, k, v);
}

/**
 * Pure aggregation over rec_served / rec_outcome rows (any order). Every
 * field of `meta` is treated as untrusted: unknown values are dropped, not
 * guessed. Repeats are exposures of a song the same device was already
 * served earlier in the window; the pair is never returned.
 */
export function aggregateRecQuality(rows: RecEventRow[]): RecQualityReport {
  const overall = newAcc();
  const byAlg = new Map<string, Acc>();
  const byPicker = new Map<string, Acc>();
  const byVariant = new Map<string, Acc>();
  const seen = new Set<string>();
  const sorted = [...rows].sort((a, b) => ((a.created_at ?? '') < (b.created_at ?? '') ? -1 : (a.created_at ?? '') > (b.created_at ?? '') ? 1 : 0));

  for (const row of sorted) {
    const device = label(row.device_id, 128);
    if (!device || device === 'admin') continue;
    const m = obj(row.meta);
    if (!m) continue;
    const isServed = row.type === 'rec_served';
    const isOutcome = row.type === 'rec_outcome';
    if (!isServed && !isOutcome) continue;

    const alg = label(m.alg) || '(unknown)';
    const picker = m.picker === 'local' || m.picker === 'ai' ? m.picker : '(unknown)';
    const pairs = expPairs(m.exp);
    const targets: Acc[] = [overall];
    const pick = (map: Map<string, Acc>, k: string): void => {
      let a = map.get(k);
      if (!a) { a = newAcc(); map.set(k, a); }
      targets.push(a);
    };
    pick(byAlg, alg);
    pick(byPicker, picker);
    if (pairs.length) for (const p of pairs) pick(byVariant, p);
    else pick(byVariant, '(no experiment)');

    if (isServed) {
      const n = num(m.n, 40) ?? 0;
      const discovery = Math.min(n, num(m.discovery, 40) ?? 0);
      const latency = num(m.latencyMs, 120_000);
      const fb = m.fallback == null ? null : (FALLBACK_REASONS as readonly unknown[]).includes(m.fallback) ? (m.fallback as string) : 'other';
      const violations = Math.min(n, num(m.languageViolations, 40) ?? 0);
      const distinct = num(m.distinctArtists, 40);
      const relaxed = Array.isArray(m.relaxed) ? [...new Set(m.relaxed.map((x) => label(x, 32)).filter(Boolean))].slice(0, 8) : [];
      for (const a of targets) {
        a.devices.add(device);
        a.continuations += 1;
        a.songs += n;
        a.discovery += discovery;
        if (latency !== null) a.latency.push(latency);
        if (fb) { a.fallback += 1; bump(a.byReason, fb); }
        a.violations += violations;
        if (distinct !== null) a.diversity.push(distinct);
        for (const r of relaxed) bump(a.relaxed, r);
      }
    } else {
      const heard = num(m.heardSec, 7_200);
      const outcome = m.outcome;
      const known = outcome === 'complete' || outcome === 'skip' || outcome === 'early_skip' || outcome === 'partial';
      const isSkip = outcome === 'skip' || outcome === 'early_skip';
      const early = outcome === 'early_skip' || (outcome === 'skip' && heard !== null && heard < EARLY_SKIP_SEC);
      const song = label(row.song_id, 128);
      let repeat: boolean | null = null;
      if (song) {
        const pair = `${device}\u0000${song}`;
        repeat = seen.has(pair);
        seen.add(pair);
      }
      for (const a of targets) {
        a.devices.add(device);
        a.exposures += 1;
        if (heard !== null) a.heard.push(heard);
        if (known) {
          a.outcomeKnown += 1;
          if (outcome === 'complete') a.complete += 1;
          if (isSkip) a.skip += 1;
          if (early) a.earlySkip += 1;
        }
        if (m.liked === true) a.liked += 1;
        if (repeat !== null) {
          a.repeatKnown += 1;
          if (repeat) a.repeat += 1;
        }
      }
    }
  }
  seen.clear();

  return {
    devices: overall.devices.size,
    overall: finish('all', overall),
    byAlg: groupsOf(byAlg),
    byPicker: groupsOf(byPicker),
    byVariant: groupsOf(byVariant),
  };
}

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!(await isAdminAsync(request, env))) return unauthorized();
  if (!supabaseConfigured(env)) return json({ configured: false });
  const days = Math.min(90, Math.max(1, parseInt(new URL(request.url).searchParams.get('days') ?? '7', 10) || 7));
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const read = await sbSelectResult<RecEventRow>(
    env,
    'vinax_events',
    `created_at=gte.${encodeURIComponent(since)}&type=in.(rec_served,rec_outcome)&select=type,device_id,song_id,created_at,meta&order=created_at.desc&limit=${ROW_CAP}`,
  );
  if (!read.ok) {
    // A 400 is what PostgREST answers for a column that does not exist. Probe
    // the same table without `meta`: if that works, the telemetry migration
    // simply has not run — say so instead of calling it an outage.
    if (read.error === 'bad_request') {
      const probe = await sbSelectResult<{ type: string }>(env, 'vinax_events', 'select=type&limit=1');
      if (probe.ok) {
        return json({ configured: true, provisioned: false, days, error: 'meta_not_provisioned', note: 'vinax_events has no meta column yet, so no recommendation telemetry can be stored. Run the telemetry migration.' });
      }
    }
    return json({ configured: true, error: dbErrorCode(read.error), upstreamStatus: read.httpStatus }, 502);
  }
  const report = aggregateRecQuality(read.rows);
  return json({
    configured: true,
    provisioned: true,
    scope: 'opt-in',
    days,
    sampled: read.rows.length,
    truncated: read.rows.length >= ROW_CAP,
    minDevices: MIN_DEVICES,
    earlySkipSec: EARLY_SKIP_SEC,
    ...report,
  });
};
