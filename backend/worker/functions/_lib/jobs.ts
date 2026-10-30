/**
 * Scheduled jobs. The Worker's Cron Trigger fires every 30 minutes
 * (wrangler.toml [triggers]); `runScheduled` decides what is due and every
 * run leaves a `job_runs` row the Database page reads. `runJob` runs one job
 * now (POST /api/cron/run, or the console's "Run now").
 *
 *   status-tick    every run    probe the public components, uptime_tick each
 *   housekeeping   hourly       room_sweep · purge_events(retention) · retire_push_devices
 *   ai-models      every run    check the due AI models; the menus offer only those that answer (1.2.7)
 *
 * Nothing runs without the database: the jobs exist to write into it.
 */
import { db, dbConfigured, type DbEnv } from './db';
import { setting } from './settings';
import { COMPONENTS, probeAll } from '../api/status';
import { runModelHealth } from './modelHealthJob';
import type { AiEnv } from './ai';

export type JobId = 'status-tick' | 'housekeeping' | 'ai-models';

export interface JobSpec {
  id: JobId;
  label: string;
  schedule: string;
  /** Minutes after which a missing run counts as overdue. */
  maxAgeMin: number;
  /** Is the job due at this scheduled time? */
  due(at: Date): boolean;
}

export const JOBS: readonly JobSpec[] = [
  { id: 'status-tick', label: 'Status tick', schedule: 'every 30 min', maxAgeMin: 75, due: () => true },
  { id: 'housekeeping', label: 'Housekeeping', schedule: 'hourly', maxAgeMin: 180, due: (at) => at.getUTCMinutes() < 30 },
  { id: 'ai-models', label: 'AI model check', schedule: 'every 30 min', maxAgeMin: 75, due: () => true },
];

export const isJobId = (v: unknown): v is JobId => JOBS.some((j) => j.id === v);

export interface JobResult {
  job: JobId;
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  ms: number;
  summary: Record<string, unknown>;
}

async function statusTick(env: DbEnv, now: number): Promise<Record<string, unknown>> {
  const probes = await probeAll(now);
  const out: Record<string, unknown> = {};
  let failed = 0;
  for (const c of COMPONENTS) {
    const p = probes.get(c.id);
    if (!p) continue;
    const r = await db.rpc(env, 'uptime_tick', { p_component: c.id, p_ok: p.ok, p_latency_ms: p.latency });
    if (!r.ok) failed += 1;
    out[c.id] = p.ok ? 'up' : 'down';
  }
  if (failed) out.writeFailures = failed;
  return out;
}

async function housekeeping(env: DbEnv): Promise<Record<string, unknown>> {
  const retention = await setting<{ eventsDays?: unknown }>(env, 'retention');
  const keep = typeof retention?.eventsDays === 'number' && Number.isFinite(retention.eventsDays) ? Math.min(3650, Math.max(7, Math.round(retention.eventsDays))) : 180;
  const [rooms, purged, retired] = await Promise.all([
    db.rpc<{ rooms: number; members: number }>(env, 'room_sweep'),
    db.rpc<number>(env, 'purge_events', { p_keep_days: keep }),
    db.rpc<number>(env, 'retire_push_devices', { p_days: 180 }),
  ]);
  const out: Record<string, unknown> = { eventsKeptDays: keep };
  out.roomsSwept = rooms.ok ? rooms.value : `failed: ${rooms.error}`;
  out.eventsPurged = purged.ok ? purged.value : `failed: ${purged.error}`;
  out.pushRetired = retired.ok ? retired.value : `failed: ${retired.error}`;
  if (!rooms.ok || !purged.ok || !retired.ok) throw new Error('housekeeping: a step failed');
  return out;
}

/** Run one job now, recording the run. Never throws. */
export async function runJob(env: DbEnv, job: JobId, now = Date.now()): Promise<JobResult> {
  const startedAt = new Date(now).toISOString();
  const started = await db.insert<{ id: number }>(env, 'job_runs', { job, started_at: startedAt }, { returning: true });
  const runId = started.ok ? started.rows[0]?.id : undefined;
  let ok = true;
  let summary: Record<string, unknown> = {};
  try {
    summary =
      job === 'status-tick' ? await statusTick(env, now) : job === 'housekeeping' ? await housekeeping(env) : await runModelHealth(env as DbEnv & AiEnv, now);
  } catch (e) {
    ok = false;
    summary = { ...summary, error: e instanceof Error ? e.message.slice(0, 200) : 'failed' };
  }
  const finished = Date.now();
  const finishedAt = new Date(finished).toISOString();
  if (runId !== undefined) await db.update(env, 'job_runs', `id=eq.${runId}`, { finished_at: finishedAt, ok, summary });
  return { job, ok, startedAt, finishedAt, ms: finished - now, summary };
}

let warnedUnconfigured = false;

/** The Cron Trigger entry: run every job that is due at `scheduledTime`. */
export async function runScheduled(env: DbEnv, scheduledTime: number): Promise<JobResult[]> {
  if (!dbConfigured(env)) {
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      console.log('[jobs] no database configured — scheduled jobs skipped');
    }
    return [];
  }
  const at = new Date(scheduledTime);
  const out: JobResult[] = [];
  for (const j of JOBS) if (j.due(at)) out.push(await runJob(env, j.id, Date.now()));
  return out;
}
