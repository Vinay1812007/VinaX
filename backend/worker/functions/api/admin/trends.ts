/**
 * GET/POST /api/admin/trends — Trend Operations in the owner console.
 *
 * GET: provider status and why, last successful refresh and last error per
 * source and region, stale data, quota used today against the ceiling, the
 * oldest stored observation (retention), the match confidence distribution,
 * the review queue (ambiguous and unmatched items, with candidates and the
 * source's own title and evidence link), recent review decisions, and the
 * editorial entries (active, upcoming, expiring soon, expired).
 *
 * POST { action }:
 *   review           { id, decision: accept|reject|correct, catalogId?, note?, reviewer? }
 *   validate-import  { format: csv|json, data }  → every problem by row and field; writes nothing
 *   import           { format, data }            → all-or-nothing; then refreshes editorial
 *   withdraw         { editorialId }             → stops showing an editorial entry now
 *   run              { source?, region? }        → run ingestion now (quota ceiling still applies)
 *
 * Every handler checks isAdmin first; every mutation leaves an audit row.
 */
import { isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { logAdminAudit } from '../../_lib/adminAudit';
import { dbErrorCode, sbInsertIgnore, sbSelectResult, sbUpdate, supabaseConfigured } from '../../_lib/supabase';
import { lookupCatalogSong } from '../../_lib/trends/catalog';
import { EDITORIAL_COLUMNS, type EditorialRow } from '../../_lib/trends/editorial';
import { readImport } from '../../_lib/trends/importer';
import { inList, runIngest } from '../../_lib/trends/ingest';
import { AUTO_MATCH_THRESHOLD } from '../../_lib/trends/matcher';
import { PROVIDERS, providerById, TRENDS_POLICY } from '../../_lib/trends/registry';
import { applyReview, type ReviewDecision } from '../../_lib/trends/review';
import { configuredRegions, REGION_RE, type TrendsEnv } from '../../_lib/trends/types';

type Env = AdminEnv & TrendsEnv;

function json(o: unknown, status = 200): Response {
  return new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

interface RunRow {
  id: string;
  source: string;
  region: string;
  trigger: string;
  started_at: string;
  finished_at: string | null;
  ok: boolean;
  status: string;
  error: string | null;
  attempts: number;
  items_fetched: number;
  items_inserted: number;
  matched: number;
  queued_for_review: number;
  quota_units: number;
  duplicate_snapshot: boolean;
}

interface MatchRowFull {
  id: number;
  source: string;
  source_item_id: string;
  catalog_id: string | null;
  catalog_title: string | null;
  catalog_artist: string | null;
  mapping_confidence: number;
  method: string;
  status: string;
  reason: string | null;
  candidates: unknown;
  reviewed_by: string | null;
  reviewed_at: string | null;
  history: unknown;
  first_seen_at: string;
  last_seen_at: string;
}

/** Confidence histogram buckets (lower bound inclusive). */
export function confidenceBuckets(rows: Array<{ mapping_confidence: number }>): Array<{ range: string; count: number }> {
  const edges: Array<[string, number, number]> = [['0–0.5', 0, 0.5], ['0.5–0.8', 0.5, AUTO_MATCH_THRESHOLD], [`${AUTO_MATCH_THRESHOLD}–0.9`, AUTO_MATCH_THRESHOLD, 0.9], ['0.9–1', 0.9, 1.0001]];
  return edges.map(([range, lo, hi]) => ({ range, count: rows.filter((r) => Number(r.mapping_confidence) >= lo && Number(r.mapping_confidence) < hi).length }));
}

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!isAdmin(request, env)) return unauthorized();

  const now = new Date();
  const regions = configuredRegions(env);
  const providers = PROVIDERS.map((p) => ({
    id: p.id,
    label: p.label(env),
    kind: p.kind,
    status: p.status(env),
    reason: p.statusReason(env),
    chart: p.chart,
    derivedMetricsAllowed: p.derivedMetricsAllowed(env),
    dailyUnitBudget: p.dailyUnitBudget(env),
    maxUnitsPerRun: p.maxUnitsPerRun(env),
  }));
  const policy = { ...TRENDS_POLICY, autoMatchThreshold: AUTO_MATCH_THRESHOLD, regions };
  if (!supabaseConfigured(env)) return json({ configured: false, providers, policy });

  const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const [runs, today, snaps, oldest, dist, queue, decided, editorial] = await Promise.all([
    sbSelectResult<RunRow>(env, 'vinax_trend_runs', 'select=id,source,region,trigger,started_at,finished_at,ok,status,error,attempts,items_fetched,items_inserted,matched,queued_for_review,quota_units,duplicate_snapshot&order=started_at.desc&limit=60'),
    sbSelectResult<{ source: string; quota_units: number }>(env, 'vinax_trend_runs', `select=source,quota_units&started_at=gte.${encodeURIComponent(midnight)}&limit=2000`),
    sbSelectResult<{ source: string; region: string; chart: string; observed_at: string; fetched_at: string; item_count: number }>(env, 'vinax_trend_snapshots', 'select=source,region,chart,observed_at,fetched_at,item_count&order=observed_at.desc&limit=80'),
    sbSelectResult<{ fetched_at: string }>(env, 'vinax_trend_snapshots', 'select=fetched_at&order=fetched_at.asc&limit=1'),
    sbSelectResult<{ status: string; mapping_confidence: number }>(env, 'vinax_trend_matches', 'select=status,mapping_confidence&limit=5000'),
    sbSelectResult<MatchRowFull>(env, 'vinax_trend_matches', 'select=id,source,source_item_id,catalog_id,catalog_title,catalog_artist,mapping_confidence,method,status,reason,candidates,reviewed_by,reviewed_at,history,first_seen_at,last_seen_at&status=eq.review&order=last_seen_at.desc&limit=100'),
    sbSelectResult<MatchRowFull>(env, 'vinax_trend_matches', 'select=id,source,source_item_id,catalog_id,catalog_title,catalog_artist,mapping_confidence,method,status,reason,candidates,reviewed_by,reviewed_at,history,first_seen_at,last_seen_at&reviewed_at=not.is.null&order=reviewed_at.desc&limit=20'),
    sbSelectResult<EditorialRow>(env, 'vinax_trend_editorial', `select=${EDITORIAL_COLUMNS}&order=expires_at.asc&limit=300`),
  ]);
  const failed = [runs, today, snaps, oldest, dist, queue, decided, editorial].find((r) => !r.ok);
  if (failed && !failed.ok) return json({ configured: true, error: dbErrorCode(failed.error), providers, policy }, 503);

  // The source's own title, link and rank for every item in the queue and in recent decisions.
  const itemIds = [...new Set([...queue.rows, ...decided.rows].map((m) => m.source_item_id))];
  const obs = itemIds.length
    ? await sbSelectResult<{ source: string; source_item_id: string; title: string; credit: string | null; url: string | null; source_rank: number; region: string; observed_at: string }>(
        env,
        'vinax_trend_observations',
        `select=source,source_item_id,title,credit,url,source_rank,region,observed_at&source_item_id=in.${encodeURIComponent(inList(itemIds))}&order=observed_at.desc&limit=1000`,
      )
    : { ok: true as const, rows: [] };
  const latestObs = new Map<string, (typeof obs.rows)[number]>();
  for (const o of obs.rows) if (!latestObs.has(`${o.source}|${o.source_item_id}`)) latestObs.set(`${o.source}|${o.source_item_id}`, o);
  const withEvidence = (m: MatchRowFull) => ({ ...m, observation: latestObs.get(`${m.source}|${m.source_item_id}`) ?? null });

  const staleMs = TRENDS_POLICY.staleAfterHours * 3_600_000;
  const freshness = PROVIDERS.flatMap((p) =>
    regions.map((region) => {
      const mine = runs.rows.filter((r) => r.source === p.id && r.region === region);
      const lastOk = mine.find((r) => r.ok && r.finished_at);
      const lastErr = mine.find((r) => r.status === 'error');
      const snap = snaps.rows.find((s) => s.source === p.id && s.region === region);
      const lastSuccessAt = lastOk?.finished_at ?? null;
      return {
        source: p.id,
        region,
        lastRunAt: mine[0]?.started_at ?? null,
        lastSuccessAt,
        stale: p.status(env) === 'ok' && (!lastSuccessAt || now.getTime() - Date.parse(lastSuccessAt) > staleMs),
        lastError: lastErr ? { at: lastErr.started_at, error: lastErr.error, attempts: lastErr.attempts } : null,
        latestSnapshot: snap ?? null,
      };
    }),
  );
  const quota = PROVIDERS.map((p) => ({
    source: p.id,
    usedToday: today.rows.filter((r) => r.source === p.id).reduce((n, r) => n + (Number(r.quota_units) || 0), 0),
    dailyBudget: p.dailyUnitBudget(env),
    maxUnitsPerRun: p.maxUnitsPerRun(env),
  }));
  const byStatus: Record<string, number> = {};
  for (const r of dist.rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  const nowMs = now.getTime();
  const soonMs = 72 * 3_600_000;
  const classify = (e: EditorialRow): string => {
    if (e.status !== 'active') return 'withdrawn';
    const start = Date.parse(e.starts_at);
    const end = Date.parse(e.expires_at);
    if (end <= nowMs) return 'expired';
    if (start > nowMs) return 'upcoming';
    return end - nowMs <= soonMs ? 'expiring' : 'active';
  };
  const oldestAt = oldest.rows[0]?.fetched_at ?? null;

  return json({
    configured: true,
    generatedAt: now.toISOString(),
    providers,
    policy,
    freshness,
    quota,
    retention: { oldestStoredAt: oldestAt, oldestStoredDays: oldestAt ? Math.floor((nowMs - Date.parse(oldestAt)) / 86_400_000) : null, limitDays: TRENDS_POLICY.retentionDays },
    matches: { byStatus, confidence: confidenceBuckets(dist.rows), total: dist.rows.length },
    reviewQueue: queue.rows.map(withEvidence),
    recentDecisions: decided.rows.map(withEvidence),
    editorial: editorial.rows.map((e) => ({ ...e, state: classify(e) })),
    runs: runs.rows,
  });
};

export const onRequestPost = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!isAdmin(request, env)) return unauthorized();
  if (!supabaseConfigured(env)) return json({ error: 'db_not_configured' }, 503);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = typeof body?.action === 'string' ? body.action : '';
  const now = new Date();

  if (action === 'review') {
    const result = await applyReview(
      env,
      { id: Number(body?.id), decision: String(body?.decision ?? '') as ReviewDecision, catalogId: typeof body?.catalogId === 'string' ? body.catalogId : null, note: typeof body?.note === 'string' ? body.note : null, reviewer: typeof body?.reviewer === 'string' ? body.reviewer : null },
      lookupCatalogSong,
      now,
    );
    if (!result.ok) return json({ error: result.error }, result.httpStatus);
    void logAdminAudit(env, 'trends-review', `match ${String(body?.id)} → ${result.status}${result.catalogId ? ` (${result.catalogId})` : ''}`);
    return json(result);
  }

  if (action === 'validate-import' || action === 'import') {
    const out = readImport(body?.format, body?.data, now);
    if (action === 'validate-import' || out.issues.length) {
      return json({ ok: out.issues.length === 0, rows: out.rows, valid: out.valid.length, issues: out.issues, preview: out.valid.slice(0, 50) }, out.issues.length && action === 'import' ? 400 : 200);
    }
    const batch = `import-${now.toISOString()}`;
    const reviewer = typeof body?.reviewer === 'string' && body.reviewer.trim() ? body.reviewer.trim().slice(0, 60) : 'owner';
    const inserted = await sbInsertIgnore<{ id: number; region: string }>(env, 'vinax_trend_editorial', out.valid.map((v) => ({ ...v, imported_by: reviewer, import_batch: batch })), 'dedupe_key');
    if (inserted === null) return json({ error: 'db_write_failed' }, 500);
    void logAdminAudit(env, 'trends-import', `${inserted.length} editorial entries (${out.valid.length - inserted.length} already imported)`);
    const regions = [...new Set(out.valid.map((v) => v.region))];
    const refresh = await runIngest(env, { sources: ['editorial'], regions, trigger: 'admin' });
    return json({ ok: true, inserted: inserted.length, alreadyImported: out.valid.length - inserted.length, refresh: refresh.runs });
  }

  if (action === 'withdraw') {
    const id = Number(body?.editorialId);
    if (!Number.isInteger(id) || id <= 0) return json({ error: 'bad_id' }, 400);
    const row = await sbSelectResult<{ id: number; region: string; title: string }>(env, 'vinax_trend_editorial', `select=id,region,title&id=eq.${id}&limit=1`);
    if (!row.ok) return json({ error: dbErrorCode(row.error) }, 503);
    if (!row.rows[0]) return json({ error: 'not_found' }, 404);
    const ok = await sbUpdate(env, 'vinax_trend_editorial', `id=eq.${id}`, { status: 'withdrawn' });
    if (!ok) return json({ error: 'db_write_failed' }, 500);
    void logAdminAudit(env, 'trends-withdraw', `editorial ${id} — ${row.rows[0].title}`);
    const refresh = await runIngest(env, { sources: ['editorial'], regions: [row.rows[0].region], trigger: 'admin' });
    return json({ ok: true, refresh: refresh.runs });
  }

  if (action === 'run') {
    const source = typeof body?.source === 'string' ? body.source.trim().toLowerCase() : '';
    const region = typeof body?.region === 'string' ? body.region.trim().toUpperCase() : '';
    if (source && !providerById(source)) return json({ error: 'unknown_source' }, 400);
    if (region && !REGION_RE.test(region)) return json({ error: 'bad_region' }, 400);
    const result = await runIngest(env, { sources: source ? [source] : undefined, regions: region ? [region] : undefined, trigger: 'admin' });
    void logAdminAudit(env, 'trends-run', `${source || 'all sources'} · ${region || 'all regions'} → ${result.runs.map((r) => `${r.source}/${r.region}:${r.status}`).join(', ') || 'nothing ran'}`);
    return json(result);
  }

  return json({ error: 'unknown_action' }, 400);
};
