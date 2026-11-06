/**
 * Schema 12 — sign-in history: every Google sign-in to the app writes a
 * `sign_ins` row (time, IP, browser, app, geo, first sign-in / new device),
 * the user's console profile lists them, the hourly clean-up deletes rows
 * older than 90 days, and a database without the table never breaks sign-in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../functions/_lib/googleAuth', async (orig) => {
  const real = await orig<typeof import('../functions/_lib/googleAuth')>();
  return {
    ...real,
    verifyGoogleIdToken: vi.fn(async (_env: unknown, token: unknown) =>
      token === 'listener-token' ? { sub: '110000000000000000001', email: 'listener@example.com', emailVerified: true, name: 'Asha', picture: null } : null),
  };
});

import { DB_ENV, fakeDb, type DbCall } from './helpers/fakeDb';
import { signId } from '../functions/_lib/identity';
import { issueAdminSession, resetAdminMemo } from '../functions/_lib/adminAuth';
import { resetSettingsMemo } from '../functions/_lib/settings';
import { _resetRateLimitsForTests } from '../functions/_lib/ratelimit';
import { runJob } from '../functions/_lib/jobs';
import * as google from '../functions/api/auth/google';
import * as listeners from '../functions/api/admin/listeners';

const SECRETS = { AUTH_SECRET: 'auth-secret-for-tests', DEVICE_ID_SECRET: 'device-secret-for-tests', GOOGLE_CLIENT_ID: '1-abc.apps.googleusercontent.com' };
const ENV = { ...SECRETS, ...DB_ENV };
const SUB = '110000000000000000001';
const PHONE = 'd_' + 'ef'.repeat(16);
const LAPTOP = 'd_' + 'ab'.repeat(16);
const CHROME_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const post = (body: unknown, ip = '203.0.113.7') => new Request('https://www.vinaxmusic.online/api/auth/google', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, 'cf-ipcountry': 'IN', 'user-agent': CHROME_WIN },
  body: JSON.stringify(body),
});

beforeEach(() => { resetSettingsMemo(); resetAdminMemo(); _resetRateLimitsForTests(); });
afterEach(() => vi.unstubAllGlobals());

describe('sign-in history', () => {
  it('records the first sign-in, a known device and a new device, with IP and browser', async () => {
    const fake = fakeDb({ listeners: [{ id: PHONE }, { id: LAPTOP }] });
    // First sign-in, on the phone.
    await google.onRequestPost({ request: post({ credential: 'listener-token', signed_device_id: await signId(SECRETS.DEVICE_ID_SECRET, PHONE), platform: 'web', appVersion: '1.10.8' }), env: ENV });
    // Again on the phone (now linked), then on a laptop it has never used.
    await google.onRequestPost({ request: post({ credential: 'listener-token', signed_device_id: await signId(SECRETS.DEVICE_ID_SECRET, PHONE) }), env: ENV });
    await google.onRequestPost({ request: post({ credential: 'listener-token', signed_device_id: await signId(SECRETS.DEVICE_ID_SECRET, LAPTOP) }, '2001:db8::1'), env: ENV });
    const rows = fake.rows('sign_ins');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ account_id: SUB, ip: '203.0.113.7', browser: 'Chrome on Windows', platform: 'web', app_version: '1.10.8', country: 'IN', signup: true, new_device: false });
    expect(rows[1]).toMatchObject({ signup: false, new_device: false });
    expect(rows[2]).toMatchObject({ ip: '2001:db8::1', signup: false, new_device: true });
  });

  it('a forged IP header value is not stored', async () => {
    const fake = fakeDb({});
    await google.onRequestPost({ request: post({ credential: 'listener-token' }, '<script>'), env: ENV });
    expect(fake.rows('sign_ins')[0]).toMatchObject({ ip: null });
  });

  it('a database without the table (before the update) still signs people in', async () => {
    const fake = fakeDb({});
    fake.answer('sign_ins', () => new Response(JSON.stringify({ code: '42P01', message: 'relation "sign_ins" does not exist' }), { status: 404, headers: { 'content-type': 'application/json' } }));
    const res = await google.onRequestPost({ request: post({ credential: 'listener-token' }), env: ENV });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { stored: boolean }).stored).toBe(true);
  });

  it('the console profile lists the latest sign-ins, newest first', async () => {
    const fake = fakeDb({
      admins: [{ email: 'boss@example.com', role: 'owner', name: 'Boss', picture: null, invited_by: null, created_at: 't', last_sign_in: null }],
      sign_ins: [{ id: 1, account_id: SUB, at: '2026-11-06T10:00:00Z', ip: '203.0.113.7', browser: 'Chrome on Windows', platform: 'web', app_version: '1.10.8', country: 'IN', region: 'Telangana', city: 'Hyderabad', new_device: true, signup: false }],
    });
    fake.answer('rpc/user_profile', () => new Response(JSON.stringify({ account: { id: SUB } }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const token = (await issueAdminSession(ENV, 'boss@example.com'))!;
    const res = await listeners.onRequestGet({ request: new Request(`https://admin.vinaxmusic.online/api/admin/listeners?account=${SUB}`, { headers: { 'x-admin-token': token } }), env: ENV });
    const body = (await res.json()) as { profile: { signIns: unknown[] } };
    expect(body.profile.signIns).toEqual([{ at: '2026-11-06T10:00:00Z', ip: '203.0.113.7', browser: 'Chrome on Windows', platform: 'web', appVersion: '1.10.8', country: 'IN', region: 'Telangana', city: 'Hyderabad', newDevice: true, signup: false }]);
    const read = fake.calls.find((c: DbCall) => c.table === 'sign_ins')!;
    expect(read.query).toContain(`account_id=eq.${SUB}`);
    expect(read.query).toContain('order=at.desc');
    expect(read.query).toContain('limit=100');
  });

  it('the hourly clean-up deletes sign-ins older than 90 days', async () => {
    const day = 86_400_000;
    const fake = fakeDb({
      sign_ins: [
        { id: 1, account_id: SUB, at: new Date(Date.now() - 91 * day).toISOString() },
        { id: 2, account_id: SUB, at: new Date(Date.now() - 89 * day).toISOString() },
      ],
    });
    const r = await runJob(DB_ENV, 'housekeeping');
    expect(r.summary).toMatchObject({ signInsPruned: 'done' });
    expect(fake.rows('sign_ins').map((x) => x.id)).toEqual([2]);
  });
});
