/**
 * Smart Alerts — the `alert-rules` setting, which rules fire, the `alerts`
 * job (one push per problem to the chosen admins' phones, held by the
 * cooldown, quiet hours except "site down", the dedupe key, no listener cap
 * side effect) and GET/POST /api/admin/alerts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const probe = vi.hoisted(() => ({ down: new Set<string>(), calls: [] as boolean[] }));
vi.mock('../functions/api/status', () => ({
  COMPONENTS: [{ id: 'website' }, { id: 'api' }, { id: 'catalog' }, { id: 'admin' }],
  probeAll: async (_now?: number, fresh = false) => {
    probe.calls.push(fresh);
    return new Map(['website', 'api', 'catalog', 'admin'].map((c) => [c, { ok: !probe.down.has(c), latency: 10, checkedAt: 't' }]));
  },
}));

import { alertRulesOf, firingRules, jobTroubles, runAlerts, type AlertSignals } from '../functions/_lib/alerts';
import { jobSettings, JOBS, type RecentRun, type RecentRuns } from '../functions/_lib/jobSpecs';
import { runScheduled } from '../functions/_lib/jobs';
import { resetUsageMemo, CF_GRAPHQL_URL } from '../functions/_lib/cfAnalytics';
import * as route from '../functions/api/admin/alerts';
import * as settingsRoute from '../functions/api/admin/settings';
import { issueAdminSession, resetAdminMemo } from '../functions/_lib/adminAuth';
import { resetSettingsMemo } from '../functions/_lib/settings';
import { _resetRateLimitsForTests } from '../functions/_lib/ratelimit';
import { DB_ENV, fakeDb, brokenDb, type FakeDb } from './helpers/fakeDb';

const ENV = { ...DB_ENV, ADMIN_LOGIN_PASSWORD: 'owner-pass', AUTH_SECRET: 'auth-secret-for-tests', VAPID_PUBLIC_KEY: 'p', VAPID_PRIVATE_KEY: 'k', VAPID_SUBJECT: 'mailto:o@x' };
/** 4 Nov 2026, 06:00 UTC = 11:30 in India. */
const NOW = Date.UTC(2026, 10, 4, 6, 0);
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const errors = (n: number, minAgo: number) => Array.from({ length: n }, () => ({ kind: 'error', at: ago(minAgo) }));
const plays = (n: number, minAgo: number) => Array.from({ length: n }, () => ({ kind: 'play', at: ago(minAgo) }));

function seed(extra: Record<string, Array<Record<string, unknown>>> = {}, other?: Parameters<typeof fakeDb>[1]): FakeDb {
  return fakeDb({
    admins: [
      { email: 'boss@example.com', name: 'Boss', role: 'owner', created_at: '1' },
      { email: 'ed@example.com', name: 'Ed', role: 'editor', created_at: '2' },
    ],
    accounts: [{ id: '111', email: 'boss@example.com' }, { id: '222', email: 'ed@example.com' }],
    push_devices: [
      { id: 1, channel: 'fcm', target: 'tok-boss', account_id: '111', active: true, last_pushed_at: null },
      { id: 2, channel: 'fcm', target: 'tok-ed', account_id: '222', active: true, last_pushed_at: null },
    ],
    events: [...errors(12, 10), ...errors(3, 90), ...plays(5, 20)],
    feedback: [],
    notifications: [],
    ...extra,
  }, other);
}
const rulesRow = (value: unknown) => ({ key: 'alert-rules', value, updated_at: 't', updated_by: 'boss@example.com' });

