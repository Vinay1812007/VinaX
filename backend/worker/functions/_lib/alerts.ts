/**
 * Smart Alerts — the `alerts` job (every 5 minutes by default) looks for
 * trouble and pushes ONE short alert per problem to the admins' own phones.
 *
 * Rules (the owner-only `alert-rules` setting, cleaned by `alertRulesOf`):
 *   errorsSpike   app errors in the last hour ≥ minErrors and > factor × the hour before
 *   siteDown      the website or the music catalogue does not answer (checked twice)
 *   noPlays       no song played in the last `minutes` — with onlyIfUsualPlays, only
 *                 when the same window yesterday had at least USUAL_PLAYS plays
 *   newFeedback   at least minCount new (unread) feedback messages since the last
 *                 feedback alert (at most the last day)
 *   jobsFailing   a switched-on scheduled job whose last two finished runs failed, or
 *                 that is running late (its last run started more than lateAfter(every)
 *                 minutes ago, as the Scheduled Jobs page says). The alerts job itself is
 *                 not judged: it cannot report its own failure. From the cron, the runs
 *                 `runScheduled` already read are reused (no extra reads)
 *   quotaHigh     the account's Worker requests since 00:00 UTC reached `percent` of the
 *                 free plan's daily allowance (_lib/cfAnalytics.ts; needs CF_ANALYTICS_TOKEN
 *                 and CF_ACCOUNT_ID, otherwise not judged). At most once per UTC day
 *
 * Who: `who` picks the admins (owners · owners and editors · every admin,
 * plus ADMIN_OWNER_EMAILS); each one's phones are the push devices of the
 * VinaX account with the same Google email (`devicesOfEmail`). An admin
 * whose phone is not linked gets nothing — the console page says so.
 *
 * Repeats: every alert is a `notifications` row (kind 'system', sent_by
 * 'schedule') whose dedupe_key is `alert:<rule>:<cooldown>:<bucket>`
 * (quotaHigh: `alert:quotaHigh:day:<YYYY-MM-DD>`, UTC). A rule that alerted
 * less than `cooldownMinutes` ago (quotaHigh: today, UTC) is held; the unique
 * key makes two overlapping runs send at most one. The row carries the
 * delivery receipt, so the console's Recent alerts reads it back.
 *
 * Quiet hours (India time, optional) hold every rule except siteDown and
 * quotaHigh, which always go out (the allowance resets at 05:30 India time,
 * so a warning held until morning would come too late). A held rule is not
 * recorded, so it alerts when the quiet hours end if the problem is still
 * there.
 *
 * Alerts do not count toward the listener frequency cap (`fanOut` with
 * countTowardCap: false). Never throws.
 */
import { audit } from './audit';
import { bootstrapOwners, type AdminRole, type AdminSessionEnv } from './adminAuth';
import { db, dbConfigured, q, type DbEnv, type Rows, type Value } from './db';
import { devicesOfEmail, fanOut, quietNow, recordReceipt, type DeviceRow, type PushEnv, type PushRules } from './pushSend';
import { setting } from './settings';
import { probeAll } from '../api/status';
import { analyticsConfigured, readRequestUsage, utcDay, type CfAnalyticsEnv } from './cfAnalytics';
import { isOverdue, jobSettings, JOBS, type JobContext, type JobId, type JobSetting, type RecentRun, type RecentRuns } from './jobSpecs';

export type AlertRuleId = 'errorsSpike' | 'siteDown' | 'noPlays' | 'newFeedback' | 'jobsFailing' | 'quotaHigh';
export const ALERT_RULES: readonly AlertRuleId[] = ['errorsSpike', 'siteDown', 'noPlays', 'newFeedback', 'jobsFailing', 'quotaHigh'];
export type AlertWho = 'owners' | 'editors' | 'all';

