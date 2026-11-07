/**
 * The owner's weekly summary email: when it is due (Monday from 9 AM India
 * time, once a week, caught up later in the week), who gets it, what it says,
 * the job that sends it and the console's test button. Resend is never really called.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DB_ENV, fakeDb } from './helpers/fakeDb';
import { emailList, emailSettingsOf, RESEND_URL } from '../functions/_lib/email';
import { change, hoursText, mondayOf, runWeeklySummary, SENT_MARKER, weekDue, weeklySummaryEmail, type WeeklySummary } from '../functions/_lib/weeklySummary';
import { issueAdminSession, resetAdminMemo } from '../functions/_lib/adminAuth';
import { resetSettingsMemo } from '../functions/_lib/settings';
import { _resetRateLimitsForTests } from '../functions/_lib/ratelimit';
import { JOBS } from '../functions/_lib/jobs';
import * as emailRoute from '../functions/api/admin/email';

const KEY = { RESEND_API_KEY: 're_test_key' };
const ENV = { AUTH_SECRET: 'auth-secret-for-tests', ...DB_ENV, ...KEY, ADMIN_LOGIN_PASSWORD: 'owner-pass' };

const SUMMARY: WeeklySummary = {
  from: '2026-11-02', to: '2026-11-08',
  newUsers: 12, newUsersPrev: 8, totalUsers: 100, activeUsers: 40, activeUsersPrev: 50,
  plays: 900, playsPrev: 900, listenSeconds: 3 * 3600 + 12 * 60, listenSecondsPrev: 0,
  topSongs: [{ title: 'Jagave <Barali>', artist: 'V. Harikrishna', plays: 30, people: 9 }],
  topArtists: [{ artist: 'A.R. Rahman', plays: 80, people: 1 }],
  atRisk: 3, errors: 4, errorsPrev: 2, feedback: 1,
};

let sent: Array<Record<string, unknown>> = [];
const outside = (url: string, init?: RequestInit): Response => {
  if (url === RESEND_URL) {
    sent.push({ ...(JSON.parse(String(init?.body)) as Record<string, unknown>), idem: (init?.headers as Record<string, string>)['idempotency-key'] });
    return new Response(JSON.stringify({ id: 'em_9' }), { status: 200 });
  }
  return new Response('{}', { status: 404 });
};
const ADMINS = () => [
  { email: 'boss@example.com', role: 'owner', name: 'Boss', picture: null, invited_by: null, created_at: 't', last_sign_in: null },
  { email: 'viewer@example.com', role: 'viewer', name: null, picture: null, invited_by: null, created_at: 't', last_sign_in: null },
];
const rpcAnswer = () => new Response(JSON.stringify(SUMMARY), { status: 200, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  sent = [];
  resetSettingsMemo();
  resetAdminMemo();
  _resetRateLimitsForTests();
});
afterEach(() => vi.unstubAllGlobals());

// Monday 9 Nov 2026 in India: 09:00 IST = 03:30 UTC.
const MON_0859 = Date.UTC(2026, 10, 9, 3, 29);
const MON_0900 = Date.UTC(2026, 10, 9, 3, 30);
const SUN_2330 = Date.UTC(2026, 10, 8, 18, 0);   // Sunday 23:30 IST
const WED = Date.UTC(2026, 10, 11, 6, 0);

describe('when it is due', () => {
  it('the week starts on Monday in India time', () => {
    expect(mondayOf(MON_0859)).toBe('2026-11-09');
    expect(mondayOf(SUN_2330)).toBe('2026-11-02');
    expect(mondayOf(Date.UTC(2026, 10, 8, 18, 30))).toBe('2026-11-09'); // 00:00 IST Monday
  });
  it('from Monday 9 AM, once per week, caught up later that week', () => {
    expect(weekDue(MON_0859, null)).toBeNull();
    expect(weekDue(MON_0900, null)).toBe('2026-11-09');
    expect(weekDue(MON_0900, '2026-11-09')).toBeNull();
    expect(weekDue(WED, '2026-11-02')).toBe('2026-11-09');
    expect(weekDue(SUN_2330, '2026-11-02')).toBeNull();
  });
  it('is a job the console lists, checked hourly', () => {
    expect(JOBS.find((j) => j.id === 'weekly-summary')).toMatchObject({ every: 60 });
  });
});

describe('the setting', () => {
  it('on by default, recipients cleaned', () => {
    expect(emailSettingsOf(null)).toMatchObject({ weeklySummary: true, weeklyTo: [] });
    expect(emailSettingsOf({ weeklySummary: false, weeklyTo: ['A@X.com', 'a@x.com', 'nope', 5] })).toMatchObject({ weeklySummary: false, weeklyTo: ['a@x.com'] });
    expect(emailList('a@x.com, b@y.in; bad')).toEqual(['a@x.com', 'b@y.in']);
    expect(emailList(Array.from({ length: 20 }, (_, i) => `p${i}@x.com`))).toHaveLength(10);
  });
});

describe('what it says', () => {
  it('numbers against last week, top songs, At risk, escaped', () => {
    expect(hoursText(3 * 3600 + 12 * 60)).toBe('3 h 12 min');
    expect(hoursText(45 * 60)).toBe('45 min');
    expect(change(12, 8)).toBe('▲ 50% vs last week');
    expect(change(40, 50)).toBe('▼ 20% vs last week');
    expect(change(5, 0)).toBe('new this week');
    const e = weeklySummaryEmail('boss@example.com', SUMMARY);
    expect(e.kind).toBe('weeklySummary');
    expect(e.subject).toBe('VinaX last week: 3 h 12 min listened, 40 active, 12 new');
    expect(e.idempotencyKey).toBe('weekly-summary:2026-11-02');
    expect(e.html).toContain('Your week in VinaX · 2 Nov – 8 Nov');
    expect(e.html).toContain('Jagave &lt;Barali&gt;');
    expect(e.html).not.toContain('<Barali>');
    expect(e.text).toContain('3 regular listeners have not been back for a week');
    expect(e.text).toContain('A.R. Rahman · 80 plays');
    expect(weeklySummaryEmail('x@y.com', SUMMARY, { test: true })).toMatchObject({ subject: expect.stringMatching(/^\[Test\] /), idempotencyKey: undefined });
  });
});

describe('the job', () => {
  it('sends last week once to the Owners and remembers it', async () => {
    const fake = fakeDb({ admins: ADMINS() }, outside);
    fake.answer('rpc/weekly_summary', rpcAnswer);
    expect(await runWeeklySummary(ENV, MON_0900)).toEqual({ sent: '2026-11-09', to: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: ['boss@example.com'], idem: 'weekly-summary:2026-11-02', tags: [{ name: 'kind', value: 'weeklySummary' }] });
    expect(fake.calls.find((c) => c.table === 'rpc/weekly_summary')?.body).toEqual({ p_to: '2026-11-09' });
    expect(fake.rows('job_runs')).toEqual([expect.objectContaining({ job: SENT_MARKER, summary: expect.objectContaining({ week: '2026-11-09' }) })]);
    expect(await runWeeklySummary(ENV, MON_0900 + 3_600_000)).toMatchObject({ skipped: 'not due' });
    expect(sent).toHaveLength(1);
  });

  it('goes to the chosen addresses, and not at all when switched off or without the key', async () => {
    const fake = fakeDb({ admins: ADMINS(), settings: [{ key: 'email', value: { weeklyTo: ['me@vinax.in'] }, updated_at: 't', updated_by: 'o' }] }, outside);
    fake.answer('rpc/weekly_summary', rpcAnswer);
    await runWeeklySummary(ENV, MON_0900);
    expect(sent[0]).toMatchObject({ to: ['me@vinax.in'] });
    resetSettingsMemo();
    fakeDb({ admins: ADMINS(), settings: [{ key: 'email', value: { weeklySummary: false }, updated_at: 't', updated_by: 'o' }] }, outside);
    expect(await runWeeklySummary(ENV, MON_0900)).toEqual({ skipped: 'switched off' });
    const noKey: Record<string, unknown> = { ...ENV }; delete noKey.RESEND_API_KEY;
    expect(await runWeeklySummary(noKey as never, MON_0900)).toEqual({ skipped: 'no RESEND_API_KEY' });
  });

  it('a failed send fails the run and is tried again next hour', async () => {
    fakeDb({ admins: ADMINS() }, () => new Response(JSON.stringify({ name: 'validation_error' }), { status: 403 }))
      .answer('rpc/weekly_summary', rpcAnswer);
    await expect(runWeeklySummary(ENV, MON_0900)).rejects.toThrow(/not sent \(validation_error\)/);
  });
});

describe('the console', () => {
  const req = (body?: unknown, token?: string) => new Request('https://admin.vinaxmusic.online/api/admin/email', {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { 'x-admin-token': token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  it('GET says who gets it and when it last went; the test is for owners', async () => {
    const fake = fakeDb({ admins: ADMINS(), job_runs: [{ job: SENT_MARKER, started_at: '2026-11-02T03:31:00Z', summary: { week: '2026-11-02', to: ['boss@example.com'] } }] }, outside);
    fake.answer('rpc/weekly_summary', rpcAnswer);
    const boss = (await issueAdminSession(ENV, 'boss@example.com'))!;
    const viewer = (await issueAdminSession(ENV, 'viewer@example.com'))!;
    const get = await emailRoute.onRequestGet({ request: req(undefined, viewer), env: ENV });
    expect(await get.json()).toMatchObject({ weekly: { to: ['boss@example.com'], owners: true, last: { week: '2026-11-02', to: ['boss@example.com'] } } });
    expect((await emailRoute.onRequestPost({ request: req({ action: 'weekly-test' }, viewer), env: ENV })).status).toBe(403);
    const ok = await emailRoute.onRequestPost({ request: req({ action: 'weekly-test' }, boss), env: ENV });
    expect(ok.status).toBe(200);
    expect(sent[0]).toMatchObject({ to: ['boss@example.com'], subject: expect.stringMatching(/^\[Test\] VinaX last week/) });
    expect(fake.rows('job_runs').filter((r) => r.job === SENT_MARKER)).toHaveLength(1); // a test is not the week's send
  });
});
