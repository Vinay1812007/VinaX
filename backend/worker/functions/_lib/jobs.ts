/**
 * Scheduled jobs. The Worker's Cron Trigger fires on the schedule in
 * wrangler.toml [triggers]; `runScheduled` decides what is due and every run
 * leaves a `job_runs` row the Database page reads. `runJob` runs one job now
 * (POST /api/cron/run, or the console's "Run now").
 *
 *   status-tick              every 30 min   probe the public components, uptime_tick each
 *   housekeeping             hourly         room_sweep · old data removed per the `retention` setting
 *                                           (usage, error reports, feedback, notification history)
 *                                           · retire_push_devices · VinaX AI chats deleted more than a
 *                                           day ago · the personal engine: old events and pages purged,
 *                                           and once a day (the 21:00 UTC run) co-listening rebuilt
 *   personal-embed           every 30 min   confirm device-asserted songs, then embed the backlog
 *   alerts                   every run      Smart Alerts: errors rising, site down, no plays, new
 *                                           feedback → one push to the admins' phones (_lib/alerts.ts)
 *   scheduled-notifications  every run      send notifications whose scheduled time has come
 *
 * Console rebuild — the owner can switch a job off or change how often it runs from
 * the console: the `jobs` setting `{ "<job>": { enabled, every } }` (every in
 * minutes). A job is due when it is on and its last run started at least
 * `every` minutes ago (a 2-minute grace absorbs cron jitter).
 *
 * Nothing runs without the database: the jobs exist to write into it.
 */
import { DAY_MS, db, dbConfigured, q, since, type DbEnv } from './db';
import { setting } from './settings';
import { purgeAiChats } from './ai/cleanup';
import { personalConfig } from './personal/config';
import { runEmbedBacklog, runVerifyBacklog, type EmbedEnv } from './personal/embed';
import { COMPONENTS, probeAll } from '../api/status';
import { runScheduledNotifications } from './scheduledPush';
import { runAlerts } from './alerts';

export type JobId = 'status-tick' | 'housekeeping' | 'personal-embed' | 'alerts' | 'scheduled-notifications';

export interface JobSpec {
  id: JobId;
  label: string;
  /** What the job does, in plain words (the console shows it). */
  about: string;
  /** Default minutes between runs. */
  every: number;
  /** The choices the console offers, in minutes. */
  choices: readonly number[];
}

export const JOBS: readonly JobSpec[] = [
  { id: 'status-tick', label: 'Status check', about: 'Checks that the website, the app and the music sources answer, and records it for the public status page.', every: 30, choices: [30, 60, 180, 360] },
  { id: 'housekeeping', label: 'Clean-up', about: 'Closes empty Listen Together rooms, removes data older than the Data & Privacy periods, and forgets phones that stopped receiving notifications.', every: 60, choices: [60, 180, 360, 720, 1440] },
  { id: 'personal-embed', label: 'Recommendation learning', about: 'Teaches the recommendation engine about newly played songs so “For you” picks get better.', every: 30, choices: [30, 60, 180, 360, 1440] },
  // Before the scheduled sends: a large scheduled audience must not spend the run's requests first.
  { id: 'alerts', label: 'Smart Alerts', about: 'Looks for problems (app errors rising, the site not answering, no songs played, new feedback) and alerts admins on their phones.', every: 5, choices: [5, 10, 15, 30] },
  { id: 'scheduled-notifications', label: 'Scheduled notifications', about: 'Sends notifications whose scheduled time has come.', every: 5, choices: [5, 15, 30, 60] },
] as const;

/** The owner's choices for one job, after checking them. */
export interface JobSetting { enabled: boolean; every: number }