export interface AlertRules {
  enabled: boolean;
  who: AlertWho;
  /** India time, "HH:MM". siteDown ignores it. */
  quiet: { enabled: boolean; start: string; end: string };
  /** A rule that alerted is quiet for this long. */
  cooldownMinutes: number;
  rules: {
    errorsSpike: { on: boolean; minErrors: number; factor: number };
    siteDown: { on: boolean };
    noPlays: { on: boolean; minutes: number; onlyIfUsualPlays: boolean };
    newFeedback: { on: boolean; minCount: number };
    jobsFailing: { on: boolean };
    /** Alert when today's requests reach this percent of the daily allowance. */
    quotaHigh: { on: boolean; percent: number };
  };
}

export const COOLDOWN_CHOICES: readonly number[] = [15, 30, 60, 120, 240, 720, 1440];
export const NO_PLAYS_CHOICES: readonly number[] = [30, 60, 120, 180, 360];
export const QUOTA_PERCENT_CHOICES: readonly number[] = [50, 70, 80, 90, 95];
/** Rules that go out even during quiet hours. */
const IGNORES_QUIET: ReadonlySet<AlertRuleId> = new Set(['siteDown', 'quotaHigh']);
/** "Usual plays": the same window yesterday had at least this many. */
export const USUAL_PLAYS = 3;
/** The components a siteDown alert watches (the API probe is the Worker itself). */
export const WATCHED: ReadonlyArray<'website' | 'api' | 'catalog'> = ['website', 'api', 'catalog'];
const COMPONENT_NAME: Record<string, string> = { website: 'The website', api: 'The app services', catalog: 'Music search' };
/** Admins asked at most (each one is two small reads). */
const MAX_ADMINS = 25;

const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const int = (v: unknown, lo: number, hi: number, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d);

/** The `alert-rules` setting with defaults and only sane values. Unset = the defaults (on, owners only). */
export function alertRulesOf(raw: unknown): AlertRules {
  const r = obj(raw);
  const quiet = obj(r.quiet);
  const rules = obj(r.rules);
  const es = obj(rules.errorsSpike), sd = obj(rules.siteDown), np = obj(rules.noPlays), nf = obj(rules.newFeedback);
  const jf = obj(rules.jobsFailing), qh = obj(rules.quotaHigh);
  const factor = typeof es.factor === 'number' && Number.isFinite(es.factor) ? Math.min(20, Math.max(1, Math.round(es.factor * 2) / 2)) : 2;
  return {
    enabled: r.enabled !== false,
    who: r.who === 'editors' || r.who === 'all' ? r.who : 'owners',
    quiet: {
      enabled: quiet.enabled === true,
      start: typeof quiet.start === 'string' && HM.test(quiet.start) ? quiet.start : '23:00',
      end: typeof quiet.end === 'string' && HM.test(quiet.end) ? quiet.end : '07:00',
    },
    cooldownMinutes: typeof r.cooldownMinutes === 'number' && COOLDOWN_CHOICES.includes(r.cooldownMinutes) ? r.cooldownMinutes : 60,
    rules: {
      errorsSpike: { on: es.on !== false, minErrors: int(es.minErrors, 1, 100_000, 10), factor },
      siteDown: { on: sd.on !== false },
      noPlays: { on: np.on !== false, minutes: typeof np.minutes === 'number' && NO_PLAYS_CHOICES.includes(np.minutes) ? np.minutes : 60, onlyIfUsualPlays: np.onlyIfUsualPlays !== false },
      newFeedback: { on: nf.on !== false, minCount: int(nf.minCount, 1, 1000, 1) },
      jobsFailing: { on: jf.on !== false },
      quotaHigh: { on: qh.on !== false, percent: typeof qh.percent === 'number' && QUOTA_PERCENT_CHOICES.includes(qh.percent) ? qh.percent : 80 },
    },
  };
}

export async function alertRules(env: DbEnv): Promise<AlertRules> {
  return alertRulesOf(await setting(env, 'alert-rules'));
}

