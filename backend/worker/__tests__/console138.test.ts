/**
 * 13.8 — server fixes found while rebuilding the owner console against a
 * freshly wiped database. Each test drives the real handler against a stubbed
 * database REST layer.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestPost as appconfigPost } from '../functions/api/admin/appconfig';
import { onRequestGet as cronGet } from '../functions/api/admin/cron';
import { onRequestGet as tablesGet } from '../functions/api/admin/tables';
import { onRequestGet as seoGet } from '../functions/api/admin/seo';
import { onRequestGet as overviewGet } from '../functions/api/admin/overview';
import { onRequestGet as queryGet } from '../functions/api/admin/query';
import { onRequestPost as maintenancePost } from '../functions/api/admin/maintenance';
import { onRequestGet as liveGet } from '../functions/api/admin/live';
import { onRequestPost as notifylogPost } from '../functions/api/admin/notifylog';
import { onRequestGet as contentGet } from '../functions/api/admin/content';
import { onRequestGet as userGet } from '../functions/api/admin/user';
import { AI_CONTROL_FEATURES } from '../functions/api/admin/aiops';
import { AI_FEATURES } from '../functions/_lib/ai';

const ENV = { ADMIN_LOGIN_PASSWORD: 'test-secret', SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'srk' };

interface Call { url: string; method: string; body: string | null }
const calls: Call[] = [];
type Route = [match: (url: string, method: string) => boolean, make: (url: string) => Response];
const json = (v: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json', ...headers } });

function db(routes: Route[]): void {
  calls.length = 0;
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = decodeURIComponent(String(input));
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body ? String(init.body) : null });
    for (const [match, make] of routes) if (match(url, method)) return Promise.resolve(make(url));
    return Promise.resolve(new Response('[]', { status: 200, headers: { 'content-range': '*/0' } }));
  });
}

