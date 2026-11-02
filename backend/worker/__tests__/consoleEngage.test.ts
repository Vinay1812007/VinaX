/**
 * Console rebuild — Send Notification and A/B Tests against a mocked PostgREST:
 * signed-in audiences only, Notification Rules (frequency cap, quiet hours,
 * kinds), drafts, scheduled sends, test sends, history, tap counting, device
 * ↔ account linking, and A/B test lifecycle and targeting.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as push from '../functions/api/admin/push';
import * as notifications from '../functions/api/admin/notifications';
import * as experiments from '../functions/api/admin/experiments';
import * as publicExperiments from '../functions/api/experiments';
import * as opened from '../functions/api/push/opened';
import * as subscribe from '../functions/api/push/subscribe';
import * as fcmRegister from '../functions/api/push/fcm-register';
import { runScheduledNotifications } from '../functions/_lib/scheduledPush';
import { audienceOf, quietNow, rulesOf, underCap } from '../functions/_lib/pushSend';
import { compareVersions, inAudience, sanitizeAudience } from '../functions/_lib/experiments';
import { issueAdminSession, resetAdminMemo } from '../functions/_lib/adminAuth';
import { issueSession } from '../functions/_lib/googleAuth';
import { resetSettingsMemo } from '../functions/_lib/settings';
import { _resetRateLimitsForTests } from '../functions/_lib/ratelimit';

const TOKEN = 'owner-password-for-tests';
const DB = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-key' };
const ENV = { ADMIN_LOGIN_PASSWORD: TOKEN, AUTH_SECRET: 'auth-secret-for-tests', ...DB, VAPID_PUBLIC_KEY: 'p', VAPID_PRIVATE_KEY: 'k', VAPID_SUBJECT: 'mailto:o@x' };

interface Call { url: URL; method: string; body: unknown; prefer: string; headers: Record<string, string> }
type Responder = (call: Call) => Response | undefined;
let calls: Call[] = [];
function stub(respond: Responder = () => undefined): void {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const parse = (): unknown => { try { return init?.body ? JSON.parse(String(init.body)) : null; } catch { return String(init?.body); } };
    const body = parse();
    const headers = (init?.headers as Record<string, string> | undefined) ?? {};
    const call = { url, method, body, prefer: String(headers.prefer ?? ''), headers };
    calls.push(call);
    const r = respond(call);
    if (r) return r;
    if (!url.href.startsWith('https://db.test/rest/v1/')) return new Response('{}', { status: 200 });
    return new Response(JSON.stringify(method === 'GET' ? [] : call.prefer.includes('representation') ? [] : null), { status: method === 'GET' ? 200 : 201, headers: { 'content-type': 'application/json', 'content-range': '0-0/0' } });
  }));
}
const json = (b: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json', ...headers } });
const path = (c: Call) => c.url.pathname.replace('/rest/v1/', '');
const isDb = (c: Call) => c.url.host === 'db.test';

function req(p: string, init: { method?: string; body?: unknown; token?: string | null; headers?: Record<string, string> } = {}): Request {
  const headers: Record<string, string> = { 'cf-connecting-ip': '203.0.113.9', ...(init.headers ?? {}) };
  if (init.token !== null) headers['x-admin-token'] = init.token ?? TOKEN;
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  return new Request(`https://admin.vinaxmusic.online${p}`, { method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'), headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined });
}
type Handler = (ctx: { request: Request; env: Record<string, unknown> }) => Promise<Response>;
const run = async (h: unknown, p: string, init: Parameters<typeof req>[1] = {}, env: Record<string, unknown> = ENV) => {
  const res = await (h as Handler)({ request: req(p, init), env });
  return { res, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
};

const DEV = (id: number, account: string | null, extra: Record<string, unknown> = {}) => ({ id, channel: 'fcm', target: `tok-${id}`, p256dh: null, auth: null, account_id: account, last_pushed_at: null, ...extra });
const settingsRows = (value: unknown) => [{ key: 'push', value, updated_at: 't', updated_by: 'owner' }];

beforeEach(() => { resetSettingsMemo(); resetAdminMemo(); _resetRateLimitsForTests(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Notification Rules', () => {
  it('reads the new shape and the old one', () => {
    const r = rulesOf({ minGapHours: 12, quiet: { enabled: true, start: '22:30', end: '07:00' }, types: { reminders: false } });
    expect(r.minGapHours).toBe(12);
    expect(r.quiet).toEqual({ enabled: true, start: '22:30', end: '07:00' });
    expect(r.types).toEqual({ announcements: true, releases: true, recommendations: true, reminders: false });
    expect(rulesOf({ minGapHours: 6, quietStart: 23, quietEnd: 7 }).quiet).toEqual({ enabled: true, start: '23:00', end: '07:00' });
    expect(rulesOf(null)).toEqual({ minGapHours: 0, quiet: { enabled: false, start: '22:00', end: '08:00' }, types: { announcements: true, releases: true, recommendations: true, reminders: true } });
  });

  it('quiet hours are India time and may cross midnight', () => {
    const rules = rulesOf({ quiet: { enabled: true, start: '22:00', end: '08:00' } });
    // 17:00 UTC = 22:30 IST → quiet until 08:00 IST (02:30 UTC next day)
    const q1 = quietNow(rules, Date.UTC(2026, 10, 2, 17, 0));
    expect(q1.quiet).toBe(true);
    expect(q1.until).toBe('2026-11-03T02:30:00.000Z');
    expect(quietNow(rules, Date.UTC(2026, 10, 2, 6, 0)).quiet).toBe(false); // 11:30 IST
    expect(quietNow(rulesOf({ quiet: { enabled: false, start: '00:00', end: '23:00' } })).quiet).toBe(false);
  });

  it('the frequency cap skips people pushed too recently', () => {
    const now = Date.UTC(2026, 10, 2, 12);
    const devices = [DEV(1, 'a', { last_pushed_at: new Date(now - 3_600_000).toISOString() }), DEV(2, 'b', { last_pushed_at: new Date(now - 13 * 3_600_000).toISOString() }), DEV(3, 'c')];
    const r = underCap(devices as never, rulesOf({ minGapHours: 12 }), now);
    expect(r.skipped).toBe(1);
    expect(r.allowed.map((d) => d.id)).toEqual([2, 3]);
  });

  it('labels audiences in plain words', () => {
    expect(audienceOf({}, null).label).toBe('Everyone');
    expect(audienceOf({ city: 'Hyderabad', lang: 'te', channel: 'fcm' }, 'active7').label).toBe('Hyderabad · Telugu · Android · Active in last 7 days');
    const chosen = audienceOf({}, null, '111,222,bad id,111');
    expect(chosen.filter.users).toEqual(['111', '222']);
    expect(chosen.label).toBe('2 chosen users');
    expect(chosen.everyone).toBe(false);
  });
});

describe('POST /api/admin/push', () => {
  it('GET counts signed-in devices and people only', async () => {
    stub((c) => {
      if (path(c) !== 'push_devices') return undefined;
      if (c.url.searchParams.get('account_id') === 'not.is.null') return json([{ country: 'IN', region: 'Telangana', city: 'Hyderabad', lang: 'te-IN', account_id: '1', channel: 'fcm' }, { country: 'IN', region: 'Telangana', city: 'Hyderabad', lang: 'te', account_id: '1', channel: 'web' }]);
      return json([{ channel: 'web' }, { channel: 'web' }, { channel: 'fcm' }, { channel: 'fcm' }]);
    });
    const { res, body } = await run(push.onRequestGet, '/api/admin/push');
    expect(res.status).toBe(200);
    expect(body?.people).toBe(1);
    expect(body?.web).toEqual({ configured: true, active: 1, allDevices: 2 });
    expect(body?.fcm).toEqual({ configured: false, active: 1, allDevices: 2 });
    expect((body?.geo as { cities: unknown[] }).cities).toHaveLength(1);
    expect(body?.langs).toEqual([{ lang: 'te', count: 2 }]);
    expect((body?.quiet as { quiet: boolean }).quiet).toBe(false);
  });

  it('refuses a blank body and an external link; a dry run counts people, applies activity, chosen users and the cap', async () => {
    const now = Date.now();
    stub((c) => {
      if (path(c) === 'push_devices' && c.method === 'GET') return json([DEV(1, '111'), DEV(2, '111', { channel: 'web', p256dh: 'a', auth: 'b' }), DEV(3, '222', { last_pushed_at: new Date(now - 60_000).toISOString() }), DEV(4, '333')]);
      if (path(c) === 'accounts') return json([{ id: '111' }, { id: '222' }]);
      if (path(c) === 'settings') return json(settingsRows({ minGapHours: 6 }));
      return undefined;
    });
    expect((await run(push.onRequestPost, '/api/admin/push', { body: { title: 'Hi', body: '   ' } })).body?.error).toBe('body_required');
    expect((await run(push.onRequestPost, '/api/admin/push', { body: { body: 'Hi', link: 'https://evil.example/x' } })).body?.error).toBe('bad_link');
    expect((await run(push.onRequestPost, '/api/admin/push', { body: { body: 'Hi', link: '//evil.example' } })).body?.error).toBe('bad_link');
    calls = [];
    const dry = await run(push.onRequestPost, '/api/admin/push', { body: { body: 'New Telugu hits', link: '/charts', filter: { country: 'in', city: 'Hyderabad' }, activity: 'active7', dryRun: true } });
    expect(dry.res.status).toBe(200);
    expect(dry.body).toMatchObject({ dryRun: true, people: 1, devices: 2, web: 1, fcm: 1, skippedRecent: 1, audience: 'Hyderabad · Active in last 7 days' });
    const sel = calls.find((c) => path(c) === 'push_devices');
    expect(sel?.url.searchParams.get('account_id')).toBe('not.is.null');
    expect(sel?.url.searchParams.get('city')).toBe('eq.Hyderabad');
    expect(calls.find((c) => path(c) === 'accounts')?.url.searchParams.get('last_seen')).toMatch(/^gte\./);
    expect(calls.filter((c) => isDb(c) && c.method !== 'GET')).toEqual([]);
    const chosen = await run(push.onRequestPost, '/api/admin/push', { body: { body: 'Hi', users: '333', dryRun: true } });
    expect(chosen.body).toMatchObject({ people: 1, devices: 1, audience: '1 chosen user' });
  });

  it('a real send writes the row first, fans out with the id, marks it sent and publishes the announcement for everyone', async () => {
    stub((c) => {
      if (!isDb(c)) return new Response(null, { status: 410 });
      if (path(c) === 'push_devices' && c.method === 'GET') return json([DEV(1, '111', { channel: 'web', target: 'https://updates.push.services.mozilla.com/x', p256dh: 'BPp0iv4yqK6YX3W1Gfv6zU9jLx3z4z7bqfm4kN6a9Yxk2Rr7e4zZl4w3oT5Qw0a8bYbpQm3o3r5m9lWw2d6H5xM', auth: 'c3VwZXItc2VjcmV0' })]);
      if (path(c) === 'notifications' && c.method === 'POST') return json([{ id: 9 }], 201);
      return undefined;
    });
    const { res, body } = await run(push.onRequestPost, '/api/admin/push', { body: { title: 'VinaX', body: 'Hello everyone', link: '/', image: 'https://cdn.example/x.jpg', dedupeKey: 'k1' } });
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, id: 9, status: 'sent', audience: 'Everyone', people: 1 });
    const order = calls.filter((c) => isDb(c) && c.method !== 'GET').map((c) => `${c.method} ${path(c)}`);
    expect(order[0]).toBe('POST notifications');
    const made = calls.find((c) => path(c) === 'notifications' && c.method === 'POST')?.body as Record<string, unknown>;
    expect(made).toMatchObject({ dedupe_key: 'k1', status: 'sending', image: 'https://cdn.example/x.jpg', sent_by: 'owner' });
    const receipt = calls.find((c) => path(c) === 'notifications' && c.method === 'PATCH')?.body as Record<string, unknown>;
    expect(receipt.status).toBe('sent');
    expect(typeof receipt.at).toBe('string');
    expect((calls.find((c) => path(c) === 'settings' && c.method === 'POST')?.body as { key: string }).key).toBe('announcement');
  });

  it('a repeated dedupe key is a 409', async () => {
    stub((c) => {
      if (path(c) === 'push_devices' && c.method === 'GET') return json([]);
      if (path(c) === 'notifications' && c.method === 'POST') return json({ code: '23505', message: 'duplicate' }, 409);
      return undefined;
    });
    const { res, body } = await run(push.onRequestPost, '/api/admin/push', { body: { body: 'Again', dedupeKey: 'k1' } });
    expect(res.status).toBe(409);
    expect(body?.error).toBe('duplicate');
  });

  it('during quiet hours "now" asks first; ignoreQuiet sends; announcements switched off refuse', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.UTC(2026, 10, 2, 18, 0)); // 23:30 IST
    let rules: unknown = { quiet: { enabled: true, start: '22:00', end: '08:00' } };
    stub((c) => {
      if (path(c) === 'settings') return json(settingsRows(rules));
      if (path(c) === 'push_devices' && c.method === 'GET') return json([DEV(1, '111')]);
      if (path(c) === 'notifications' && c.method === 'POST') return json([{ id: 5 }], 201);
      return undefined;
    });
    const quiet = await run(push.onRequestPost, '/api/admin/push', { body: { body: 'Late news' } });
    expect(quiet.res.status).toBe(409);
    expect(quiet.body?.error).toBe('quiet_hours');
    expect(calls.some((c) => path(c) === 'notifications')).toBe(false);
    const forced = await run(push.onRequestPost, '/api/admin/push', { body: { body: 'Late news', ignoreQuiet: true } });
    expect(forced.body?.ok).toBe(true);
    resetSettingsMemo();
    rules = { types: { announcements: false } };
    const off = await run(push.onRequestPost, '/api/admin/push', { body: { body: 'Anything' } });
    expect(off.res.status).toBe(409);
    expect(off.body?.error).toBe('kind_off');
  });

  it('schedules for later and saves drafts without sending', async () => {
    stub((c) => {
      if (path(c) === 'push_devices' && c.method === 'GET') return json([DEV(1, '111')]);
      if (path(c) === 'notifications' && c.method === 'POST') return json([{ id: 11 }], 201);
      if (path(c) === 'notifications' && c.method === 'PATCH') return json([{ id: 11 }]);
      return undefined;
    });
    const past = await run(push.onRequestPost, '/api/admin/push', { body: { body: 'Soon', when: 'schedule', scheduledFor: new Date(Date.now() - 1000).toISOString() } });
    expect(past.res.status).toBe(400);
    expect(past.body?.error).toBe('schedule_in_past');
    const when = new Date(Date.now() + 3 * 3_600_000).toISOString();
    const sched = await run(push.onRequestPost, '/api/admin/push', { body: { body: 'Soon', when: 'schedule', scheduledFor: when, filter: { lang: 'te' } } });
    expect(sched.body).toMatchObject({ ok: true, id: 11, status: 'scheduled', scheduledFor: when });
    const row = calls.find((c) => path(c) === 'notifications' && c.method === 'POST')?.body as Record<string, unknown>;
    expect(row).toMatchObject({ status: 'scheduled', scheduled_for: when });
    expect((row.audience as { lang: string; label: string })).toMatchObject({ lang: 'te', label: 'Telugu' });
    expect(calls.some((c) => !isDb(c))).toBe(false); // nothing went to a push service
    calls = [];
    const draft = await run(push.onRequestPost, '/api/admin/push', { body: { body: 'Idea', draft: true } });
    expect(draft.body).toMatchObject({ ok: true, id: 11, status: 'draft' });
    const upd = await run(push.onRequestPost, '/api/admin/push', { body: { body: 'Idea v2', draft: true, draftId: 11 } });
    expect(upd.body?.status).toBe('draft');
    const patch = calls.find((c) => path(c) === 'notifications' && c.method === 'PATCH');
    expect(patch?.url.searchParams.get('status')).toBe('eq.draft');
  });

  it('"Send test to me" reaches only the admin\'s own devices and needs Google sign-in', async () => {
    stub((c) => {
      if (path(c) === 'admins') return json([{ email: 'boss@example.com', name: 'Boss', picture: null, role: 'editor', invited_by: null, created_at: 't', last_sign_in: null }]);
      if (path(c) === 'accounts') return json([{ id: '999' }]);
      if (path(c) === 'push_devices' && c.method === 'GET') return json([DEV(7, '999')]);
      return undefined;
    });
    const pw = await run(push.onRequestPost, '/api/admin/push', { body: { body: 'Test', test: true } });
    expect(pw.body?.error).toBe('no_own_account');
    const token = await issueAdminSession(ENV, 'boss@example.com');
    const { body } = await run(push.onRequestPost, '/api/admin/push', { token, body: { body: 'Test', test: true } }, { ...ENV, FCM_SERVICE_ACCOUNT: undefined });
    expect(body).toMatchObject({ ok: true, test: true, devices: 1 });
    expect(calls.find((c) => path(c) === 'accounts')?.url.searchParams.get('email')).toBe('eq.boss@example.com');
    expect(calls.find((c) => path(c) === 'push_devices')?.url.searchParams.get('account_id')).toBe('in.("999")');
    expect(calls.some((c) => path(c) === 'notifications')).toBe(false);
  });

  it('a viewer cannot send', async () => {
    stub((c) => (path(c) === 'admins' ? json([{ email: 'v@example.com', name: null, picture: null, role: 'viewer', invited_by: null, created_at: 't', last_sign_in: null }]) : undefined));
    const token = await issueAdminSession(ENV, 'v@example.com');
    const { res } = await run(push.onRequestPost, '/api/admin/push', { token, body: { body: 'Hi' } });
    expect(res.status).toBe(403);
  });
});

describe('notification history', () => {
  const ROW = { id: 3, at: '2026-11-01T10:00:00Z', kind: 'announcement', title: 'Hi', body: 'There', link: '/', audience: { label: 'Telugu' }, web_total: 4, web_sent: 3, web_gone: 1, fcm_total: 2, fcm_sent: 1, failures: null, dedupe_key: null, sent_by: 'a@x.com', retracted_at: null, status: 'sent', scheduled_for: null, image: null, opened: 2, created_by: 'a@x.com' };
  it('lists rows with delivered, opened and open rate, and counts by status', async () => {
    stub((c) => {
      if (path(c) !== 'notifications') return undefined;
      if (c.prefer.includes('count=exact')) return json([], 200, { 'content-range': `0-0/${c.url.searchParams.get('status') === 'eq.sent' ? 7 : 1}` });
      return json([ROW]);
    });
    const { body } = await run(notifications.onRequestGet, '/api/admin/notifications?status=sent');
    const r = (body?.rows as Array<Record<string, unknown>>)[0];
    expect(r).toMatchObject({ id: 3, status: 'sent', audience: 'Telugu', delivered: 4, opened: 2, openRate: 50 });
    expect(body?.counts).toEqual({ sent: 7, scheduled: 1, draft: 1 });
  });

  it('cancels only scheduled ones and deletes only drafts or cancelled ones', async () => {
    stub((c) => {
      if (path(c) === 'notifications' && c.method === 'PATCH') return json([{ ...ROW, status: 'cancelled' }]);
      if (path(c) === 'notifications' && c.method === 'DELETE') return json([]);
      return undefined;
    });
    const cancel = await run(notifications.onRequestPost, '/api/admin/notifications', { body: { action: 'cancel', id: 3 } });
    expect(cancel.body).toEqual({ ok: true, id: 3, status: 'cancelled' });
    expect(calls.find((c) => c.method === 'PATCH')?.url.searchParams.get('status')).toBe('eq.scheduled');
    const del = await run(notifications.onRequestPost, '/api/admin/notifications', { body: { action: 'delete', id: 3 } });
    expect(del.res.status).toBe(404);
    expect(calls.find((c) => c.method === 'DELETE')?.url.searchParams.get('status')).toBe('in.("draft","cancelled")');
  });

  it('retracting clears the matching announcement', async () => {
    stub((c) => {
      if (path(c) === 'notifications' && c.method === 'PATCH') return json([{ ...ROW, audience: { label: 'Everyone', ts: 123 } }]);
      if (path(c) === 'settings' && c.method === 'GET') return json([{ key: 'announcement', value: { title: 'Hi', body: 'There', link: '/', ts: 123 }, updated_at: 't', updated_by: 'push' }]);
      if (path(c) === 'settings' && c.method === 'DELETE') return json([{ key: 'announcement' }]);
      return undefined;
    });
    const { body } = await run(notifications.onRequestPost, '/api/admin/notifications', { body: { action: 'retract', id: 3 } });
    expect(body).toEqual({ ok: true, id: 3, announcementCleared: true });
  });
});

describe('scheduled sends', () => {
  const DUE = { id: 21, title: 'Weekend picks', body: 'New songs', link: '/charts', image: null, audience: { lang: 'te', label: 'Telugu' } };
  it('claims each due row once, sends it and marks it sent', async () => {
    stub((c) => {
      if (path(c) === 'notifications' && c.method === 'GET') return json([DUE]);
      if (path(c) === 'notifications' && c.method === 'PATCH' && c.url.searchParams.get('status') === 'eq.scheduled') return json([{ id: 21 }]);
      if (path(c) === 'push_devices' && c.method === 'GET') return json([DEV(1, '111')]);
      return undefined;
    });
    const r = await runScheduledNotifications({ ...DB } as never, Date.UTC(2026, 10, 2, 6));
    expect(r).toEqual({ due: 1, sent: 1, waiting: null, failed: 0 });
    const get = calls.find((c) => path(c) === 'notifications' && c.method === 'GET');
    expect(get?.url.searchParams.get('status')).toBe('eq.scheduled');
    expect(get?.url.searchParams.get('scheduled_for')).toBe('lte.2026-11-02T06:00:00.000Z');
    expect(calls.find((c) => path(c) === 'push_devices')?.url.searchParams.get('lang')).toBe('ilike.te*');
    const patches = calls.filter((c) => path(c) === 'notifications' && c.method === 'PATCH').map((c) => (c.body as { status: string }).status);
    expect(patches).toEqual(['sending', 'sent']);
  });

  it('skips a row another run already claimed, and waits during quiet hours', async () => {
    stub((c) => {
      if (path(c) === 'notifications' && c.method === 'GET') return json([DUE]);
      if (path(c) === 'notifications' && c.method === 'PATCH') return json([]);
      return undefined;
    });
    expect(await runScheduledNotifications({ ...DB } as never, Date.UTC(2026, 10, 2, 6))).toEqual({ due: 1, sent: 0, waiting: null, failed: 0 });
    resetSettingsMemo();
    stub((c) => {
      if (path(c) === 'notifications' && c.method === 'GET') return json([DUE]);
      if (path(c) === 'settings') return json(settingsRows({ quiet: { enabled: true, start: '22:00', end: '08:00' } }));
      return undefined;
    });
    const r = await runScheduledNotifications({ ...DB } as never, Date.UTC(2026, 10, 2, 18));
    expect(r.waiting).toBe('quiet_hours');
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('does nothing without a database', async () => {
    stub();
    expect(await runScheduledNotifications({} as never)).toEqual({ due: 0, sent: 0, waiting: null, failed: 0 });
    expect(calls).toEqual([]);
  });
});

describe('taps and device linking', () => {
  it('POST /api/push/opened counts one tap by id', async () => {
    stub();
    const ok = await opened.onRequestPost({ request: req('/api/push/opened', { token: null, body: { id: 42 } }), env: DB });
    expect(ok.status).toBe(204);
    const call = calls.find((c) => path(c) === 'rpc/notification_opened');
    expect(call?.body).toEqual({ p_id: 42 });
    const bad = await opened.onRequestPost({ request: req('/api/push/opened', { token: null, body: { id: 'x' } }), env: DB });
    expect(bad.status).toBe(400);
  });

  it('a registration with a session links the device to the account; without one it is unlinked', async () => {
    stub();
    const session = await issueSession(ENV, '123456');
    const endpoint = 'https://fcm.googleapis.com/fcm/send/abc';
    await subscribe.onRequestPost({ request: req('/api/push/subscribe', { token: null, body: { endpoint, keys: { p256dh: 'p', auth: 'a' } }, headers: { authorization: `Bearer ${session}` } }), env: ENV as never });
    expect((calls.find((c) => path(c) === 'push_devices')?.body as { account_id: string }).account_id).toBe('123456');
    stub();
    await subscribe.onRequestPost({ request: req('/api/push/subscribe', { token: null, body: { endpoint, keys: { p256dh: 'p', auth: 'a' } } }), env: ENV as never });
    expect((calls.find((c) => path(c) === 'push_devices')?.body as { account_id: unknown }).account_id).toBeNull();
    stub();
    await fcmRegister.onRequestPost({ request: req('/api/push/fcm-register', { token: null, body: { token: 'x'.repeat(40) }, headers: { authorization: `Bearer ${session}` } }), env: ENV as never });
    expect((calls.find((c) => path(c) === 'push_devices')?.body as { account_id: string }).account_id).toBe('123456');
  });

  it('a database without the account column still saves the device', async () => {
    let first = true;
    stub((c) => {
      if (path(c) === 'push_devices' && first) { first = false; return json({ code: 'PGRST204', message: 'no account_id column' }, 400); }
      return undefined;
    });
    const session = await issueSession(ENV, '123456');
    const res = await subscribe.onRequestPost({ request: req('/api/push/subscribe', { token: null, body: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'p', auth: 'a' } }, headers: { authorization: `Bearer ${session}` } }), env: ENV as never });
    expect(res.status).toBe(200);
    const writes = calls.filter((c) => path(c) === 'push_devices');
    expect(writes).toHaveLength(2);
    expect('account_id' in (writes[1].body as Record<string, unknown>)).toBe(false);
  });
});

describe('A/B tests', () => {
  it('targets by platform, minimum version and percent', () => {
    expect(compareVersions('1.10.0', '1.9.3')).toBe(1);
    expect(compareVersions('1.8', '1.8.0')).toBe(0);
    expect(sanitizeAudience({ platform: 'tv', minVersion: 'x', percent: 250 })).toEqual({ platform: 'all', minVersion: null, percent: 100 });
    expect(inAudience('d1', 'k', { platform: 'android' }, { platform: 'web' })).toBe(false);
    expect(inAudience('d1', 'k', { platform: 'android', minVersion: '1.8.0' }, { platform: 'android', version: '1.7.9' })).toBe(false);
    expect(inAudience('d1', 'k', { platform: 'android', minVersion: '1.8.0' }, { platform: 'android', version: '1.8.3' })).toBe(true);
    expect(inAudience('d1', 'k', { percent: 0 })).toBe(false);
    let n = 0;
    for (let i = 0; i < 2000; i += 1) if (inAudience(`dev-${i}`, 'k', { percent: 25 })) n += 1;
    expect(n).toBeGreaterThan(400);
    expect(n).toBeLessThan(600);
  });

  it('saves a test with its audience and lifecycle; status changes check the winner', async () => {
    const saved = { key: 'home-shelf-order', name: 'Home order', variants: [{ name: 'control', pct: 50 }, { name: 'discovery-first', pct: 50 }], status: 'draft', active: false };
    stub((c) => {
      if (path(c) !== 'experiments') return undefined;
      if (c.method === 'GET') return json([saved]);
      return json([{ ...saved, ...(c.body as object) }], c.method === 'POST' ? 201 : 200);
    });
    const r = await run(experiments.onRequestPost, '/api/admin/experiments', { body: { action: 'save', key: 'home-shelf-order', name: 'Home order', description: 'Discovery first?', variants: saved.variants, audience: { platform: 'android', minVersion: '1.8.0', percent: 20 }, status: 'running' } });
    expect(r.res.status).toBe(200);
    const row = calls.find((c) => path(c) === 'experiments' && c.method === 'POST')?.body as Record<string, unknown>;
    expect(row).toMatchObject({ status: 'running', active: true, description: 'Discovery first?', audience: { platform: 'android', minVersion: '1.8.0', percent: 20 } });
    expect(typeof row.started_at).toBe('string');
    const bad = await run(experiments.onRequestPost, '/api/admin/experiments', { body: { action: 'status', key: 'home-shelf-order', status: 'finished', winner: 'nobody' } });
    expect(bad.body?.error).toBe('bad_winner');
    const fin = await run(experiments.onRequestPost, '/api/admin/experiments', { body: { action: 'status', key: 'home-shelf-order', status: 'finished', winner: 'discovery-first' } });
    expect(fin.body?.ok).toBe(true);
    const patch = calls.find((c) => path(c) === 'experiments' && c.method === 'PATCH')?.body as Record<string, unknown>;
    expect(patch).toMatchObject({ status: 'finished', active: false, winner: 'discovery-first' });
    expect(typeof patch.ended_at).toBe('string');
  });

  it('GET derives a status for old rows; the public list serves running tests with their audience', async () => {
    stub((c) => {
      if (path(c) === 'experiments' && c.url.searchParams.get('active') === 'eq.true') return json([{ key: 'a', variants: [{ name: 'x', pct: 50 }], audience: { percent: 30 }, status: 'running' }, { key: 'b', variants: [{ name: 'y', pct: 50 }], audience: {}, status: 'paused' }]);
      if (path(c) === 'experiments') return json([{ key: 'old', variants: [], active: true }]);
      if (path(c) === 'accounts') return json([], 200, { 'content-range': '0-0/42' });
      return undefined;
    });
    const admin = await run(experiments.onRequestGet, '/api/admin/experiments');
    expect((admin.body?.rows as Array<{ status: string }>)[0].status).toBe('running');
    expect(admin.body?.activeUsers).toBe(42);
    const res = await publicExperiments.onRequestGet({ env: DB });
    const pub = (await res.json()) as { experiments: Array<{ key: string; audience: { percent: number } }> };
    expect(pub.experiments.map((e) => e.key)).toEqual(['a']);
    expect(pub.experiments[0].audience.percent).toBe(30);
  });
});
