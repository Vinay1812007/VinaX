/**
 * Scheduled jobs. The Worker's Cron Trigger fires on the schedule in
 * wrangler.toml [triggers]; `runScheduled` decides what is due and every run
 * leaves a `job_runs` row the Database page reads. `runJob` runs one job now
 * (POST /api/cron/run, or the console's "Run now").
 *
 *   status-tick              every 30 min   probe the public components, uptime_tick each
 *   housekeeping             hourly         room_sweep · old data removed per the `retention` setting · sign-ins after 90 days
 *                                           (usage, error reports, feedback, notification history)
 *                                           · retire_push_devices · VinaX AI chats deleted more than a
 *                                           day ago
 *   alerts                   every run      Smart Alerts: errors rising, site down, no plays, new
 *                                           feedback, a job failing or late, the daily request allowance
 *                                           running low → one push to the admins' phones (_lib/alerts.ts)
 *   scheduled-notifications  every run      send notifications whose scheduled time has come
 *   indexnow                 every 6 hours  tell Bing and the other IndexNow engines about new pages
 *                                           in the sitemaps (_lib/indexnow.ts)
 *   weekly-summary           hourly         Monday from 9 AM India time: last week's numbers emailed to
 *                                           the owner, once a week (_lib/weeklySummary.ts)
 *   ai-model-check           daily          one tiny request to each paused VinaX AI model; one that answers
 *                                           within 12 s is back in the model menu (_lib/ai/modelCheck.ts)
 *   outreach                 hourly         the automatic notifications that are due: the Sunday-evening
 *                                           weekly recap, win-back nudges, new releases (_lib/outreach.ts)
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
import { COMPONENTS, probeAll } from '../api/status';
import { runScheduledNotifications } from './scheduledPush';
import { runAlerts } from './alerts';
import { runIndexNow, type IndexNowEnv } from './indexnow';
import { runWeeklySummary } from './weeklySummary';
import { runOutreach } from './outreach';
import { runModelCheck } from './ai/modelCheck';
import { isDue, jobSettings, JOBS, type JobContext, type JobId, type RecentRun, type RecentRuns } from './jobSpecs';

export { isDue, isJobId, isOverdue, jobSettings, JOBS, lateAfter } from './jobSpecs';
export type { JobContext, JobId, JobSetting, JobSpec, RecentRun, RecentRuns } from './jobSpecs';

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

/** How long each kind of data is kept, from the `retention` setting. 0 / missing = forever, except usage (default 180). */
export function retentionOf(raw: unknown): { eventsDays: number; errorsDays: number | null; feedbackDays: number | null; notificationsDays: number | null } {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const days = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(3650, Math.max(7, Math.round(v))) : null);
  return { eventsDays: days(r.eventsDays) ?? 180, errorsDays: days(r.errorsDays), feedbackDays: days(r.feedbackDays), notificationsDays: days(r.notificationsDays) };
}