/** Quiet hours of the alert rules, now. */
export function alertQuiet(rules: AlertRules, now = Date.now()): boolean {
  const asPush: PushRules = { minGapHours: 0, quiet: rules.quiet, types: { announcements: true, releases: true, recommendations: true, reminders: true } };
  return quietNow(asPush, now).quiet;
}

/* ------------------------------------------------------------------ signals */

export interface AlertSignals {
  errorsLastHour: number | null;
  errorsHourBefore: number | null;
  /** Plays in the last noPlays.minutes, and in the same window yesterday. */
  playsRecent: number | null;
  playsYesterday: number | null;
  /** New feedback since the last feedback alert (at most a day). */
  newFeedback: number | null;
  /** Watched component → answering (null = not checked). */
  probes: Record<string, boolean | null>;
  /** When the signals were read (job lateness is said from it). */
  now?: number;
  /** Jobs failing or late (null = not judged). Optional: older callers leave it out. */
  jobs?: JobTrouble[] | null;
  /** Today's Worker requests and the daily allowance (null = not judged). */
  requests?: { used: number; allowance: number } | null;
}

/** A scheduled job that needs a look. */
export interface JobTrouble {
  job: JobId;
  label: string;
  kind: 'failing' | 'late';
  /** The last run's error, when it failed. */
  error: string | null;
  lastAt: string | null;
  every: number;
}

/**
 * Which switched-on jobs (not the alerts job) failed their last two finished
 * runs or are running late (pure). A job with no runs at all is new, not late.
 */
export function jobTroubles(settings: Record<JobId, JobSetting>, runs: RecentRuns, now: number): JobTrouble[] {
  const out: JobTrouble[] = [];
  for (const j of JOBS) {
    if (j.id === 'alerts') continue;
    const cfg = settings[j.id];
    const list = runs.get(j.id);
    if (!cfg?.enabled || !list) continue;
    const lastAt = list[0]?.started_at ?? null;
    // A run still going (ok is null) is neither a failure nor a success yet.
    const finished = list.filter((r) => r.ok === true || r.ok === false).slice(0, 2);
    if (finished.length === 2 && finished.every((r) => r.ok === false)) {
      const err = obj(finished[0].summary).error;
      out.push({ job: j.id, label: j.label, kind: 'failing', error: typeof err === 'string' && err ? err.slice(0, 120) : null, lastAt, every: cfg.every });
    } else if (isOverdue(cfg, lastAt, now)) {
      out.push({ job: j.id, label: j.label, kind: 'late', error: null, lastAt, every: cfg.every });
    }
  }
  return out;
}

/** Each job's newest three runs (one small read per job). null when a read fails. */
async function readRecentRuns(env: DbEnv): Promise<RecentRuns | null> {
  const ids = JOBS.map((j) => j.id).filter((id) => id !== 'alerts');
  const reads = await Promise.all(ids.map((id) => db.select<RecentRun>(env, 'job_runs', q().eq('job', id).select('started_at,ok,summary').order('started_at', 'desc').limit(3))));
  const out: RecentRuns = new Map();
  for (const [i, r] of reads.entries()) {
    if (!r.ok) return null;
    out.set(ids[i], r.rows);
  }
  return out;
}

async function readJobTroubles(env: DbEnv, now: number, jobs?: JobContext): Promise<JobTrouble[] | null> {
  try {
    if (jobs) return jobTroubles(jobs.settings, jobs.recentRuns, now);
    const [raw, runs] = await Promise.all([setting(env, 'jobs'), readRecentRuns(env)]);
    return runs ? jobTroubles(jobSettings(raw), runs, now) : null;
  } catch {
    return null;
  }
}

async function readRequests(env: CfAnalyticsEnv, now: number): Promise<{ used: number; allowance: number } | null> {
  const r = await readRequestUsage(env, now);
  return r.ok ? { used: r.usage.requests, allowance: r.usage.allowance } : null;
}