/** The `jobs` setting for every job, with defaults and only allowed values. */
export function jobSettings(raw: unknown): Record<JobId, JobSetting> {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out = {} as Record<JobId, JobSetting>;
  for (const j of JOBS) {
    const v = src[j.id] && typeof src[j.id] === 'object' ? (src[j.id] as Record<string, unknown>) : {};
    const every = typeof v.every === 'number' && j.choices.includes(v.every) ? v.every : j.every;
    out[j.id] = { enabled: v.enabled !== false, every };
  }
  return out;
}

/** Minutes after which a job with no newer run counts as late. */
export const lateAfter = (every: number): number => Math.max(every * 2 + 15, 45);

/** Is the job due: on, and its last run started `every` minutes ago or more (2 minutes' grace). */
export function isDue(cfg: JobSetting, lastStartedAt: string | null, at: number): boolean {
  if (!cfg.enabled) return false;
  if (!lastStartedAt) return true;
  const age = (at - Date.parse(lastStartedAt)) / 60_000;
  return !Number.isFinite(age) || age >= cfg.every - 2;
}

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

/** The daily step prefers the clean-up run from 21:00 UTC (the quiet early hours in India). */
export const COLISTEN_HOUR_UTC = 21;

/** How long each kind of data is kept, from the `retention` setting. 0 / missing = forever, except usage (default 180). */
export function retentionOf(raw: unknown): { eventsDays: number; errorsDays: number | null; feedbackDays: number | null; notificationsDays: number | null } {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const days = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(3650, Math.max(7, Math.round(v))) : null);
  return { eventsDays: days(r.eventsDays) ?? 180, errorsDays: days(r.errorsDays), feedbackDays: days(r.feedbackDays), notificationsDays: days(r.notificationsDays) };
}

/** Hours between two "played together" rebuilds; a missed evening is caught up after this many. */
const COLISTEN_EVERY_H = 20;
const COLISTEN_CATCH_UP_H = 30;

/**
 * Is the daily "played together" rebuild due? It runs on the first clean-up
 * from 21:00 UTC once the last rebuild (a `colisten` row in job_runs) is 20
 * hours old, or on any clean-up once it is 30 hours old, so a clean-up set to
 * run every 3, 6, 12 or 24 hours never skips it for long.
 */
export function colistenDue(lastIso: string | null, now: number): boolean {
  const age = lastIso ? (now - Date.parse(lastIso)) / 3_600_000 : Infinity;
  if (!Number.isFinite(age)) return true;
  return (new Date(now).getUTCHours() >= COLISTEN_HOUR_UTC && age >= COLISTEN_EVERY_H) || age >= COLISTEN_CATCH_UP_H;
}