let ip = 0;
function req(path: string, method = 'GET', body?: unknown): Request {
  ip += 1;
  return new Request(`https://admin.test${path}`, {
    method,
    headers: { 'x-admin-token': 'test-secret', 'content-type': 'application/json', 'cf-connecting-ip': `10.138.0.${ip % 250}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('appconfig: value null clears the key', () => {
  it('deletes the row instead of upserting null (jsonb NOT NULL)', async () => {
    db([[(u, m) => m === 'GET' && u.includes('/vinax_config'), () => json([{ value: { text: 'old' } }])]]);
    const res = await appconfigPost({ request: req('/api/admin/appconfig', 'POST', { key: 'greeting', value: null }), env: ENV });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, cleared: true });
    const writes = calls.filter((c) => c.url.includes('/vinax_config') && c.method !== 'GET');
    expect(writes).toHaveLength(1);
    expect(writes[0].method).toBe('DELETE');
    expect(writes[0].url).toContain('key=eq.greeting');
    // and an audit row was written
    expect(calls.some((c) => c.url.includes('/vinax_feedback') && c.method === 'POST')).toBe(true);
  });

  it('a failed delete is store_failed, not ok', async () => {
    db([[(_u, m) => m === 'DELETE', () => new Response('nope', { status: 500 })]]);
    const res = await appconfigPost({ request: req('/api/admin/appconfig', 'POST', { key: 'greeting', value: null }), env: ENV });
    expect(res.status).toBe(502);
  });
});

describe('cron on an empty database', () => {
  it('jobs with no footprint are "not run yet", not overdue', async () => {
    db([]);
    const res = await cronGet({ request: req('/api/admin/cron'), env: ENV });
    const body = (await res.json()) as { jobs: Array<{ ok: boolean | null; neverRan: boolean; readable: boolean }> };
    expect(body.jobs.length).toBeGreaterThan(0);
    for (const j of body.jobs) {
      expect(j.readable).toBe(true);
      expect(j.neverRan).toBe(true);
      expect(j.ok).toBeNull();
    }
  });

  it('a stale footprint is still overdue', async () => {
    const old = new Date(Date.now() - 30 * 86_400_000).toISOString();
    db([[(u) => u.includes('/vinax_events') || u.includes('/vinax_seo_urls') || u.includes('/uptime_last'), () => json([{ created_at: old, added_at: old, checked_at: old }])]]);
    const res = await cronGet({ request: req('/api/admin/cron'), env: ENV });
    const body = (await res.json()) as { jobs: Array<{ ok: boolean | null; neverRan: boolean }> };
    for (const j of body.jobs) { expect(j.ok).toBe(false); expect(j.neverRan).toBe(false); }
  });
});

describe('tables', () => {
  it('reads every table by a timestamp column it really has, so a healthy empty database totals 0', async () => {
    db([]);
    const res = await tablesGet({ request: req('/api/admin/tables'), env: ENV });
    const body = (await res.json()) as { totalRows: number | null; tables: Array<{ name: string; readable: boolean }>; unavailable: string[] };
    expect(body.unavailable).toEqual([]);
    expect(body.totalRows).toBe(0);
    const names = body.tables.map((t) => t.name);
    expect(names).toContain('vinax_accounts');
    expect(names).toContain('vinax_account_data');
    // none of the four tables without created_at is asked for it any more
    for (const t of ['vinax_users', 'vinax_room_members', 'vinax_push_subscriptions', 'vinax_fcm_tokens']) {
      const asked = calls.filter((c) => c.url.includes(`/rest/v1/${t}?`));
      expect(asked.length).toBeGreaterThan(0);
      for (const c of asked) expect(c.url).not.toContain('created_at');
    }
  });
});

describe('seo corpus', () => {
  it('selects title + slug (the table has no name column)', async () => {
    db([[(u) => u.includes('/vinax_seo_urls') && u.includes('select=key'), () => json([{ key: 'song:1', type: 'song', title: 'Kesariya', slug: 'kesariya', lang: 'hindi', added_at: new Date().toISOString() }])]]);
    const res = await seoGet({ request: req('/api/admin/seo'), env: ENV });
    expect(res.status).toBe(200);
    const sel = calls.find((c) => c.url.includes('/vinax_seo_urls') && c.url.includes('select=key'));
    expect(sel?.url).toContain('title');
    expect(sel?.url).not.toMatch(/select=[^&]*\bname\b/);
    const body = (await res.json()) as { newest: Array<{ name: string; slug: string }> };
    expect(body.newest[0]).toMatchObject({ name: 'Kesariya', slug: 'kesariya' });
  });
});

describe('overview', () => {
  it('counts signed-in accounts separately', async () => {
    db([
      [(u) => u.includes('/rpc/vinax_overview'), () => json({ total_users: 0 })],
      [(u) => u.includes('/rpc/'), () => json([])],
      [(u) => u.includes('/vinax_accounts') && u.includes('created_at=gte.'), () => json([], 200, { 'content-range': '0-0/2' })],
      [(u) => u.includes('/vinax_accounts') && u.includes('last_seen=gte.'), () => json([], 200, { 'content-range': '0-0/4' })],
      [(u) => u.includes('/vinax_accounts'), () => json([], 200, { 'content-range': '0-0/5' })],
    ]);
    const res = await overviewGet({ request: req('/api/admin/overview'), env: ENV });
    const body = (await res.json()) as { accounts: { total: number; newToday: number; active7d: number } };
    expect(body.accounts).toEqual({ total: 5, newToday: 2, active7d: 4 });
  });
});

describe('query without a database', () => {
  it('still answers with a columns array', async () => {
    const res = await queryGet({ request: req('/api/admin/query?table=vinax_events'), env: { ADMIN_LOGIN_PASSWORD: 'test-secret' } });
    expect(await res.json()).toMatchObject({ configured: false, columns: [], rows: [] });
  });
});

describe('delete_user', () => {
  it('a device that does not exist keeps its events (user row is checked first)', async () => {
    db([[(u, m) => m === 'DELETE' && u.includes('/vinax_users'), () => json([])]]);
    const res = await maintenancePost({ request: req('/api/admin/maintenance', 'POST', { action: 'delete_user', device_id: 'c_typo', reason: 'cleanup' }), env: ENV });
    expect(res.status).toBe(404);
    expect(calls.some((c) => c.method === 'DELETE' && c.url.includes('/vinax_events'))).toBe(false);
  });

  it('a real device is deleted and answers ok', async () => {
    db([[(u, m) => m === 'DELETE' && u.includes('/vinax_users'), () => json([{ device_id: 'c_real' }])]]);
    const res = await maintenancePost({ request: req('/api/admin/maintenance', 'POST', { action: 'delete_user', device_id: 'c_real', reason: 'cleanup' }), env: ENV });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, eventsDeleted: true });
  });
});

describe('AI controls', () => {
  it('every switchable AI feature is in the console list, so a publish never flips one back on', () => {
    for (const f of ['transcribe', 'music']) expect(AI_CONTROL_FEATURES).toContain(f);
    const missing = AI_FEATURES.filter((f) => !(AI_CONTROL_FEATURES as readonly string[]).includes(f));
    expect(missing).toEqual([]);
  });
});

describe('live listeners', () => {
  it('a listener with only a handle is shown by it, not as Anonymous', async () => {
    db([[(u) => u.includes('/vinax_users'), () => json([{ device_id: 'c_1', name: null, username: 'vinay', is_playing: true, last_seen: new Date().toISOString() }])]]);
    const res = await liveGet({ request: req('/api/admin/live'), env: ENV });
    const body = (await res.json()) as { listeners: Array<{ name: string; username: string | null }> };
    expect(body.listeners[0]).toMatchObject({ name: '@vinay', username: 'vinay' });
  });
});

describe('listener drawer for an account', () => {
  it('an account linked to a device with no usage row still opens as the account', async () => {
    db([
      [(u) => u.includes('/vinax_accounts') && u.includes('google_sub=eq.42'), () => json([{ google_sub: '42', name: 'Signed In', email: 'a@example.com', device_id: 'c_gone', created_at: new Date().toISOString(), last_seen: new Date().toISOString() }])],
      [(u) => u.includes('/vinax_users'), () => json([])],
    ]);
    const res = await userGet({ request: req('/api/admin/user?deviceId=account:42'), env: ENV });
    const body = (await res.json()) as { user: { name: string } | null };
    expect(body.user).not.toBeNull();
    expect(body.user?.name).toBe('Signed In');
  });
});

describe('reads above the 1,000-row page', () => {
  it('a limit=2500 read is paged and returns every row', async () => {
    const { sbSelectResult } = await import('../functions/_lib/supabase');
    db([[(u) => u.includes('/vinax_events'), (u) => {
      const lim = Number(/limit=(\d+)/.exec(u)?.[1]);
      const off = Number(/offset=(\d+)/.exec(u)?.[1] ?? 0);
      const n = Math.max(0, Math.min(lim, 2300 - off));
      return json(Array.from({ length: n }, (_, i) => ({ id: off + i })));
    }]]);
    const r = await sbSelectResult<{ id: number }>(ENV, 'vinax_events', 'select=id&order=id.asc&limit=2500');
    expect(r.ok).toBe(true);
    expect(r.rows).toHaveLength(2300);
    expect(new Set(r.rows.map((x) => x.id)).size).toBe(2300);
    expect(calls.map((c) => /limit=\d+&offset=\d+/.exec(c.url)?.[0])).toEqual(['limit=1000&offset=0', 'limit=1000&offset=1000', 'limit=500&offset=2000']);
  });

  it('a small read is one request, unchanged', async () => {
    const { sbSelectResult } = await import('../functions/_lib/supabase');
    db([]);
    await sbSelectResult(ENV, 'vinax_events', 'select=id&limit=50');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).not.toContain('offset');
  });
});

describe('notification history', () => {
  it('removing an announcement also removes its delivery receipt', async () => {
    db([[(u, m) => m === 'DELETE' && u.includes('type=in.'), () => json([{ type: 'announcement', created_at: '2026-10-21T10:00:00Z', message: JSON.stringify({ title: 'Hi', body: 'x', ts: 1761040800000 }) }])]]);
    const res = await notifylogPost({ request: req('/api/admin/notifylog', 'POST', { action: 'retract', created_at: '2026-10-21T10:00:00Z' }), env: ENV });
    expect(res.status).toBe(200);
    const receipt = calls.find((c) => c.method === 'DELETE' && c.url.includes('type=eq.push-receipt'));
    expect(receipt?.url).toContain('message=like.{"ts":1761040800000,*');
  });
});

describe('blocked content', () => {
  it('a failing suggestions function does not hide the blocklist', async () => {
    db([
      [(u) => u.includes('/rpc/vinax_blockable_songs'), () => new Response('missing', { status: 404 })],
      [(u) => u.includes('/vinax_blocklist'), () => json([{ song_id: 's1', song_title: 'X', reason: 'r', created_at: new Date().toISOString() }])],
    ]);
    const res = await contentGet({ request: req('/api/admin/content'), env: ENV });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { blocked: unknown[]; topSongs: unknown[] };
    expect(body.blocked).toHaveLength(1);
    expect(body.topSongs).toEqual([]);
  });
});
