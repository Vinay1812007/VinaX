/**
 * Admin dashboard repair (customers/users first) — regression tests driving
 * the REAL Pages Functions handlers with a stubbed Supabase REST layer, so
 * the exact PostgREST queries and status codes are asserted, not mocked away.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequestPost as maintenancePost } from '../../worker/functions/api/admin/maintenance';
import { onRequestGet as searchAnalyticsGet } from '../../worker/functions/api/admin/search-analytics';
import { onRequestGet as engagementGet } from '../../worker/functions/api/admin/engagement';
import { onRequestGet as feedbackGet } from '../../worker/functions/api/admin/feedback';
import { onRequestPost as pushPost } from '../../worker/functions/api/admin/push';
import { onRequestPost as contentPost } from '../../worker/functions/api/admin/content';
import { isAdmin } from '../../worker/functions/_lib/admin';

const ENV = {
  ADMIN_LOGIN_PASSWORD: 'test-secret',
  SUPABASE_URL: 'https://sb.test',
  SUPABASE_SERVICE_ROLE_KEY: 'srk',
  VAPID_PUBLIC_KEY: 'pk',
  VAPID_PRIVATE_KEY: 'sk',
  VAPID_SUBJECT: 'mailto:x@y.z',
};

interface Call {
  url: string;
  method: string;
  body: string | null;
}
const calls: Call[] = [];

/** Stub the Supabase REST surface; per-test overrides by URL substring. */
function installFetch(routes: Array<[string, () => Response]> = []): void {
  calls.length = 0;
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? String(init.body) : null });
    for (const [needle, make] of routes) {
      if (url.includes(needle)) return Promise.resolve(make());
    }
    return Promise.resolve(new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }));
  });
}

