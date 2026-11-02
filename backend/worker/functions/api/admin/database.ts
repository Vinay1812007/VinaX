/**
 * GET  /api/admin/database → { configured, reachable, schema, schemaWanted, tables, counts, jobs, retention, missing }
 * POST /api/admin/database (owner)
 *        { action: 'purge_events', days } | { action: 'sweep_rooms' } | { action: 'retire_push', days }
 *        { action: 'run_job', job } | { action: 'job_setting', job, enabled?, every? }
 *
 * The database itself: is it reachable, which schema version is applied,
 * every table with a friendly name, its size and how long its rows are kept,
 * the scheduled jobs (plain description, on/off, how often, last run), and
 * the maintenance actions.
 */
import { adminJson, badRequest, dbFailure } from '../../_lib/admin';
import { adminGet, adminPost } from '../../_lib/adminRoute';
import { db, q } from '../../_lib/db';
import { intIn } from '../../_lib/edge';
import { isJobId, jobSettings, JOBS, lateAfter, retentionOf, runJob } from '../../_lib/jobs';
import { setting, writeSetting } from '../../_lib/settings';
import { SCHEMA_WANTED } from './session';

export const EXPECTED_TABLES = [
  'meta', 'listeners', 'accounts', 'account_backups', 'profiles', 'follows', 'shared_playlists', 'events', 'feedback', 'blocked_content', 'rooms', 'room_members',
  'push_devices', 'notifications', 'settings', 'settings_history', 'experiments', 'audit_log', 'uptime_days', 'uptime_latest', 'job_runs',
  'admins', 'error_status',
  'ai_conversations', 'ai_messages', 'ai_attachments', 'ai_daily_usage', 'ai_shares', 'ai_projects', 'ai_memories', 'ai_memory_prefs',
  'personal_songs', 'personal_events', 'personal_taste', 'personal_exposure', 'personal_pages', 'personal_colisten',
] as const;

/** What each table holds, in plain words (the technical name is shown small beside it). */
export const TABLE_NAMES: Record<string, { name: string; about: string }> = {
  meta: { name: 'Database facts', about: 'Which version of the database layout is installed.' },
  listeners: { name: 'Devices', about: 'Each phone or browser that uses VinaX: platform, app version, rough place, what is playing.' },
  accounts: { name: 'Users (Google accounts)', about: 'Everyone who signed in with Google.' },
  account_backups: { name: 'Library backups', about: 'Each signed-in user’s synced library and settings.' },
  profiles: { name: 'Public profiles', about: 'What users chose to show others.' },
  follows: { name: 'Follows', about: 'Who follows whom.' },
  shared_playlists: { name: 'Shared playlists', about: 'Playlists users shared or made together.' },
  events: { name: 'Play history and activity', about: 'Plays, skips, searches, likes and app error reports.' },
  feedback: { name: 'Feedback', about: 'Messages users send from Settings → Feedback.' },
  blocked_content: { name: 'Blocked songs and albums', about: 'Songs, albums, artists and words hidden from the app.' },
  rooms: { name: 'Listen Together rooms', about: 'Rooms where friends listen at the same time.' },
  room_members: { name: 'Listen Together members', about: 'Who is in each room.' },
  push_devices: { name: 'Phones ready for notifications', about: 'Phones and browsers that allowed notifications.' },
  notifications: { name: 'Sent notifications', about: 'Every notification sent, drafted or scheduled, with how many arrived.' },
  settings: { name: 'App settings', about: 'Everything changed on the App Settings pages.' },
  settings_history: { name: 'App settings history', about: 'Every earlier version of each setting.' },
  experiments: { name: 'A/B tests', about: 'Tests and their versions.' },
  audit_log: { name: 'Change log', about: 'Every change an admin made in this console.' },
  uptime_days: { name: 'Uptime by day', about: 'Daily up/down record for the status page.' },
  uptime_latest: { name: 'Latest status checks', about: 'The newest check of each service.' },
  job_runs: { name: 'Scheduled job runs', about: 'When each background job ran and how it went.' },
  admins: { name: 'Admins', about: 'Who can open this console, and their role.' },
  error_status: { name: 'Error decisions', about: 'Whether each kind of app error is new, being looked at, fixed or ignored.' },
  ai_conversations: { name: 'VinaX AI chats', about: 'Chats users had with the AI assistant.' },
  ai_messages: { name: 'VinaX AI messages', about: 'The messages inside those chats.' },
  ai_attachments: { name: 'VinaX AI files', about: 'Pictures and documents users added to chats.' },
  ai_daily_usage: { name: 'VinaX AI daily limits', about: 'How much of each daily allowance was used.' },
  personal_songs: { name: 'Recommendation song list', about: 'Songs the recommendation engine knows about.' },
  personal_events: { name: 'Recommendation signals', about: 'Plays and skips the recommendation engine learns from.' },
  personal_taste: { name: 'Taste profiles', about: 'What each signed-in user tends to like.' },
  personal_exposure: { name: 'Songs already shown', about: 'Which songs each user has already been offered.' },
  personal_pages: { name: 'Made-for-you pages', about: 'Pages the recommendation engine built for users.' },
  personal_colisten: { name: 'Played-together links', about: 'Songs people often play one after another.' },
};

/** The large tables whose row counts come from the database's quick estimate. */
const ESTIMATED = new Set(['events', 'personal_events', 'personal_songs', 'personal_exposure', 'personal_colisten']);