const req = (path: string, token: string | null = 'owner-pass', body?: unknown) => new Request(`https://admin.vinaxmusic.online${path}`, {
  method: body !== undefined ? 'POST' : 'GET',
  headers: { 'cf-connecting-ip': '203.0.113.40', ...(token ? { 'x-admin-token': token } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
  body: body !== undefined ? JSON.stringify(body) : undefined,
});
type H = (ctx: { request: Request; env: Record<string, unknown> }) => Promise<Response>;
const call = async (h: unknown, r: Request, env: Record<string, unknown> = ENV) => {
  const res = await (h as H)({ request: r, env });
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
};

beforeEach(() => { resetSettingsMemo(); resetAdminMemo(); _resetRateLimitsForTests(); resetUsageMemo(); probe.down.clear(); probe.calls.length = 0; });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('the alert-rules setting', () => {
  it('unset means on, owners only, the default thresholds', () => {
    expect(alertRulesOf(null)).toEqual({
      enabled: true, who: 'owners', quiet: { enabled: false, start: '23:00', end: '07:00' }, cooldownMinutes: 60,
      rules: { errorsSpike: { on: true, minErrors: 10, factor: 2 }, siteDown: { on: true }, noPlays: { on: true, minutes: 60, onlyIfUsualPlays: true }, newFeedback: { on: true, minCount: 1 }, jobsFailing: { on: true }, quotaHigh: { on: true, percent: 80 } },
    });
  });

  it('keeps only sane values', () => {
    const r = alertRulesOf({ enabled: false, who: 'root', quiet: { enabled: true, start: '25:00', end: '06:30' }, cooldownMinutes: 7, rules: { errorsSpike: { minErrors: -4, factor: 99 }, noPlays: { minutes: 61, onlyIfUsualPlays: false }, newFeedback: { on: false, minCount: 2.4 } } });
    expect(r.enabled).toBe(false);
    expect(r.who).toBe('owners');
    expect(r.quiet).toEqual({ enabled: true, start: '23:00', end: '06:30' });
    expect(r.cooldownMinutes).toBe(60);
    expect(r.rules.errorsSpike).toEqual({ on: true, minErrors: 1, factor: 20 });
    expect(r.rules.noPlays).toEqual({ on: true, minutes: 60, onlyIfUsualPlays: false });
    expect(r.rules.newFeedback).toEqual({ on: false, minCount: 2 });
    expect(alertRulesOf({ who: 'editors', cooldownMinutes: 240, rules: { errorsSpike: { factor: 1.3 } } })).toMatchObject({ who: 'editors', cooldownMinutes: 240, rules: { errorsSpike: { factor: 1.5 } } });
  });

  it('is an owner-only setting', async () => {
    seed();
    const editor = (await issueAdminSession(ENV, 'ed@example.com'))!;
    expect((await call(settingsRoute.onRequestPost, req('/api/admin/settings', editor, { key: 'alert-rules', value: { enabled: false } }))).status).toBe(403);
    expect((await call(settingsRoute.onRequestPost, req('/api/admin/settings', 'owner-pass', { key: 'alert-rules', value: { enabled: false } }))).status).toBe(200);
  });
});

describe('which rules fire', () => {
  const base: AlertSignals = { errorsLastHour: 0, errorsHourBefore: 0, playsRecent: 10, playsYesterday: 10, newFeedback: 0, probes: { website: true, api: true, catalog: true } };
  const R = alertRulesOf(null);
  const fired = (s: Partial<AlertSignals>, rules = R) => firingRules(rules, { ...base, ...s }).map((f) => f.rule);

  it('errors: at least the minimum and more than factor × the hour before', () => {
    expect(fired({ errorsLastHour: 12, errorsHourBefore: 5 })).toEqual(['errorsSpike']);
    expect(fired({ errorsLastHour: 12, errorsHourBefore: 6 })).toEqual([]);
    expect(fired({ errorsLastHour: 9, errorsHourBefore: 0 })).toEqual([]);
    expect(fired({ errorsLastHour: null, errorsHourBefore: 0 })).toEqual([]); // an unreadable count is not judged
  });

  it('site down: a watched part not answering', () => {
    const f = firingRules(R, { ...base, probes: { website: false, api: true, catalog: false } });
    expect(f.map((x) => x.rule)).toEqual(['siteDown']);
    expect(f[0].body).toContain('The website and Music search are not answering');
    expect(f[0].link).toBe('/admin/#/server-checks');
    expect(fired({ probes: { website: null, api: true, catalog: true } })).toEqual([]);
  });

  it('no plays: only when the same time yesterday had plays, unless that check is off', () => {
    expect(fired({ playsRecent: 0, playsYesterday: 8 })).toEqual(['noPlays']);
    expect(fired({ playsRecent: 0, playsYesterday: 1 })).toEqual([]);
    expect(fired({ playsRecent: 0, playsYesterday: null }, alertRulesOf({ rules: { noPlays: { onlyIfUsualPlays: false } } }))).toEqual(['noPlays']);
  });

  it('new feedback: at least the minimum; switched-off rules never fire', () => {
    expect(fired({ newFeedback: 1 })).toEqual(['newFeedback']);
    expect(fired({ newFeedback: 2 }, alertRulesOf({ rules: { newFeedback: { minCount: 3 } } }))).toEqual([]);
    expect(fired({ errorsLastHour: 50, newFeedback: 5, probes: { website: false } }, alertRulesOf({ rules: { errorsSpike: { on: false }, siteDown: { on: false }, newFeedback: { on: false } } }))).toEqual([]);
  });
});

describe('the alerts job', () => {
  it('sends one alert per problem to the owners\' phones, records it, and does not touch the listener cap', async () => {
    const fake = seed({ settings: [rulesRow({ rules: { noPlays: { on: false } } })], feedback: [{ id: 1, status: 'new', at: ago(30) }] });
    const out = await runAlerts(ENV, NOW);
    expect(out.error).toBeUndefined();
    expect(out.firing).toEqual(['errorsSpike', 'newFeedback']);
    expect(out.sent.map((s) => s.rule)).toEqual(['errorsSpike', 'newFeedback']);
    expect(out.recipients).toBe(1); // owners only
    expect(out.devices).toBe(1);
    const rows = fake.rows('notifications');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ kind: 'system', title: 'App errors are rising', link: '/admin/#/app-errors', sent_by: 'schedule', status: 'sent', fcm_total: 1, dedupe_key: `alert:errorsSpike:60:${Math.floor(NOW / 3_600_000)}` });
    expect(String(rows[0].body)).toContain('12 errors in the last hour (3 the hour before)');
    expect(fake.rows('push_devices').every((d) => d.last_pushed_at === null)).toBe(true);
    expect(fake.calls.filter((c) => c.table === 'push_devices' && c.method === 'GET').every((c) => c.query.includes('account_id=in.(%22111%22)'))).toBe(true);
    const audits = fake.rows('audit_log');
    expect(audits.map((a) => a.action)).toEqual(['alert-send', 'alert-send']);
    expect(audits[0].actor).toBe('schedule');
  });

  it('holds a rule inside its cooldown, and a second run sends nothing', async () => {
    const fake = seed();
    await runAlerts(ENV, NOW);
    const first = fake.rows('notifications').length;
    expect(first).toBe(1);
    const again = await runAlerts(ENV, NOW + 10 * 60_000);
    expect(again.firing).toEqual(['errorsSpike']);
    expect(again.sent).toEqual([]);
    expect(again.held).toEqual([{ rule: 'errorsSpike', reason: 'cooldown' }]);
    expect(fake.rows('notifications')).toHaveLength(first);
  });

  it('quiet hours hold everything except site down', async () => {
    probe.down.add('catalog');
    const fake = seed({ settings: [rulesRow({ quiet: { enabled: true, start: '11:00', end: '12:00' } })] });
    const out = await runAlerts(ENV, NOW);
    expect(out.sent.map((s) => s.rule)).toEqual(['siteDown']);
    expect(out.held).toEqual([{ rule: 'errorsSpike', reason: 'quiet_hours' }]);
    expect(fake.rows('notifications').map((r) => r.title)).toEqual(['VinaX may be down']);
    expect(probe.calls).toEqual([false, true]); // a failed check is confirmed with a fresh one
  });

  it('a duplicate key (another run sent it) is not sent again', async () => {
    const fake = seed();
    fake.answer('notifications', (c) => (c.method === 'POST'
      ? new Response(JSON.stringify({ code: '23505', message: 'duplicate key' }), { status: 409, headers: { 'content-type': 'application/json' } })
      : new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })));
    const out = await runAlerts(ENV, NOW);
    expect(out.held).toEqual([{ rule: 'errorsSpike', reason: 'duplicate' }]);
    expect(out.sent).toEqual([]);
  });

  it('does nothing when switched off, and never throws on a broken database', async () => {
    const fake = seed({ settings: [rulesRow({ enabled: false })] });
    expect(await runAlerts(ENV, NOW)).toMatchObject({ on: false, sent: [] });
    expect(fake.calls.some((c) => c.table === 'events')).toBe(false);
    resetSettingsMemo();
    brokenDb();
    const out = await runAlerts(ENV, NOW);
    expect(out.sent).toEqual([]);
    expect(out.error).toBe('history_unreadable');
  });

  it('who: editors reaches owners and editors', async () => {
    const fake = seed({ settings: [rulesRow({ who: 'editors' })] });
    const out = await runAlerts(ENV, NOW);
    expect(out.recipients).toBe(2);
    expect(out.devices).toBe(2);
    expect(fake.rows('notifications')[0]).toMatchObject({ fcm_total: 2 });
  });
});