let ipSeq = 0;
function adminReq(body: unknown, method = 'POST'): Request {
  ipSeq += 1;
  return new Request('https://admin.test/api/admin/x', {
    method,
    headers: {
      'content-type': 'application/json',
      'x-admin-token': 'test-secret',
      'cf-connecting-ip': `10.9.${Math.floor(ipSeq / 250)}.${ipSeq % 250}`,
    },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe('delete_user (customer deletion)', () => {
  it('demands a written reason', async () => {
    installFetch();
    const res = await maintenancePost({ request: adminReq({ action: 'delete_user', device_id: 'dev1', reason: 'x' }), env: ENV });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('reason_required');
    expect(calls).toHaveLength(0); // nothing touched the database
  });

  it('reports an honest 404 for an unknown device instead of a silent success', async () => {
    installFetch([['vinax_users', () => new Response('[]', { status: 200 })]]);
    const res = await maintenancePost({
      request: adminReq({ action: 'delete_user', device_id: 'no-such-device', reason: 'DMCA request' }),
      env: ENV,
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe('not_found');
  });

  it('deletes, cleans room membership, scrubs feedback, and audits without the raw id', async () => {
    installFetch([
      ['vinax_users?device_id', () => new Response(JSON.stringify([{ device_id: 'dev-abcdef123456' }]), { status: 200 })],
    ]);
    const res = await maintenancePost({
      request: adminReq({ action: 'delete_user', device_id: 'dev-abcdef123456', reason: 'user | requested' }),
      env: ENV,
    });
    expect(res.status).toBe(200);
    const urls = calls.map((c) => `${c.method} ${c.url}`);
    expect(urls.some((u) => u.startsWith('DELETE') && u.includes('vinax_events'))).toBe(true);
    expect(urls.some((u) => u.startsWith('DELETE') && u.includes('vinax_room_members'))).toBe(true); // no orphaned membership
    const scrub = calls.find((c) => c.method === 'PATCH' && c.url.includes('vinax_feedback'));
    expect(scrub?.body).toContain('"device_id":"deleted"'); // id scrubbed from filed feedback
    const audit = calls.find((c) => c.method === 'POST' && c.url.includes('vinax_feedback'));
    expect(audit?.body).toContain('"status":"audit"'); // never inflates the New-feedback KPI
    expect(audit?.body).toContain('user / requested'); // pipe stripped — audit kind can't be forged
    expect(audit?.body).not.toContain('dev-abcdef123456'); // only the truncated id is recorded
  });
});

describe('days-clamp hardening (D-5)', () => {
  it.each([
    ['search-analytics', searchAnalyticsGet],
    ['engagement', engagementGet],
  ])('%s answers ?days=abc with 200, not a RangeError 500', async (_name, handler) => {
    installFetch();
    const request = new Request('https://admin.test/api/admin/x?days=abc', {
      headers: { 'x-admin-token': 'test-secret', 'cf-connecting-ip': `10.8.0.${++ipSeq % 250}` },
    });
    const res = await handler({ request, env: ENV });
    expect(res.status).toBe(200);
  });
});

describe('push composer', () => {
  it('dry-run persists NOTHING — no announcement row, no dedupe burn (D-3)', async () => {
    installFetch();
    const res = await pushPost({
      request: adminReq({ title: 'T', body: 'B', link: '/', dryRun: true, dedupe_key: 'k1' }),
      env: ENV,
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { dryRun: boolean }).dryRun).toBe(true);
    expect(calls.some((c) => c.method === 'POST' && c.url.includes('vinax_events'))).toBe(false);
    expect(calls.some((c) => c.method === 'POST' && c.url.includes('vinax_feedback'))).toBe(false);
  });

  it('refuses a blank body and an external link (D-20)', async () => {
    installFetch();
    const blank = await pushPost({ request: adminReq({ title: 'T', body: '   ', link: '/' }), env: ENV });
    expect(blank.status).toBe(400);
    expect(((await blank.json()) as { error: string }).error).toBe('body_required');
    const evil = await pushPost({ request: adminReq({ title: 'T', body: 'B', link: 'https://evil.example/x' }), env: ENV });
    expect(evil.status).toBe(400);
    expect(((await evil.json()) as { error: string }).error).toBe('bad_link');
  });
});

describe('feedback inbox', () => {
  it('excludes admin-audit rows from the customer-feedback list (D-4)', async () => {
    installFetch();
    const request = new Request('https://admin.test/api/admin/feedback', {
      headers: { 'x-admin-token': 'test-secret', 'cf-connecting-ip': `10.8.1.${++ipSeq % 250}` },
    });
    await feedbackGet({ request, env: ENV });
    expect(calls[0]?.url).toContain('type=neq.admin-audit');
  });
});

describe('content blocklist', () => {
  it('unknown action → 400 unknown_action (was a bare {ok:false})', async () => {
    installFetch();
    const res = await contentPost({ request: adminReq({ action: 'explode', songId: 'x1' }), env: ENV });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('unknown_action');
  });

  it('unblock namespaces artist/keyword kinds like block does (D-19)', async () => {
    installFetch();
    await contentPost({ request: adminReq({ action: 'unblock', songId: 'Some Artist', kind: 'artist' }), env: ENV });
    const del = calls.find((c) => c.method === 'DELETE');
    expect(del?.url).toContain(encodeURIComponent('artist:some artist'));
  });
});

describe('admin auth brute-force lockout', () => {
  it('locks a source out after repeated wrong tokens — even a later correct guess fails', () => {
    const mk = (tok: string) =>
      new Request('https://admin.test/api/admin/x', {
        headers: { 'x-admin-token': tok, 'cf-connecting-ip': '198.51.100.7' },
      });
    for (let i = 0; i < 15; i++) expect(isAdmin(mk(`wrong-${i}`), ENV)).toBe(false);
    expect(isAdmin(mk('test-secret'), ENV)).toBe(false); // locked out
    // A different source with the right token is unaffected.
    const other = new Request('https://admin.test/api/admin/x', {
      headers: { 'x-admin-token': 'test-secret', 'cf-connecting-ip': '198.51.100.8' },
    });
    expect(isAdmin(other, ENV)).toBe(true);
  });
});
