/**
 * GET  /api/admin/database → { configured, reachable, schema, tables, counts, jobs, retention, missing }
 * POST /api/admin/database { action: 'purge_events', days } | { action: 'sweep_rooms' }
 *                          | { action: 'retire_push', days } | { action: 'run_job', job }
 *
 * The database itself: is it reachable, which schema version is applied,
 * every table's size, the scheduled jobs' last runs, and the maintenance
 * actions.
 */
import { adminJson, badRequest, dbFailure } from '../../_lib/admin';
import { adminGet, adminPost } from '../../_lib/adminRoute';
import { db, q } from '../../_lib/db';
import { intIn } from '../../_lib/edge';
import { isJobId, JOBS, runJob } from '../../_lib/jobs';
import { setting } from '../../_lib/settings';

export const EXPECTED_TABLES = [
  'meta', 'listeners', 'accounts', 'account_backups', 'events', 'ai_calls', 'feedback', 'blocked_content', 'rooms', 'room_members',
  'push_devices', 'notifications', 'settings', 'settings_history', 'experiments', 'audit_log', 'uptime_days', 'uptime_latest', 'job_runs',
] as const;

interface MetaRow { value: { version?: number; appliedAt?: string } }
interface TableRow { name: string; rows: number; bytes: number }
interface RunRow { job: string; started_at: string; finished_at: string | null; ok: boolean | null; summary: unknown }

export const onRequestGet = adminGet(async ({ env }) => {
  const [meta, tables, counts, runs, retention] = await Promise.all([
    db.select<MetaRow>(env, 'meta', q().eq('key', 'schema').select('value').limit(1)),
    db.rpc<TableRow[]>(env, 'table_stats'),
    db.rpc<Record<string, number>>(env, 'table_counts'),
    db.select<RunRow>(env, 'job_runs', q().select('job,started_at,finished_at,ok,summary').order('started_at', 'desc').limit(50)),
    setting<{ eventsDays?: unknown }>(env, 'retention'),
  ]);
  if (!meta.ok) {
    // The database refused or is down: say so rather than list empty tables.
    if (meta.error !== 'not_found') return dbFailure(meta, { reachable: false });
  }
  const reachable = meta.ok;
  const schema = meta.ok && meta.rows[0]?.value ? { version: meta.rows[0].value.version ?? null, appliedAt: meta.rows[0].value.appliedAt ?? null } : null;
  const tableRows = tables.ok && Array.isArray(tables.value) ? tables.value : [];
  const present = new Set(tableRows.map((t) => t.name));
  const missing = tables.ok ? EXPECTED_TABLES.filter((t) => !present.has(t)) : [...EXPECTED_TABLES];
  const latest = new Map<string, RunRow>();
  if (runs.ok) for (const r of runs.rows) if (!latest.has(r.job)) latest.set(r.job, r);
  const now = Date.now();
  const jobs = JOBS.map((j) => {
    const last = latest.get(j.id) ?? null;
    const ageMin = last ? Math.round((now - Date.parse(last.started_at)) / 60_000) : null;
    return {
      job: j.id, label: j.label, schedule: j.schedule, maxAgeMin: j.maxAgeMin,
      lastAt: last?.started_at ?? null, finishedAt: last?.finished_at ?? null, ok: last?.ok ?? null, summary: last?.summary ?? null,
      ageMin, overdue: ageMin !== null && ageMin > j.maxAgeMin, neverRan: last === null,
    };
  });
  const eventsDays = typeof retention?.eventsDays === 'number' && Number.isFinite(retention.eventsDays) ? Math.round(retention.eventsDays) : 180;
  return adminJson({
    configured: true,
    reachable,
    schema,
    tables: tableRows,
    counts: counts.ok && counts.value ? counts.value : {},
    jobs,
    jobsReadable: runs.ok,
    retention: { eventsDays },
    missing,
    checkedAt: new Date(now).toISOString(),
  });
});

export const onRequestPost = adminPost(async ({ env, body, audit }) => {
  if (body.action === 'purge_events') {
    const days = intIn(body.days, 7, 3650);
    if (!days) return badRequest('bad_days');
    const r = await db.rpc<number>(env, 'purge_events', { p_keep_days: days });
    if (!r.ok) return dbFailure(r);
    await audit({ action: 'db-purge-events', summary: `purged ${r.value ?? 0} events older than ${days} days`, after: { days, deleted: r.value } });
    return adminJson({ ok: true, deleted: r.value ?? 0, days });
  }
  if (body.action === 'sweep_rooms') {
    const r = await db.rpc<{ rooms: number; members: number }>(env, 'room_sweep');
    if (!r.ok) return dbFailure(r);
    await audit({ action: 'db-sweep-rooms', summary: `swept ${r.value?.rooms ?? 0} rooms and ${r.value?.members ?? 0} members`, after: r.value });
    return adminJson({ ok: true, ...(r.value ?? { rooms: 0, members: 0 }) });
  }
  if (body.action === 'retire_push') {
    const days = intIn(body.days, 7, 3650) ?? 180;
    const r = await db.rpc<number>(env, 'retire_push_devices', { p_days: days });
    if (!r.ok) return dbFailure(r);
    await audit({ action: 'db-retire-push', summary: `retired ${r.value ?? 0} push devices quiet for ${days} days`, after: { days, retired: r.value } });
    return adminJson({ ok: true, retired: r.value ?? 0, days });
  }
  if (body.action === 'run_job') {
    if (!isJobId(body.job)) return badRequest('unknown_job', { jobs: JOBS.map((j) => j.id) });
    const result = await runJob(env, body.job);
    await audit({ action: 'job-run', summary: `ran ${body.job} by hand (${result.ok ? 'ok' : 'failed'})`, target: body.job, after: result.summary });
    return adminJson({ ok: true, result });
  }
  return badRequest('unknown_action');
});