const HOUR = 3_600_000;
const iso = (t: number): string => new Date(t).toISOString();

/** A count, or null when it could not be read (that rule is then not judged). */
async function orNull(p: Promise<Value<number>>): Promise<number | null> {
  const r = await p;
  return r.ok ? r.value : null;
}

/** Down = failed now and again on a fresh check a moment later (one slow answer is not an outage). */
async function readProbes(now: number): Promise<Record<string, boolean | null>> {
  const out: Record<string, boolean | null> = {};
  try {
    let probes = await probeAll(now);
    if (WATCHED.some((c) => probes.get(c)?.ok === false)) probes = await probeAll(now, true);
    for (const c of WATCHED) out[c] = probes.get(c)?.ok ?? null;
  } catch {
    for (const c of WATCHED) out[c] = null;
  }
  return out;
}

/** Read only what the switched-on rules need. Failed reads are null (that rule is not judged). */
export async function readSignals(env: DbEnv & CfAnalyticsEnv, rules: AlertRules, now: number, lastFeedbackAlert: string | null, jobs?: JobContext): Promise<AlertSignals> {
  const r = rules.rules;
  const npMs = r.noPlays.minutes * 60_000;
  const fbSince = Math.max(lastFeedbackAlert ? Date.parse(lastFeedbackAlert) || 0 : 0, now - 24 * HOUR);
  const none = Promise.resolve(null);
  const [errorsLastHour, errorsHourBefore, playsRecent, playsYesterday, newFeedback, probes, jobTrouble, requests] = await Promise.all([
    r.errorsSpike.on ? orNull(db.count(env, 'events', q().eq('kind', 'error').gte('at', iso(now - HOUR)))) : none,
    r.errorsSpike.on ? orNull(db.count(env, 'events', q().eq('kind', 'error').gte('at', iso(now - 2 * HOUR)).lt('at', iso(now - HOUR)))) : none,
    r.noPlays.on ? orNull(db.count(env, 'events', q().eq('kind', 'play').gte('at', iso(now - npMs)))) : none,
    r.noPlays.on && r.noPlays.onlyIfUsualPlays ? orNull(db.count(env, 'events', q().eq('kind', 'play').gte('at', iso(now - 24 * HOUR - npMs)).lt('at', iso(now - 24 * HOUR)))) : none,
    r.newFeedback.on ? orNull(db.count(env, 'feedback', q().eq('status', 'new').gt('at', iso(fbSince)))) : none,
    r.siteDown.on ? readProbes(now) : Promise.resolve({} as Record<string, boolean | null>),
    r.jobsFailing.on ? readJobTroubles(env, now, jobs) : none,
    r.quotaHigh.on && analyticsConfigured(env) ? readRequests(env, now) : none,
  ]);
  return { errorsLastHour, errorsHourBefore, playsRecent, playsYesterday, newFeedback, probes, jobs: jobTrouble, requests, now };
}

/* ------------------------------------------------------------------- rules */

export interface Firing {
  rule: AlertRuleId;
  title: string;
  body: string;
  /** The console page to open (a site path: the web push opens it). */
  link: string;
}

const n = (v: number, one: string, many = `${one}s`) => `${v} ${v === 1 ? one : many}`;
const mins = (m: number) => (m % 60 === 0 ? n(m / 60, 'hour') : `${m} minutes`);