describe('GET/POST /api/admin/alerts', () => {
  it('answers the rules, who gets alerts with their phones, recent alerts, the last check and signals', async () => {
    seed({
      settings: [rulesRow({ who: 'owners' }), { key: 'jobs', value: { alerts: { every: 10 } }, updated_at: 't', updated_by: 'o' }],
      notifications: [{ id: 5, kind: 'system', at: ago(30), title: 'New feedback', body: '1 new feedback message to read.', dedupe_key: 'alert:newFeedback:60:1', web_total: 0, web_sent: 0, fcm_total: 2, fcm_sent: 1 }, { id: 6, kind: 'announcement', at: ago(5), title: 'Hi', body: 'x', dedupe_key: null }],
      job_runs: [{ job: 'alerts', started_at: ago(3), finished_at: ago(3), ok: true, summary: { firing: [] } }],
      feedback: [{ id: 1, status: 'new', at: ago(500) }, { id: 2, status: 'read', at: ago(5) }],
    });
    const r = await call(route.onRequestGet, req('/api/admin/alerts'));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ configured: true, saved: true, rules: { who: 'owners', enabled: true }, me: { email: 'owner', via: 'password', phones: null } });
    expect(r.body?.recipients).toEqual([
      { email: 'boss@example.com', name: 'Boss', role: 'owner', gets: true, phones: 1 },
      { email: 'ed@example.com', name: 'Ed', role: 'editor', gets: false, phones: 1 },
    ]);
    expect(r.body?.recent).toEqual([expect.objectContaining({ id: 5, rule: 'newFeedback', devices: 2, sent: 1, failed: 1 })]);
    expect(r.body?.job).toMatchObject({ enabled: true, every: 10, ok: true });
    expect(r.body?.signals).toMatchObject({ newFeedback: 1, probes: { website: true, api: true, catalog: true } });
    expect(typeof (r.body?.signals as Record<string, unknown>).errorsLastHour).toBe('number');
  });

  it('refuses without a token, says not configured without a database, 502 when it fails', async () => {
    seed();
    expect((await call(route.onRequestGet, req('/api/admin/alerts', null))).status).toBe(401);
    expect((await call(route.onRequestGet, req('/api/admin/alerts'), { ADMIN_LOGIN_PASSWORD: 'owner-pass', AUTH_SECRET: 'x' })).body).toEqual({ configured: false });
    brokenDb();
    const down = await call(route.onRequestGet, req('/api/admin/alerts'));
    expect(down.status).toBe(502);
    expect(down.body).toMatchObject({ configured: true, error: 'db_unavailable' });
  });

  it('a test goes to your own phone only; the recovery password has none', async () => {
    const fake = seed();
    const pw = await call(route.onRequestPost, req('/api/admin/alerts', 'owner-pass', { action: 'test' }));
    expect(pw.status).toBe(400);
    expect(pw.body?.error).toBe('no_own_account');
    const editor = (await issueAdminSession(ENV, 'ed@example.com'))!;
    const ok = await call(route.onRequestPost, req('/api/admin/alerts', editor, { action: 'test' }));
    expect(ok.body).toMatchObject({ ok: true, devices: 1 });
    expect(fake.calls.some((c) => c.table === 'notifications')).toBe(false);
    expect(fake.rows('push_devices').every((d) => d.last_pushed_at === null)).toBe(true);
    const none = await call(route.onRequestPost, req('/api/admin/alerts', editor, { action: 'test' }), { ...ENV, VAPID_PUBLIC_KEY: undefined });
    expect(none.body?.error).toBe('push_not_configured');
  });

  it('Check now is for owners and answers what fired', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const fake = seed();
    const editor = (await issueAdminSession(ENV, 'ed@example.com'))!;
    expect((await call(route.onRequestPost, req('/api/admin/alerts', editor, { action: 'check' }))).status).toBe(403);
    const r = await call(route.onRequestPost, req('/api/admin/alerts', 'owner-pass', { action: 'check' }));
    expect(r.status).toBe(200);
    expect((r.body?.result as { firing: string[] }).firing).toContain('errorsSpike');
    expect(fake.rows('notifications')[0]).toMatchObject({ created_by: 'owner' });
    expect((await call(route.onRequestPost, req('/api/admin/alerts', 'owner-pass', { action: 'nope' }))).status).toBe(400);
  });
});