async function housekeeping(env: DbEnv, now = Date.now()): Promise<Record<string, unknown>> {
  const keep = retentionOf(await setting(env, 'retention'));
  const lastColisten = await db.select<{ started_at: string }>(env, 'job_runs', q().eq('job', 'colisten').select('started_at').order('started_at', 'desc').limit(1));
  const daily = lastColisten.ok && colistenDue(lastColisten.rows[0]?.started_at ?? null, now);
  // With a separate period for error reports, usage and errors are purged
  // apart; otherwise one purge keeps the old behaviour (errors with usage).
  const usage = keep.errorsDays
    ? db.rpc<number>(env, 'purge_kind', { p_kind: 'plays', p_keep_days: keep.eventsDays })
    : db.rpc<number>(env, 'purge_events', { p_keep_days: keep.eventsDays });
  const [rooms, purged, retired, chats, , colisten, personalPurged] = await Promise.all([
    db.rpc<{ rooms: number; members: number }>(env, 'room_sweep'),
    usage,
    db.rpc<number>(env, 'retire_push_devices', { p_days: 180 }),
    // Deleted VinaX AI chats are hidden at once and removed (with messages and files) a day later.
    purgeAiChats(env),
    // VinaX AI's daily allowance rows are only needed for today; keep a quarter for the record.
    db.remove(env, 'ai_daily_usage', q().lt('day', since(90 * DAY_MS).slice(0, 10))),
    // The personal engine: what it no longer needs, and once a day who plays what together (last 30 days).
    daily ? db.rpc<{ pairs: number }>(env, 'personal_refresh_colisten', { p_days: 30, p_cap: 50 }, { timeoutMs: 120_000 }) : Promise.resolve(null),
    db.rpc<{ events: number; pages: number }>(env, 'personal_purge', { p_keep_days: 365 }),
  ]);
  const out: Record<string, unknown> = { eventsKeptDays: keep.eventsDays };
  out.roomsSwept = rooms.ok ? rooms.value : `failed: ${rooms.error}`;
  out.eventsPurged = purged.ok ? purged.value : `failed: ${purged.error}`;
  out.pushRetired = retired.ok ? retired.value : `failed: ${retired.error}`;
  // The optional per-kind periods (Data & Privacy). Not fatal: before schema
  // v8 is applied purge_kind does not exist yet.
  for (const [kind, d] of [['errors', keep.errorsDays], ['feedback', keep.feedbackDays], ['notifications', keep.notificationsDays]] as const) {
    if (!d) continue;
    const r = await db.rpc<number>(env, 'purge_kind', { p_kind: kind, p_keep_days: d });
    out[`${kind}Purged`] = r.ok ? r.value : `failed: ${r.error}`;
  }
  // Not fatal: before schema v4 is applied the table does not exist yet.
  out.aiChatsPurged = chats.chats;
  out.aiFilesPurged = chats.files;
  // Not fatal: before schema v7 is applied the personal tables do not exist yet.
  if (colisten) {
    out.colistenPairs = colisten.ok ? colisten.value?.pairs : `failed: ${colisten.error}`;
    // Remember the rebuild (its own job_runs row) so the next one waits a day.
    if (colisten.ok) await db.insert(env, 'job_runs', { job: 'colisten', started_at: new Date(now).toISOString(), finished_at: new Date().toISOString(), ok: true, summary: { pairs: colisten.value?.pairs ?? null } });
  }
  // The job log keeps 30 days (the two 5-minute jobs, scheduled notifications and Smart Alerts, add 288 rows a day each).
  const pruned = await db.remove(env, 'job_runs', q().lt('started_at', since(30 * DAY_MS)));
  out.jobRunsPruned = pruned.ok ? 'done' : `failed: ${pruned.error}`;
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

/** Smart Alerts; a run that could not judge (history or admins unreadable) is a failed run. */
async function alertsJob(env: DbEnv, now: number): Promise<Record<string, unknown>> {
  const r = await runAlerts(env as never, now);
  if (r.error) throw new Error(`alerts: ${r.error}`);
  return { ...r };
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
      job === 'status-tick' ? await statusTick(env, now)
        : job === 'personal-embed' ? await personalEmbed(env)
          : job === 'scheduled-notifications' ? { ...(await runScheduledNotifications(env as never, now)) }
            : job === 'alerts' ? await alertsJob(env, now)
            : await housekeeping(env, now);
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
  // The owner's on/off and frequency choices, and when each job last started.
  // Each job's own last start (one small read per job, so a frequent job
  // never pushes a rare one out of view). A job whose read fails is not run:
  // better a skipped tick than running everything every 5 minutes.
  const [cfgRaw, ...lastRuns] = await Promise.all([
    setting(env, 'jobs'),
    ...JOBS.map((j) => db.select<{ started_at: string }>(env, 'job_runs', q().eq('job', j.id).select('started_at').order('started_at', 'desc').limit(1))),
  ]);
  const cfg = jobSettings(cfgRaw);
  const out: JobResult[] = [];
  for (const [i, j] of JOBS.entries()) {
    const r = lastRuns[i] as Awaited<ReturnType<typeof db.select<{ started_at: string }>>>;
    if (!r.ok) continue;
    if (isDue(cfg[j.id], r.rows[0]?.started_at ?? null, scheduledTime)) out.push(await runJob(env, j.id, Date.now()));
  }
  return out;
}