/** Which switched-on rules fire for these signals (pure). */
export function firingRules(rules: AlertRules, s: AlertSignals): Firing[] {
  const out: Firing[] = [];
  const r = rules.rules;
  if (r.errorsSpike.on && s.errorsLastHour != null && s.errorsHourBefore != null) {
    const e = s.errorsLastHour, before = s.errorsHourBefore;
    if (e >= r.errorsSpike.minErrors && e > r.errorsSpike.factor * before) {
      out.push({ rule: 'errorsSpike', title: 'App errors are rising', body: `${n(e, 'error')} in the last hour (${before} the hour before). Tap to see what is going wrong.`, link: '/admin/#/app-errors' });
    }
  }
  if (r.siteDown.on) {
    const down = WATCHED.filter((c) => s.probes[c] === false);
    if (down.length) {
      const names = down.map((c) => COMPONENT_NAME[c]);
      out.push({ rule: 'siteDown', title: 'VinaX may be down', body: `${names.join(' and ')} ${down.length === 1 ? 'is' : 'are'} not answering. Tap to see the server checks.`, link: '/admin/#/server-checks' });
    }
  }
  if (r.noPlays.on && s.playsRecent === 0) {
    const usual = s.playsYesterday ?? 0;
    if (!r.noPlays.onlyIfUsualPlays || (s.playsYesterday != null && usual >= USUAL_PLAYS)) {
      out.push({ rule: 'noPlays', title: 'No songs played', body: `Nobody played a song in the last ${mins(r.noPlays.minutes)}${r.noPlays.onlyIfUsualPlays ? ` (${usual} at this time yesterday)` : ''}. Playback may be broken.`, link: '/admin/#/listening-now' });
    }
  }
  if (r.newFeedback.on && s.newFeedback != null && s.newFeedback >= r.newFeedback.minCount) {
    out.push({ rule: 'newFeedback', title: 'New feedback', body: `${n(s.newFeedback, 'new feedback message')} to read.`, link: '/admin/#/feedback' });
  }
  if (r.jobsFailing.on && s.jobs && s.jobs.length) {
    const t = s.jobs;
    const title = t.length > 1 ? 'Scheduled jobs need a look' : t[0].kind === 'failing' ? `${t[0].label} is failing` : `${t[0].label} has stopped running`;
    const parts = t.slice(0, 3).map((x) => (x.kind === 'failing'
      ? `${x.label} failed twice in a row${x.error ? ` (${x.error.slice(0, 80)})` : ''}`
      : `${x.label} has not run for ${x.lastAt ? since(x.lastAt, s.now) : 'a while'} (it runs every ${mins(x.every)})`));
    if (t.length > 3) parts.push(`${n(t.length - 3, 'more job')}`);
    out.push({ rule: 'jobsFailing', title, body: `${parts.join('; ')}. Tap to see the scheduled jobs.`, link: '/admin/#/scheduled-jobs' });
  }
  if (r.quotaHigh.on && s.requests && s.requests.allowance > 0) {
    const { used, allowance } = s.requests;
    const pct = Math.floor((used / allowance) * 100);
    if (pct >= r.quotaHigh.percent) {
      out.push({
        rule: 'quotaHigh', title: 'Daily server requests running low',
        body: `${pct}% of today's ${allowance.toLocaleString('en-IN')} server requests are used (${used.toLocaleString('en-IN')}). At 100% the app stops working until 05:30 India time. Tap to see the server checks.`,
        link: '/admin/#/server-checks',
      });
    }
  }
  return out;
}

/** "3 hours", "40 minutes": how long ago `at` was. */
function since(at: string, now: number | undefined): string {
  const m = Math.max(1, Math.round(((now ?? Date.now()) - Date.parse(at)) / 60_000));
  if (m < 120) return `${m} minutes`;
  const h = Math.round(m / 60);
  return h < 48 ? n(h, 'hour') : n(Math.round(h / 24), 'day');
}

/* -------------------------------------------------------------- recipients */

export interface Recipient { email: string; name: string | null; role: AdminRole }

const WHO_ROLES: Record<AlertWho, readonly AdminRole[]> = { owners: ['owner'], editors: ['owner', 'editor'], all: ['owner', 'editor', 'viewer'] };
export const whoIncludes = (who: AlertWho, role: AdminRole): boolean => WHO_ROLES[who].includes(role);

