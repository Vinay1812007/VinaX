/**
 * Console rebuild — Feedback, Song Stats and Music Library routes against a
 * mocked PostgREST: feedback filters and the person behind a message (never
 * the device id), reply by notification, album blocks with a reason and who
 * blocked, the Song Stats views, and the catalogue search types and previews.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as feedback from '../functions/api/admin/feedback';
import * as content from '../functions/api/admin/content';
import * as analytics from '../functions/api/admin/analytics';
import * as catalog from '../functions/api/admin/catalog-search';
import { resetSettingsMemo } from '../functions/_lib/settings';
import { _resetRateLimitsForTests } from '../functions/_lib/ratelimit';

const TOKEN = 'owner-password-for-tests';
const ENV = { ADMIN_LOGIN_PASSWORD: TOKEN, SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-key', VAPID_PUBLIC_KEY: 'p', VAPID_PRIVATE_KEY: 'k', VAPID_SUBJECT: 'mailto:o@x' };

interface Call { url: URL; method: string; body: unknown; prefer: string }
type Responder = (call: Call) => Response | undefined;
let calls: Call[] = [];
function stub(respond: Responder = () => undefined, outside: (url: URL) => Response | undefined = () => undefined): void {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const parse = (): unknown => { try { return init?.body ? JSON.parse(String(init.body)) : null; } catch { return String(init?.body); } };
    const body = parse();
    const prefer = String((init?.headers as Record<string, string> | undefined)?.prefer ?? '');
    const call = { url, method, body, prefer };
    calls.push(call);
    if (!url.href.startsWith('https://db.test/rest/v1/')) return outside(url) ?? new Response('{}', { status: 200 });
    const r = respond(call);
    if (r) return r;
    return new Response(JSON.stringify(method === 'GET' ? [] : prefer.includes('representation') ? [] : null), { status: method === 'GET' ? 200 : 201, headers: { 'content-type': 'application/json', 'content-range': '0-0/0' } });
  }));
}
const json = (b: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json', ...headers } });
const table = (c: Call) => c.url.pathname.replace('/rest/v1/', '');
type Handler = (ctx: { request: Request; env: Record<string, unknown> }) => Promise<Response>;
async function run(h: unknown, path: string, body?: unknown, env: Record<string, unknown> = ENV) {
  const headers: Record<string, string> = { 'x-admin-token': TOKEN, 'cf-connecting-ip': '203.0.113.9' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await (h as Handler)({ request: new Request(`https://admin.vinaxmusic.online${path}`, { method: body !== undefined ? 'POST' : 'GET', headers, body: body !== undefined ? JSON.stringify(body) : undefined }), env });
  return { res, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
}

beforeEach(() => { resetSettingsMemo(); _resetRateLimitsForTests(); });
afterEach(() => vi.unstubAllGlobals());

describe('feedback', () => {
  const ROW = { id: 7, at: '2026-11-01T10:00:00Z', listener_id: 'd_aaaaaaaaaaaaaaaa', name: 'Ravi', kind: 'bug', message: 'stops', platform: 'android', app_version: '1.8.3', country: 'IN', city: 'Hyderabad', status: 'new', note: null, resolved_at: null };

  it('filters by type, platform and days, names the signed-in person and never returns the device id', async () => {
    stub((c) => {
      const t = table(c);
      if (t === 'feedback') return json([ROW], 200, { 'content-range': '0-0/1' });
      if (t === 'listeners') return json([{ id: ROW.listener_id, account_id: '1001' }]);
      if (t === 'accounts' && c.url.searchParams.get('listener_id')) return json([]);
      if (t === 'accounts') return json([{ id: '1001', name: 'Ravi Kumar', email: 'ravi@example.com', picture: null }]);
      if (t === 'push_devices') return json([{ id: 1, channel: 'web', target: 'https://push.example/1', p256dh: 'k', auth: 'a', account_id: '1001' }]);
      return undefined;
    });
    const r = await run(feedback.onRequestGet, '/api/admin/feedback?status=all&kind=bug&platform=android&days=7');
    expect(r.res.status).toBe(200);
    const list = calls.find((c) => table(c) === 'feedback' && c.url.searchParams.get('select') === '*')!;
    expect(list.url.searchParams.get('kind')).toBe('eq.bug');
    expect(list.url.searchParams.get('platform')).toBe('eq.android');
    expect(list.url.searchParams.get('at')).toMatch(/^gte\./);
    expect(list.url.searchParams.get('status')).toBeNull();
    const row = (r.body?.rows as Array<Record<string, unknown>>)[0];
    expect(row).toMatchObject({ id: 7, kind: 'bug', appVersion: '1.8.3', canReply: true, user: { id: '1001', email: 'ravi@example.com' } });
    expect(row).not.toHaveProperty('listenerId');
    expect(JSON.stringify(r.body)).not.toContain('d_aaaa');
    expect(r.body?.counts).toEqual({ new: 1, read: 1, resolved: 1, all: 3 });
  });

  it('reply: explains when nobody can be reached, and sends to the person’s devices when they can', async () => {
    stub((c) => {
      const t = table(c);
      if (t === 'feedback' && c.method === 'GET') return json([{ id: 7, listener_id: null, note: null, status: 'new' }]);
      return undefined;
    });
    let r = await run(feedback.onRequestPost, '/api/admin/feedback', { action: 'reply', id: 7, message: 'Thanks!' });
    expect(r.res.status).toBe(409);
    expect(r.body?.error).toBe('no_account');

    stub((c) => {
      const t = table(c);
      if (t === 'feedback' && c.method === 'GET') return json([{ id: 7, listener_id: 'd_aaaaaaaaaaaaaaaa', note: null, status: 'new' }]);
      if (t === 'listeners') return json([{ id: 'd_aaaaaaaaaaaaaaaa', account_id: '1001' }]);
      if (t === 'accounts' && c.url.searchParams.get('listener_id')) return json([]);
      if (t === 'accounts') return json([{ id: '1001', name: 'Ravi', email: 'r@x.y', picture: null }]);
      if (t === 'push_devices') return json([]);
      return undefined;
    });
    r = await run(feedback.onRequestPost, '/api/admin/feedback', { action: 'reply', id: 7, message: 'Thanks!' });
    expect(r.res.status).toBe(409);
    expect(r.body?.error).toBe('no_device');

    stub((c) => {
      const t = table(c);
      if (t === 'feedback' && c.method === 'GET') return json([{ id: 7, listener_id: 'd_aaaaaaaaaaaaaaaa', note: null, status: 'new' }]);
      if (t === 'listeners') return json([{ id: 'd_aaaaaaaaaaaaaaaa', account_id: '1001' }]);
      if (t === 'accounts' && c.url.searchParams.get('listener_id')) return json([]);
      if (t === 'accounts') return json([{ id: '1001', name: 'Ravi', email: 'r@x.y', picture: null }]);
      if (t === 'push_devices' && c.method === 'GET') return json([{ id: 1, channel: 'web', target: 'https://push.example/1', p256dh: 'k', auth: 'a', account_id: '1001' }]);
      if (t === 'notifications' && c.method === 'POST') return json([{ id: 55 }], 201);
      return undefined;
    });
    r = await run(feedback.onRequestPost, '/api/admin/feedback', { action: 'reply', id: 7, message: 'Thanks!' });
    expect(r.res.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, devices: 1 });
    const made = calls.find((c) => table(c) === 'notifications' && c.method === 'POST')!;
    expect(made.body).toMatchObject({ title: 'Thanks for your feedback', body: 'Thanks!', status: 'sent', created_by: 'owner', audience: { account: '1001', feedback: 7 } });
    const patch = calls.find((c) => table(c) === 'feedback' && c.method === 'PATCH')!;
    expect(patch.body).toMatchObject({ status: 'read' });
    expect(String((patch.body as { note: string }).note)).toContain('Replied by notification');
  });

  it('reply needs a message', async () => {
    stub();
    expect((await run(feedback.onRequestPost, '/api/admin/feedback', { action: 'reply', id: 7, message: '  ' })).res.status).toBe(400);
  });
});

describe('content (blocked songs and albums)', () => {
  it('blocks an album with a known reason and records who blocked it', async () => {
    stub((c) => (table(c) === 'blocked_content' && c.method === 'POST' ? json([{ id: 4, kind: 'album', value: 'al1', label: 'X', reason: 'Wrong audio', blocked_by: 'owner', created_at: 't' }], 201) : undefined));
    const r = await run(content.onRequestPost, '/api/admin/content', { action: 'block', kind: 'album', value: 'al1', label: 'X', reason: 'wrong audio' });
    expect(r.res.status).toBe(200);
    const ins = calls.find((c) => table(c) === 'blocked_content' && c.method === 'POST')!;
    expect(ins.body).toMatchObject({ kind: 'album', value: 'al1', reason: 'Wrong audio', blocked_by: 'owner' });
    expect(r.body?.row).toMatchObject({ blockedBy: 'owner' });
  });

  it('an unknown reason is stored as Other; reason changes only take the four reasons', async () => {
    stub((c) => (table(c) === 'blocked_content' && c.method === 'PATCH' ? json([{ id: 4, kind: 'song', value: 's1', label: 'S', reason: 'Copyright' }]) : undefined));
    await run(content.onRequestPost, '/api/admin/content', { action: 'block', kind: 'song', value: 's1', reason: 'because' });
    expect(calls.find((c) => table(c) === 'blocked_content' && c.method === 'POST')!.body).toMatchObject({ reason: 'Other' });
    expect((await run(content.onRequestPost, '/api/admin/content', { action: 'reason', id: 4, reason: 'Copyright' })).res.status).toBe(200);
    expect((await run(content.onRequestPost, '/api/admin/content', { action: 'reason', id: 4, reason: 'Nope' })).res.status).toBe(400);
  });

  it('lists the reasons with the blocked items', async () => {
    stub((c) => (c.url.pathname.endsWith('/rpc/stats_music') ? json({ songs: [] }) : undefined));
    const r = await run(content.onRequestGet, '/api/admin/content');
    expect(r.body?.reasons).toEqual(['Copyright', 'Wrong audio', 'Offensive', 'Other']);
  });
});

describe('Song Stats views', () => {
  it('rising reads stats_music; unknown views are refused', async () => {
    stub((c) => (c.url.pathname.endsWith('/rpc/stats_music') ? json({ songs: [{ id: 's1', plays: 9, prev_plays: 2 }], rising: [] }) : undefined));
    const r = await run(analytics.onRequestGet, '/api/admin/analytics?view=rising&days=30');
    expect(r.res.status).toBe(200);
    expect(r.body).toMatchObject({ view: 'rising', days: 30 });
    const rpc = calls.find((c) => c.url.pathname.endsWith('/rpc/stats_music'))!;
    expect(rpc.body).toEqual({ p_days: 30, p_limit: 100 });
    expect((await run(analytics.onRequestGet, '/api/admin/analytics?view=nope')).res.status).toBe(400);
  });

  it('an older database answers db_update_needed, not a zero', async () => {
    stub((c) => (c.url.pathname.endsWith('/rpc/stats_funnel') ? json({ code: 'PGRST202', message: 'Could not find the function' }, 404) : undefined));
    const r = await run(analytics.onRequestGet, '/api/admin/analytics?view=funnel');
    expect(r.res.status).toBe(502);
    expect(r.body?.error).toBe('db_update_needed');
  });
});

describe('catalogue search', () => {
  const SONG = { id: 's1', name: 'Naatu Naatu', type: 'song', language: 'telugu', year: '2022', duration: 214, album: { id: 'al9', name: 'RRR' }, artists: { primary: [{ name: 'Rahul' }] }, image: [{ url: 'https://img/50.jpg' }, { url: 'https://img/500.jpg' }], downloadUrl: [{ quality: '12kbps', url: 'https://aac/12.mp4' }, { quality: '48kbps', url: 'https://aac/48.mp4' }] };

  it('songs carry the album, language and a 48 kbps preview', async () => {
    stub(() => undefined, (url) => (url.pathname.endsWith('/search/songs') ? json({ data: { results: [SONG] } }) : undefined));
    const r = await run(catalog.onRequestGet, '/api/admin/catalog-search?q=naatu&type=songs');
    expect(r.res.status).toBe(200);
    expect((r.body?.items as unknown[])[0]).toMatchObject({ id: 's1', title: 'Naatu Naatu', name: 'Naatu Naatu', subtitle: 'Rahul', image: 'https://img/500.jpg', album: { id: 'al9', name: 'RRR' }, language: 'telugu', preview: 'https://aac/48.mp4' });
  });

  it('type=artists searches artists; the old kind=album still works', async () => {
    stub(() => undefined, (url) => json({ data: { results: [{ id: 'a1', name: 'A.R. Rahman', image: [] }] }, url: url.pathname }));
    const a = await run(catalog.onRequestGet, '/api/admin/catalog-search?q=rahman&type=artists');
    expect(a.body?.type).toBe('artists');
    expect(calls.some((c) => c.url.pathname.endsWith('/search/artists'))).toBe(true);
    expect((a.body?.items as Array<{ preview: unknown }>)[0].preview).toBeNull();
    await run(catalog.onRequestGet, '/api/admin/catalog-search?q=rrr&kind=album');
    expect(calls.some((c) => c.url.pathname.endsWith('/search/albums'))).toBe(true);
  });

  it('needs a query', async () => {
    stub();
    expect((await run(catalog.onRequestGet, '/api/admin/catalog-search?type=songs')).res.status).toBe(400);
  });
});
