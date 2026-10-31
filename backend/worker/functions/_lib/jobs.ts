/**
 * Scheduled jobs. The Worker's Cron Trigger fires every 30 minutes
 * (wrangler.toml [triggers]); `runScheduled` decides what is due and every
 * run leaves a `job_runs` row the Database page reads. `runJob` runs one job
 * now (POST /api/cron/run, or the console's "Run now").
 *
 *   status-tick    every run    probe the public components, uptime_tick each
 *   housekeeping   hourly       room_sweep · purge_events(retention) · retire_push_devices
 *                               · VinaX AI chats deleted more than a day ago, and files never sent
 *                               · the personal engine: old events and pages purged, and once a day
 *                                 (the 21:00 UTC run) co-listening rebuilt
 *   personal-embed every run    confirm up to 25 device-asserted songs with the catalogue, then embed
 *                               up to 200 verified songs that have no vector in the configured model yet
 *
 * Nothing runs without the database: the jobs exist to write into it.
 */
import { DAY_MS, db, dbConfigured, q, since, type DbEnv } from './db';
import { setting } from './settings';
import { purgeAiChats } from './ai/cleanup';
import { personalConfig } from './personal/config';
import { runEmbedBacklog, runVerifyBacklog, type EmbedEnv } from './personal/embed';
import { COMPONENTS, probeAll } from '../api/status';

export type JobId = 'status-tick' | 'housekeeping' | 'personal-embed';

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
  { id: 'personal-embed', label: 'Personal engine: embed', schedule: 'every 30 min', maxAgeMin: 75, due: () => true },
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

/** The daily step runs on the housekeeping run after 21:00 UTC (the quiet early hours in India). */
export const COLISTEN_HOUR_UTC = 21;

async function housekeeping(env: DbEnv, now = Date.now()): Promise<Record<string, unknown>> {
  const retention = await setting<{ eventsDays?: unknown }>(env, 'retention');
  const daily = new Date(now).getUTCHours() === COLISTEN_HOUR_UTC;
  const keep = typeof retention?.eventsDays === 'number' && Number.isFinite(retention.eventsDays) ? Math.min(3650, Math.max(7, Math.round(retention.eventsDays))) : 180;
  const [rooms, purged, retired, chats, , colisten, personalPurged] = await Promise.all([
    db.rpc<{ rooms: number; members: number }>(env, 'room_sweep'),
    db.rpc<number>(env, 'purge_events', { p_keep_days: keep }),
    db.rpc<number>(env, 'retire_push_devices', { p_days: 180 }),
    // Deleted VinaX AI chats are hidden at once and removed (with messages and files) a day later.
    purgeAiChats(env),
    // VinaX AI's daily allowance rows are only needed for today; keep a quarter for the record.
    db.remove(env, 'ai_daily_usage', q().lt('day', since(90 * DAY_MS).slice(0, 10))),
    // The personal engine: what it no longer needs, and once a day who plays what together (last 30 days).
    daily ? db.rpc<{ pairs: number }>(env, 'personal_refresh_colisten', { p_days: 30, p_cap: 50 }, { timeoutMs: 120_000 }) : Promise.resolve(null),
    db.rpc<{ events: number; pages: number }>(env, 'personal_purge', { p_keep_days: 365 }),
  ]);
  const out: Record<string, unknown> = { eventsKeptDays: keep };
  out.roomsSwept = rooms.ok ? rooms.value : `failed: ${rooms.error}`;
  out.eventsPurged = purged.ok ? purged.value : `failed: ${purged.error}`;
  out.pushRetired = retired.ok ? retired.value : `failed: ${retired.error}`;
  // Not fatal: before schema v4 is applied the table does not exist yet.
  out.aiChatsPurged = chats.chats;
  out.aiFilesPurged = chats.files;
  // Not fatal: before schema v7 is applied the personal tables do not exist yet.
  if (colisten) out.colistenPairs = colisten.ok ? colisten.value?.pairs : `failed: ${colisten.error}`;
  out.personalPurged = personalPurged.ok ? personalPurged.value : `failed: ${personalPurged.error}`;
  if (!rooms.ok || !purged.ok || !retired.ok) throw new Error('housekeeping: a step failed');
  return out;
}

async function personalEmbed(env: DbEnv): Promise<Record<string, unknown>> {
  const config = await personalConfig(env);
  if (!config.enabled) return { skipped: 'disabled' };
  const v = await runVerifyBacklog(env as EmbedEnv, 25);
  const r = await runEmbedBacklog(env as EmbedEnv, config.embedModel, 200);
  return { model: config.embedModel, verified: v.verified, dropped: v.dropped, embedded: r.embedded, backlog: r.backlog };
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
      job === 'status-tick' ? await statusTick(env, now) : job === 'personal-embed' ? await personalEmbed(env) : await housekeeping(env, now);
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