async function housekeeping(env: DbEnv, now = Date.now()): Promise<Record<string, unknown>> {
  const keep = retentionOf(await setting(env, 'retention'));
  // With a separate period for error reports, usage and errors are purged
  // apart; otherwise one purge keeps the old behaviour (errors with usage).
  const usage = keep.errorsDays
    ? db.rpc<number>(env, 'purge_kind', { p_kind: 'plays', p_keep_days: keep.eventsDays })
    : db.rpc<number>(env, 'purge_events', { p_keep_days: keep.eventsDays });
  const [rooms, purged, retired, chats] = await Promise.all([
    db.rpc<{ rooms: number; members: number }>(env, 'room_sweep'),
    usage,
    db.rpc<number>(env, 'retire_push_devices', { p_days: 180 }),
    // Deleted VinaX AI chats are hidden at once and removed (with messages and files) a day later.
    purgeAiChats(env),
    // VinaX AI's daily allowance rows are only needed for today; keep a quarter for the record.
    db.remove(env, 'ai_daily_usage', q().lt('day', since(90 * DAY_MS).slice(0, 10))),
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
  // Automatic notifications (schema 18) keep 180 days of per-person rows. Not fatal before the update.
  const outreach = await db.remove(env, 'outreach', q().lt('sent_at', since(180 * DAY_MS)));
  out.outreachPruned = outreach.ok ? 'done' : `failed: ${outreach.error}`;
  // Sign-in history (schema 12) keeps 90 days. Not fatal before the update.
  const signIns = await db.remove(env, 'sign_ins', q().lt('at', since(90 * DAY_MS)));
  out.signInsPruned = signIns.ok ? 'done' : `failed: ${signIns.error}`;
  // Email codes (schema 20) live fifteen minutes; drop the ones nobody used. Not fatal before the update.
  const codes = await db.remove(env, 'email_codes', q().lt('expires_at', new Date(now).toISOString()));
  out.emailCodesPruned = codes.ok ? 'done' : `failed: ${codes.error}`;
  // The job log keeps 30 days (the two 5-minute jobs, scheduled notifications and Smart Alerts, add 288 rows a day each).
  const pruned = await db.remove(env, 'job_runs', q().lt('started_at', since(30 * DAY_MS)));
  out.jobRunsPruned = pruned.ok ? 'done' : `failed: ${pruned.error}`;
  if (!rooms.ok || !purged.ok || !retired.ok) throw new Error('housekeeping: a step failed');
  return out;
}


/** Smart Alerts; a run that could not judge (history or admins unreadable) is a failed run. */
async function alertsJob(env: DbEnv, now: number, jobs?: JobContext): Promise<Record<string, unknown>> {
  const r = await runAlerts(env as never, now, 'schedule', jobs);
  if (r.error) throw new Error(`alerts: ${r.error}`);
  return { ...r };
}

/** Run one job now, recording the run. Never throws. */
export async function runJob(env: DbEnv, job: JobId, now = Date.now(), jobs?: JobContext): Promise<JobResult> {
  const startedAt = new Date(now).toISOString();
  const started = await db.insert<{ id: number }>(env, 'job_runs', { job, started_at: startedAt }, { returning: true });
  const runId = started.ok ? started.rows[0]?.id : undefined;
  let ok = true;
  let summary: Record<string, unknown> = {};
  try {
    summary =
      job === 'status-tick' ? await statusTick(env, now)
          : job === 'scheduled-notifications' ? { ...(await runScheduledNotifications(env as never, now)) }
            : job === 'alerts' ? await alertsJob(env, now, jobs)
            : job === 'indexnow' ? await runIndexNow(env as IndexNowEnv)
            : job === 'weekly-summary' ? await runWeeklySummary(env as never, now)
            : job === 'outreach' ? await runOutreach(env as never, now)
            : job === 'ai-model-check' ? await runModelCheck(env as never, now)
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
  // The owner's on/off and frequency choices, and each job's newest runs.
  // Each job's own read (one small read per job, so a frequent job never
  // pushes a rare one out of view). A job whose read fails is not run:
  // better a skipped tick than running everything every 5 minutes. Three
  // runs, not one: Smart Alerts judges "failed twice in a row" from them
  // without reading again (the free plan allows 50 subrequests a run).
  const [cfgRaw, ...lastRuns] = await Promise.all([
    setting(env, 'jobs'),
    ...JOBS.map((j) => db.select<RecentRun>(env, 'job_runs', q().eq('job', j.id).select('started_at,ok,summary').order('started_at', 'desc').limit(3))),
  ]);
  const cfg = jobSettings(cfgRaw);
  const recentRuns: RecentRuns = new Map();
  for (const [i, j] of JOBS.entries()) {
    const r = lastRuns[i] as Awaited<ReturnType<typeof db.select<RecentRun>>>;
    if (r.ok) recentRuns.set(j.id, r.rows);
  }
  const out: JobResult[] = [];
  for (const j of JOBS) {
    const runs = recentRuns.get(j.id);
    if (!runs) continue;
    if (!isDue(cfg[j.id], runs[0]?.started_at ?? null, scheduledTime)) continue;
    const result = await runJob(env, j.id, Date.now(), { recentRuns, settings: cfg });
    // A job that ran in this tick counts with its new run (Smart Alerts runs after Status check and Clean-up).
    recentRuns.set(j.id, [{ started_at: result.startedAt, ok: result.ok, summary: result.summary }, ...runs].slice(0, 3));
    out.push(result);
  }
  return out;
}
