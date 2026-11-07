/**
 * Console rebuild — the rules a review of the rebuild asked for:
 *  - running a job by hand needs an Owner (viewers and editors get 403);
 *  - the `retention` and `jobs` settings (data deletion, background work) need an Owner;
 *  - a blocked person's session stops working on every signed-in route, not only sign-in;
 *  - read-only mode covers everything under a listed path (shared-playlist edits);
 *  - the scheduler reads each job's own last run and skips a job whose read failed;
 *  - the daily "played together" rebuild is caught up when the evening run was missed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { issueAdminSession, resetAdminMemo } from '../functions/_lib/adminAuth';
import { forgetBlocked, issueSession, readSession } from '../functions/_lib/googleAuth';
import { colistenDue, JOBS, runScheduled } from '../functions/_lib/jobs';
import { readOnlyRefusal } from '../functions/_lib/readOnly';
import { resetSettingsMemo } from '../functions/_lib/settings';
import * as cronRun from '../functions/api/cron/run';
import * as settings from '../functions/api/admin/settings';

const DB = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-key' };
const ENV = { AUTH_SECRET: 'auth-secret-for-tests', GOOGLE_CLIENT_ID: '1-abc.apps.googleusercontent.com', ...DB };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

interface Call { url: URL; method: string; body: unknown }
let calls: Call[] = [];
let tables: Record<string, Array<Record<string, unknown>>> = {};
let failTable: string | null = null;

function stub(): void {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, method, body });
    const table = url.pathname.replace('/rest/v1/', '');
    if (failTable && table === failTable && method === 'GET') return json({ message: 'down' }, 503);
    if (method === 'GET') {
      let rows = tables[table] ?? [];
      for (const [k, v] of url.searchParams) if (v.startsWith('eq.') && !['select', 'order', 'limit'].includes(k)) rows = rows.filter((r) => String(r[k]) === v.slice(3));
      return json(rows);
    }
    return json(Array.isArray(body) ? body : body ? [body] : [], method === 'POST' ? 201 : 200);
  }));
}
const req = (path: string, token: string | null, body?: unknown) => new Request(`https://admin.vinaxmusic.online${path}`, {
  method: 'POST',
  headers: { 'cf-connecting-ip': '203.0.113.30', 'content-type': 'application/json', ...(token ? { 'x-admin-token': token } : {}) },
  body: JSON.stringify(body ?? {}),
});
type H = (ctx: { request: Request; env: Record<string, unknown> }) => Promise<Response>;
const call = async (h: unknown, r: Request) => (await (h as H)({ request: r, env: ENV })).status;
const tokenFor = async (email: string) => (await issueAdminSession(ENV, email))!;

beforeEach(() => {
  resetAdminMemo(); resetSettingsMemo(); forgetBlocked(); failTable = null;
  tables = {
    admins: [
      { email: 'boss@example.com', role: 'owner', name: null, picture: null, invited_by: null, created_at: 't', last_sign_in: null },
      { email: 'editor@example.com', role: 'editor', name: null, picture: null, invited_by: null, created_at: 't', last_sign_in: null },
      { email: 'viewer@example.com', role: 'viewer', name: null, picture: null, invited_by: null, created_at: 't', last_sign_in: null },
    ],
    settings: [], job_runs: [], accounts: [],
  };
  stub();
});
afterEach(() => vi.unstubAllGlobals());

describe('owner-only actions', () => {
  it('running a job by hand needs an Owner', async () => {
    expect(await call(cronRun.onRequestPost, req('/api/cron/run', await tokenFor('viewer@example.com'), { job: 'housekeeping' }))).toBe(403);
    expect(await call(cronRun.onRequestPost, req('/api/cron/run', await tokenFor('editor@example.com'), { job: 'housekeeping' }))).toBe(403);
    expect(await call(cronRun.onRequestPost, req('/api/cron/run', null, { job: 'housekeeping' }))).toBe(401);
    expect(await call(cronRun.onRequestPost, req('/api/cron/run', await tokenFor('boss@example.com'), { job: 'nope' }))).toBe(400);
  });

  it('retention and jobs settings need an Owner; other settings an Editor', async () => {
    const editor = await tokenFor('editor@example.com');
    expect(await call(settings.onRequestPost, req('/api/admin/settings', editor, { key: 'retention', value: { eventsDays: 7 } }))).toBe(403);
    expect(await call(settings.onRequestPost, req('/api/admin/settings', editor, { key: 'jobs', value: { housekeeping: { enabled: false } } }))).toBe(403);
    expect(await call(settings.onRequestPost, req('/api/admin/settings', editor, { key: 'greeting', value: { enabled: true, morning: 'Hi' } }))).toBe(200);
    expect(await call(settings.onRequestPost, req('/api/admin/settings', await tokenFor('boss@example.com'), { key: 'retention', value: { eventsDays: 90 } }))).toBe(200);
    expect(await call(settings.onRequestPost, req('/api/admin/settings', await tokenFor('viewer@example.com'), { key: 'greeting', value: null }))).toBe(403);
  });
});

describe('blocked people', () => {
  it('a blocked account loses every session check, and the answer is remembered a minute', async () => {
    const token = await issueSession(ENV, '111');
    tables.accounts = [{ id: '111', blocked_at: null }];
    expect(await readSession(ENV, token)).toBe('111');
    tables.accounts = [{ id: '111', blocked_at: '2026-11-03T00:00:00Z' }];
    expect(await readSession(ENV, token)).toBe('111'); // still remembered as not blocked
    forgetBlocked('111');
    expect(await readSession(ENV, token)).toBeNull();
  });

  it('a database that does not answer never signs people out, and is asked once a minute', async () => {
    const token = await issueSession(ENV, '222');
    failTable = 'accounts';
    expect(await readSession(ENV, token)).toBe('222');
    expect(await readSession(ENV, token)).toBe('222');
    expect(calls.filter((c) => c.url.pathname.endsWith('/accounts')).length).toBe(1);
  });

  it('without a database the session check is the signature alone', async () => {
    const env = { AUTH_SECRET: 'auth-secret-for-tests' };
    expect(await readSession(env, await issueSession(env, '333'))).toBe('333');
    expect(calls.length).toBe(0);
  });
});

describe('read-only mode', () => {
  it('covers everything under a listed path', async () => {
    tables.settings = [{ key: 'site-mode', value: { mode: 'readonly' }, updated_at: 't', updated_by: 'o' }];
    expect((await readOnlyRefusal('/api/shared-playlist/abc123', 'POST', DB))?.status).toBe(503);
    expect((await readOnlyRefusal('/api/shared-playlist', 'POST', DB))?.status).toBe(503);
    expect(await readOnlyRefusal('/api/shared-playlist/abc123', 'GET', DB)).toBeNull();
    expect(await readOnlyRefusal('/api/shared-playlists-elsewhere', 'POST', DB)).toBeNull();
  });
});

describe('scheduler', () => {
  const T = Date.UTC(2026, 10, 3, 10, 0);
  it('asks for each job’s own last run and skips a job whose read failed', async () => {
    failTable = 'job_runs';
    const out = await runScheduled(DB, T);
    expect(out).toEqual([]);
    const reads = calls.filter((c) => c.url.pathname.endsWith('/job_runs') && c.method === 'GET');
    expect(reads.length).toBe(JOBS.length); // one per job (seven with the weekly summary)
    expect(JOBS.length).toBe(7);
    for (const r of reads) {
      expect(r.url.searchParams.get('job')).toMatch(/^eq\./);
      expect(r.url.searchParams.get('limit')).toBe('1');
    }
  });

  it('the daily rebuild prefers 21:00 UTC and catches up after 30 hours', () => {
    const at = (h: number) => Date.UTC(2026, 10, 3, h, 0);
    expect(colistenDue(null, at(10))).toBe(true);
    expect(colistenDue(new Date(at(21) - 22 * 3_600_000).toISOString(), at(21))).toBe(true);
    expect(colistenDue(new Date(at(21) - 10 * 3_600_000).toISOString(), at(21))).toBe(false);
    expect(colistenDue(new Date(at(10) - 25 * 3_600_000).toISOString(), at(10))).toBe(false);
    expect(colistenDue(new Date(at(10) - 31 * 3_600_000).toISOString(), at(10))).toBe(true);
  });
});