/** Every console admin (admins table plus ADMIN_OWNER_EMAILS, who are always owners), at most MAX_ADMINS. */
export async function listAdmins(env: AdminSessionEnv): Promise<Rows<Recipient>> {
  const r = await db.select<{ email: string; name: string | null; role: AdminRole }>(env, 'admins', q().select('email,name,role').order('created_at', 'asc').limit(200));
  if (!r.ok) return r;
  const byEmail = new Map<string, Recipient>();
  for (const row of r.rows) byEmail.set(row.email, { email: row.email, name: row.name ?? null, role: row.role });
  for (const e of bootstrapOwners(env)) byEmail.set(e, { email: e, name: byEmail.get(e)?.name ?? null, role: 'owner' });
  return { ok: true, rows: [...byEmail.values()].slice(0, MAX_ADMINS) };
}

/** The admins `who` names. */
export async function alertRecipients(env: AdminSessionEnv, who: AlertWho): Promise<Rows<Recipient>> {
  const all = await listAdmins(env);
  return all.ok ? { ok: true, rows: all.rows.filter((a) => whoIncludes(who, a.role)) } : all;
}

/** Every linked device of these admins (one device listed once). */
export async function recipientDevices(env: DbEnv, people: Recipient[]): Promise<{ devices: DeviceRow[]; perEmail: Map<string, number | null> }> {
  const reads = await Promise.all(people.map((p) => devicesOfEmail(env, p.email)));
  const seen = new Set<string>();
  const devices: DeviceRow[] = [];
  const perEmail = new Map<string, number | null>();
  reads.forEach((r, i) => {
    perEmail.set(people[i].email, r.ok ? r.rows.length : null);
    if (!r.ok) return;
    for (const d of r.rows) if (!seen.has(d.target)) { seen.add(d.target); devices.push(d); }
  });
  return { devices, perEmail };
}

/* ------------------------------------------------------------------ the run */

export interface AlertRunSummary {
  on: boolean;
  /** Rules that were switched on and judged. */
  checked: AlertRuleId[];
  /** Rules whose problem is there right now. */
  firing: AlertRuleId[];
  /** Alerts that went out now. */
  sent: Array<{ rule: AlertRuleId; devices: number; delivered: number }>;
  /** Firing rules not sent now, and why. */
  held: Array<{ rule: AlertRuleId; reason: 'cooldown' | 'quiet_hours' | 'duplicate' | 'failed' }>;
  recipients: number;
  devices: number;
  error?: string;
}

/** `alert:<rule>:<cooldown>:<bucket>` → rule. */
export const ruleOfKey = (key: string | null | undefined): AlertRuleId | null => {
  const r = String(key ?? '').split(':')[1];
  return (ALERT_RULES as readonly string[]).includes(r) ? (r as AlertRuleId) : null;
};

/** When each rule last alerted (from the newest alert rows). */
async function lastAlerts(env: DbEnv): Promise<Map<AlertRuleId, string> | null> {
  const r = await db.select<{ at: string; dedupe_key: string | null }>(env, 'notifications', q().eq('kind', 'system').ilike('dedupe_key', 'alert:*').select('at,dedupe_key').order('at', 'desc').limit(60));
  if (!r.ok) return null;
  const out = new Map<AlertRuleId, string>();
  for (const row of r.rows) {
    const rule = ruleOfKey(row.dedupe_key);
    if (rule && !out.has(rule)) out.set(rule, row.at);
  }
  return out;
}

const WHO_LABEL: Record<AlertWho, string> = { owners: 'Smart Alerts · owners', editors: 'Smart Alerts · owners and editors', all: 'Smart Alerts · every admin' };

/**
 * Judge every switched-on rule and alert the chosen admins once per firing
 * rule. `actor` is who asked (the console's Check now); the job is 'schedule'.
 */