describe('jobsFailing', () => {
  const cfg = jobSettings(null);
  const run = (min: number, ok: boolean | null, error?: string): RecentRun => ({ started_at: ago(min), ok, summary: error ? { error } : {} });
  const runs = (o: Record<string, RecentRun[]>): RecentRuns => new Map(Object.entries(o)) as RecentRuns;

  it('a job whose last two finished runs failed, or that is running late; never the alerts job', () => {
    const t = jobTroubles(cfg, runs({
      housekeeping: [run(5, null), run(65, false, 'housekeeping: a step failed'), run(125, false)], // one still running, two failed before it
      'status-tick': [run(80, true)], // every 30 min: late after 75
      'scheduled-notifications': [run(3, false), run(8, true)], // one failure is not enough
      indexnow: [], // never ran: new, not late
      alerts: [run(2, false), run(7, false)],
    }), NOW);
    expect(t).toEqual([
      { job: 'status-tick', label: 'Status check', kind: 'late', error: null, lastAt: ago(80), every: 30 },
      { job: 'housekeeping', label: 'Clean-up', kind: 'failing', error: 'housekeeping: a step failed', lastAt: ago(5), every: 60 },
    ]);
  });

  it('a switched-off job is not judged, and a job whose runs could not be read is left out', () => {
    const off = jobSettings({ housekeeping: { enabled: false } });
    expect(jobTroubles(off, runs({ housekeeping: [run(500, false), run(560, false)] }), NOW)).toEqual([]);
    expect(jobTroubles(cfg, runs({}), NOW)).toEqual([]);
  });

  it('says which job and why, and opens Scheduled Jobs', () => {
    const base: AlertSignals = { errorsLastHour: 0, errorsHourBefore: 0, playsRecent: 10, playsYesterday: 10, newFeedback: 0, probes: {}, now: NOW };
    const one = firingRules(alertRulesOf(null), { ...base, jobs: [{ job: 'housekeeping', label: 'Clean-up', kind: 'failing', error: 'housekeeping: a step failed', lastAt: ago(5), every: 60 }] });
    expect(one).toEqual([{ rule: 'jobsFailing', title: 'Clean-up is failing', body: 'Clean-up failed twice in a row (housekeeping: a step failed). Tap to see the scheduled jobs.', link: '/admin/#/scheduled-jobs' }]);
    const late = firingRules(alertRulesOf(null), { ...base, jobs: [{ job: 'status-tick', label: 'Status check', kind: 'late', error: null, lastAt: ago(180), every: 30 }] });
    expect(late[0]).toMatchObject({ title: 'Status check has stopped running', body: 'Status check has not run for 3 hours (it runs every 30 minutes). Tap to see the scheduled jobs.' });
    const two = firingRules(alertRulesOf(null), { ...base, jobs: [late[0] && { job: 'status-tick', label: 'Status check', kind: 'late', error: null, lastAt: ago(180), every: 30 }, { job: 'indexnow', label: 'Search engine updates', kind: 'failing', error: null, lastAt: ago(10), every: 360 }] });
    expect(two[0].title).toBe('Scheduled jobs need a look');
    expect(two[0].body).toContain('; Search engine updates failed twice in a row.');
    expect(firingRules(alertRulesOf({ rules: { jobsFailing: { on: false } } }), { ...base, jobs: [{ job: 'indexnow', label: 'x', kind: 'failing', error: null, lastAt: null, every: 360 }] })).toEqual([]);
  });

  it('the job reads job_runs itself on Check now, and reuses the scheduler\'s runs from the cron', async () => {
    const quietRules = rulesRow({ rules: { errorsSpike: { on: false }, noPlays: { on: false }, newFeedback: { on: false }, siteDown: { on: false } } });
    const fake = seed({
      settings: [quietRules],
      job_runs: [
        { job: 'housekeeping', started_at: ago(10), ok: false, summary: { error: 'housekeeping: a step failed' } },
        { job: 'housekeeping', started_at: ago(70), ok: false, summary: { error: 'housekeeping: a step failed' } },
      ],
    });
    const out = await runAlerts(ENV, NOW, 'owner');
    expect(out.checked).toEqual(['jobsFailing']); // quotaHigh needs the meter's keys
    expect(out.sent.map((x) => x.rule)).toEqual(['jobsFailing']);
    expect(fake.rows('notifications')[0]).toMatchObject({ title: 'Clean-up is failing', link: '/admin/#/scheduled-jobs' });
    const reads = fake.calls.filter((c) => c.table === 'job_runs');
    expect(reads.length).toBe(7); // every job but the alerts job
    expect(reads.some((c) => c.query.includes('job=eq.alerts'))).toBe(false);

    resetSettingsMemo();
    const again = seed({ settings: [quietRules] });
    const fromCron = await runAlerts(ENV, NOW, 'schedule', { settings: jobSettings(null), recentRuns: new Map([['outreach', [run(10, false), run(70, false)]]]) as RecentRuns });
    expect(fromCron.firing).toEqual(['jobsFailing']);
    expect(again.calls.some((c) => c.table === 'job_runs')).toBe(false);
  });
});