/** How long a table's rows are kept, in words. */
function keptFor(table: string, r: ReturnType<typeof retentionOf>): string {
  const d = (n: number | null): string => (n ? (n % 365 === 0 ? `${n / 365} year${n === 365 ? '' : 's'}` : `${n} days`) : 'Forever');
  switch (table) {
    case 'events': return r.errorsDays ? `${d(r.eventsDays)} (error reports ${d(r.errorsDays)})` : d(r.eventsDays);
    case 'feedback': return d(r.feedbackDays);
    case 'notifications': return d(r.notificationsDays);
    case 'push_devices': return '180 days after the last notification';
    case 'rooms': case 'room_members': return 'Until the room is empty';
    case 'ai_daily_usage': return '90 days';
    case 'personal_events': case 'personal_pages': return '1 year';
    case 'ai_conversations': case 'ai_messages': case 'ai_attachments': return 'Until the user deletes it';
    default: return 'Forever';
  }
}

interface MetaRow { value: { version?: number; appliedAt?: string } }
interface TableRow { name: string; rows: number; bytes: number }
interface RunRow { job: string; started_at: string; finished_at: string | null; ok: boolean | null; summary: unknown }

export const onRequestGet = adminGet(async ({ env }) => {
  const [meta, tables, counts, runs, retentionRaw, jobsRaw] = await Promise.all([
    db.select<MetaRow>(env, 'meta', q().eq('key', 'schema').select('value').limit(1)),
    db.rpc<TableRow[]>(env, 'table_stats'),
    db.rpc<Record<string, number>>(env, 'table_counts'),
    db.select<RunRow>(env, 'job_runs', q().select('job,started_at,finished_at,ok,summary').order('started_at', 'desc').limit(80)),
    setting(env, 'retention'),
    setting(env, 'jobs'),
  ]);
  if (!meta.ok) {
    // The database refused or is down: say so rather than list empty tables.
    if (meta.error !== 'not_found') return dbFailure(meta, { reachable: false });
  }
  const reachable = meta.ok;
  const schema = meta.ok && meta.rows[0]?.value ? { version: meta.rows[0].value.version ?? null, appliedAt: meta.rows[0].value.appliedAt ?? null } : null;
  const retention = retentionOf(retentionRaw);
  const exact = counts.ok && counts.value ? counts.value : {};
  const tableRows = (tables.ok && Array.isArray(tables.value) ? tables.value : []).map((t) => ({
    ...t,
    rows: typeof exact[t.name] === 'number' ? exact[t.name] : t.rows,
    approximate: ESTIMATED.has(t.name) || typeof exact[t.name] !== 'number',
    label: TABLE_NAMES[t.name]?.name ?? null,
    about: TABLE_NAMES[t.name]?.about ?? null,
    keptFor: keptFor(t.name, retention),
  }));
  const present = new Set(tableRows.map((t) => t.name));
  const missing = tables.ok ? EXPECTED_TABLES.filter((t) => !present.has(t)) : [...EXPECTED_TABLES];
  const latest = new Map<string, RunRow>();
  if (runs.ok) for (const r of runs.rows) if (!latest.has(r.job)) latest.set(r.job, r);
  const cfg = jobSettings(jobsRaw);
  const now = Date.now();
  const jobs = JOBS.map((j) => {
    const last = latest.get(j.id) ?? null;
    const ageMin = last ? Math.round((now - Date.parse(last.started_at)) / 60_000) : null;
    const c = cfg[j.id];
    return {
      job: j.id, label: j.label, about: j.about, enabled: c.enabled, every: c.every, defaultEvery: j.every, choices: j.choices,
      lastAt: last?.started_at ?? null, finishedAt: last?.finished_at ?? null, ok: last?.ok ?? null, summary: last?.summary ?? null,
      ageMin, overdue: c.enabled && ageMin !== null && ageMin > lateAfter(c.every), neverRan: last === null,
    };
  });
  return adminJson({
    configured: true,
    reachable,
    schema,
    schemaWanted: SCHEMA_WANTED,
    tables: tableRows,
    counts: exact,
    totalBytes: tableRows.reduce((n, t) => n + (Number(t.bytes) || 0), 0),
    jobs,
    jobsReadable: runs.ok,
    retention,
    missing,
    expected: EXPECTED_TABLES.length,
    checkedAt: new Date(now).toISOString(),
  });
});

export const onRequestPost = adminPost(async ({ env, body, audit, me }) => {
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
  if (body.action === 'job_setting') {
    if (!isJobId(body.job)) return badRequest('unknown_job', { jobs: JOBS.map((j) => j.id) });
    const spec = JOBS.find((j) => j.id === body.job)!;
    const current = (await setting<Record<string, { enabled?: boolean; every?: number }>>(env, 'jobs')) ?? {};
    const cfg = jobSettings(current)[spec.id];
    const next = { ...cfg };
    if (typeof body.enabled === 'boolean') next.enabled = body.enabled;
    if (body.every !== undefined) {
      if (typeof body.every !== 'number' || !spec.choices.includes(body.every)) return badRequest('bad_every', { choices: spec.choices });
      next.every = body.every;
    }
    const value = { ...(current && typeof current === 'object' && !Array.isArray(current) ? current : {}), [spec.id]: next };
    const w = await writeSetting(env, 'jobs', value, me.email);
    if (!w.ok) return adminJson({ error: w.error }, 502);
    await audit({ action: 'job-setting', summary: `${spec.label}: ${next.enabled ? 'on' : 'off'}, every ${next.every} min`, target: spec.id, before: cfg, after: next });
    return adminJson({ ok: true, job: spec.id, ...next });
  }
  return badRequest('unknown_action');
}, { role: 'owner' });