export async function runAlerts(env: PushEnv & AdminSessionEnv & CfAnalyticsEnv, now = Date.now(), actor = 'schedule', jobs?: JobContext): Promise<AlertRunSummary> {
  const summary: AlertRunSummary = { on: false, checked: [], firing: [], sent: [], held: [], recipients: 0, devices: 0 };
  if (!dbConfigured(env)) return { ...summary, error: 'not_configured' };
  try {
    const rules = await alertRules(env);
    summary.on = rules.enabled;
    if (!rules.enabled) return summary;
    // quotaHigh is judged only when the request meter is set up.
    summary.checked = ALERT_RULES.filter((id) => rules.rules[id].on && (id !== 'quotaHigh' || analyticsConfigured(env)));
    if (!summary.checked.length) return summary;
    const last = await lastAlerts(env);
    // Without the alert history a repeat cannot be ruled out: better skip a run than alert every 5 minutes.
    if (!last) return { ...summary, error: 'history_unreadable' };
    const signals = await readSignals(env, rules, now, last.get('newFeedback') ?? null, jobs);
    const firing = firingRules(rules, signals);
    summary.firing = firing.map((f) => f.rule);
    if (!firing.length) return summary;

    const cooldownMs = rules.cooldownMinutes * 60_000;
    const today = utcDay(now);
    const quiet = alertQuiet(rules, now);
    const due = firing.filter((f) => {
      const at = last.get(f.rule);
      const atMs = at ? Date.parse(at) : NaN;
      // quotaHigh: once per UTC day (the day the allowance counts), whatever the cooldown.
      const recent = Number.isFinite(atMs) && (f.rule === 'quotaHigh' ? utcDay(atMs) === today : now - atMs < cooldownMs);
      if (recent) { summary.held.push({ rule: f.rule, reason: 'cooldown' }); return false; }
      if (quiet && !IGNORES_QUIET.has(f.rule)) { summary.held.push({ rule: f.rule, reason: 'quiet_hours' }); return false; }
      return true;
    });
    if (!due.length) return summary;

    const found = await alertRecipients(env, rules.who);
    if (!found.ok) return { ...summary, error: 'admins_unreadable' };
    const people = found.rows;
    const { devices } = await recipientDevices(env, people);
    summary.recipients = people.length;
    summary.devices = devices.length;
    const bucket = Math.floor(now / cooldownMs);
    for (const f of due) {
      // The row first: its unique dedupe key is what stops a second run sending the same alert.
      const made = await db.insert<{ id: number }>(env, 'notifications', {
        kind: 'system', title: f.title, body: f.body, link: f.link, status: 'sent', sent_by: 'schedule', created_by: actor,
        dedupe_key: f.rule === 'quotaHigh' ? `alert:quotaHigh:day:${today}` : `alert:${f.rule}:${rules.cooldownMinutes}:${bucket}`,
        audience: { label: WHO_LABEL[rules.who], alert: f.rule, admins: people.length },
        web_total: devices.filter((d) => d.channel === 'web').length, fcm_total: devices.filter((d) => d.channel === 'fcm').length,
        at: new Date(now).toISOString(),
      }, { returning: true });
      if (!made.ok) { summary.held.push({ rule: f.rule, reason: made.error === 'conflict' ? 'duplicate' : 'failed' }); continue; }
      const id = made.rows[0]?.id ?? null;
      const report = await fanOut(env, devices, { title: `VinaX: ${f.title}`, body: f.body, link: f.link, id }, { countTowardCap: false });
      if (id != null) await recordReceipt(env, id, report, new Date(now).toISOString());
      const delivered = report.web.sent + report.fcm.sent;
      summary.sent.push({ rule: f.rule, devices: devices.length, delivered });
      await audit({ env, actor }, { action: 'alert-send', summary: `alert "${f.title}" to ${n(people.length, 'admin')} (${delivered} of ${n(devices.length, 'phone')})`, target: f.rule, after: { body: f.body, delivered } });
    }
  } catch (e) {
    summary.error = e instanceof Error ? e.message.slice(0, 200) : 'failed';
  }
  return summary;
}