describe('jobsFailing from the cron', () => {
  it('judges the runs the scheduler already read: no second read of job_runs', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const recent = JOBS.filter((j) => j.id !== 'alerts' && j.id !== 'housekeeping').map((j) => ({ job: j.id, started_at: ago(1), ok: true, summary: {} }));
    const fake = seed({
      settings: [rulesRow({ rules: { errorsSpike: { on: false }, noPlays: { on: false }, newFeedback: { on: false }, siteDown: { on: false } } })],
      job_runs: [...recent, { job: 'housekeeping', started_at: ago(20), ok: false, summary: { error: 'housekeeping: a step failed' } }, { job: 'housekeeping', started_at: ago(80), ok: false, summary: {} }],
    });
    const out = await runScheduled(ENV, NOW);
    expect(out.map((r) => r.job)).toEqual(['alerts']); // nothing else is due
    expect(out[0].summary).toMatchObject({ firing: ['jobsFailing'] });
    expect(fake.calls.filter((c) => c.table === 'job_runs' && c.method === 'GET')).toHaveLength(JOBS.length);
    expect(fake.rows('notifications').map((r) => r.title)).toEqual(['Clean-up is failing']);
  });
});

describe('quotaHigh', () => {
  const METER = { CF_ANALYTICS_TOKEN: 'cf-token', CF_ACCOUNT_ID: 'acc123' };
  const graphql = (requests: number) => (url: string) => (url === CF_GRAPHQL_URL
    ? new Response(JSON.stringify({ data: { viewer: { accounts: [{ workersInvocationsAdaptive: [{ sum: { requests, errors: 0, subrequests: 0 }, dimensions: { scriptName: 'vinax-api', status: 'success' } }] }] } }, errors: null }), { status: 200, headers: { 'content-type': 'application/json' } })
    : new Response('ok'));
  const onlyQuota = rulesRow({ rules: { errorsSpike: { on: false }, noPlays: { on: false }, newFeedback: { on: false }, siteDown: { on: false }, jobsFailing: { on: false } } });
  const base: AlertSignals = { errorsLastHour: 0, errorsHourBefore: 0, playsRecent: 10, playsYesterday: 10, newFeedback: 0, probes: {} };

  it('fires at the chosen share of the daily allowance', () => {
    expect(firingRules(alertRulesOf(null), { ...base, requests: { used: 79_999, allowance: 100_000 } })).toEqual([]);
    const f = firingRules(alertRulesOf(null), { ...base, requests: { used: 85_000, allowance: 100_000 } });
    expect(f).toEqual([{ rule: 'quotaHigh', title: 'Daily server requests running low', body: '85% of today\'s 1,00,000 server requests are used (85,000). At 100% the app stops working until 05:30 India time. Tap to see the server checks.', link: '/admin/#/server-checks' }]);
    expect(firingRules(alertRulesOf({ rules: { quotaHigh: { percent: 90 } } }), { ...base, requests: { used: 85_000, allowance: 100_000 } })).toEqual([]);
    expect(alertRulesOf({ rules: { quotaHigh: { percent: 83 } } }).rules.quotaHigh).toEqual({ on: true, percent: 80 });
    expect(firingRules(alertRulesOf(null), { ...base, requests: null })).toEqual([]);
  });

  it('alerts once per UTC day, even in quiet hours, and is not judged without the keys', async () => {
    const fake = seed({ settings: [rulesRow({ quiet: { enabled: true, start: '11:00', end: '12:00' }, rules: { errorsSpike: { on: false }, noPlays: { on: false }, newFeedback: { on: false }, siteDown: { on: false }, jobsFailing: { on: false } } })] }, graphql(85_000));
    const out = await runAlerts({ ...ENV, ...METER }, NOW);
    expect(out.checked).toEqual(['quotaHigh']);
    expect(out.sent.map((x) => x.rule)).toEqual(['quotaHigh']); // quiet hours do not hold it
    expect(fake.rows('notifications')[0]).toMatchObject({ dedupe_key: 'alert:quotaHigh:day:2026-11-04', link: '/admin/#/server-checks' });
    // Three hours later (past the 60-minute cooldown), the same UTC day: held.
    resetUsageMemo();
    const later = await runAlerts({ ...ENV, ...METER }, NOW + 3 * 3_600_000);
    expect(later.held).toEqual([{ rule: 'quotaHigh', reason: 'cooldown' }]);
    expect(fake.rows('notifications')).toHaveLength(1);
    // The next UTC day it may go out again.
    resetUsageMemo();
    const tomorrow = await runAlerts({ ...ENV, ...METER }, NOW + 24 * 3_600_000);
    expect(tomorrow.sent.map((x) => x.rule)).toEqual(['quotaHigh']);
    expect(fake.rows('notifications')[1]).toMatchObject({ dedupe_key: 'alert:quotaHigh:day:2026-11-05' });
  });

  it('without the keys it is not checked and Cloudflare is never asked', async () => {
    const fake = seed({ settings: [onlyQuota] }, graphql(99_000));
    const out = await runAlerts(ENV, NOW);
    expect(out.checked).toEqual([]);
    expect(fake.other.some((o) => o.url === CF_GRAPHQL_URL)).toBe(false);
  });

  it('the console page learns whether the meter is set up', async () => {
    seed();
    expect((await call(route.onRequestGet, req('/api/admin/alerts'))).body?.meter).toEqual({ ready: false });
    expect((await call(route.onRequestGet, req('/api/admin/alerts'), { ...ENV, ...METER })).body?.meter).toEqual({ ready: true });
  });
});
