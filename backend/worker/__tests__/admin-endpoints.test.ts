/**
 * Admin dashboard repair (customers/users first) — regression tests driving
 * the REAL handlers against a real (in-memory) SQLite database through the
 * D1 layer, so actual database effects are asserted, not transport calls.
 */
import { describe, expect, it } from 'vitest';
import { onRequestPost as maintenancePost } from '../functions/api/admin/maintenance';
import { onRequestGet as searchAnalyticsGet } from '../functions/api/admin/search-analytics';
import { onRequestGet as engagementGet } from '../functions/api/admin/engagement';
import { onRequestGet as feedbackGet } from '../functions/api/admin/feedback';
import { onRequestPost as pushPost } from '../functions/api/admin/push';
import { onRequestPost as contentPost } from '../functions/api/admin/content';
import { isAdmin } from '../functions/_lib/admin';
import { fakeD1Ready, seed, tableRows, type FakeD1 } from './fake-d1';

const BASE_ENV = {
  ADMIN_LOGIN_PASSWORD: 'test-secret',
  VAPID_PUBLIC_KEY: 'pk',
  VAPID_PRIVATE_KEY: 'sk',
  VAPID_SUBJECT: 'mailto:x@y.z',
};
const envWith = (db: FakeD1) => ({ ...BASE_ENV, DB: db });

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

describe('delete_user (customer deletion)', () => {
  it('demands a written reason', async () => {
    const db = await fakeD1Ready();
    seed(db, 'vinax_users', [{ device_id: 'dev1' }]);
    const res = await maintenancePost({ request: adminReq({ action: 'delete_user', device_id: 'dev1', reason: 'x' }), env: envWith(db) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('reason_required');
    expect(tableRows(db, 'vinax_users')).toHaveLength(1); // nothing deleted
  });

  it('reports an honest 404 for an unknown device instead of a silent success', async () => {
    const db = await fakeD1Ready();
    const res = await maintenancePost({
      request: adminReq({ action: 'delete_user', device_id: 'no-such-device', reason: 'DMCA request' }),
      env: envWith(db),
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe('not_found');
  });

  it('deletes, cleans room membership, scrubs feedback, and audits without the raw id', async () => {
    const db = await fakeD1Ready();
    const id = 'dev-abcdef123456';
    seed(db, 'vinax_users', [{ device_id: id, name: 'X' }]);
    seed(db, 'vinax_events', [
      { device_id: id, type: 'play' },
      { device_id: id, type: 'error' },
      { device_id: 'other-device', type: 'play' },
    ]);
    seed(db, 'vinax_room_members', [{ code: 'ROOM01', device_id: id }]);
    seed(db, 'vinax_feedback', [{ device_id: id, type: 'bug', message: 'app crashed' }]);
    const res = await maintenancePost({
      request: adminReq({ action: 'delete_user', device_id: id, reason: 'user | requested' }),
      env: envWith(db),
    });
    expect(res.status).toBe(200);
    expect(tableRows(db, 'vinax_users')).toHaveLength(0);
    // Only the deleted device's events are gone; others survive.
    const events = tableRows(db, 'vinax_events');
    expect(events).toHaveLength(1);
    expect(events[0].device_id).toBe('other-device');
    expect(tableRows(db, 'vinax_room_members')).toHaveLength(0); // no orphaned membership
    const feedback = tableRows(db, 'vinax_feedback');
    const scrubbed = feedback.find((f) => f.message === 'app crashed');
    expect(scrubbed?.device_id).toBe('deleted'); // id scrubbed from filed feedback
    const audit = feedback.find((f) => f.type === 'admin-audit');
    expect(audit?.status).toBe('audit'); // never inflates the New-feedback KPI
    expect(String(audit?.message)).toContain('user / requested'); // pipe stripped
    expect(String(audit?.message)).not.toContain(id); // only the truncated id is recorded
  });
});

describe('days-clamp hardening (D-5)', () => {
  it.each([
    ['search-analytics', searchAnalyticsGet],
    ['engagement', engagementGet],
  ])('%s answers ?days=abc with 200, not a RangeError 500', async (_name, handler) => {
    const db = await fakeD1Ready();
    const request = new Request('https://admin.test/api/admin/x?days=abc', {
      headers: { 'x-admin-token': 'test-secret', 'cf-connecting-ip': `10.8.0.${++ipSeq % 250}` },
    });
    const res = await handler({ request, env: envWith(db) });
    expect(res.status).toBe(200);
  });
});

describe('push composer', () => {
  it('dry-run persists NOTHING — no announcement row, no dedupe burn (D-3)', async () => {
    const db = await fakeD1Ready();
    const res = await pushPost({
      request: adminReq({ title: 'T', body: 'B', link: '/', dryRun: true, dedupe_key: 'k1' }),
      env: envWith(db),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { dryRun: boolean }).dryRun).toBe(true);
    expect(tableRows(db, 'vinax_events')).toHaveLength(0);
    expect(tableRows(db, 'vinax_feedback')).toHaveLength(0);
  });

  it('refuses a blank body and an external link (D-20)', async () => {
    const db = await fakeD1Ready();
    const blank = await pushPost({ request: adminReq({ title: 'T', body: '   ', link: '/' }), env: envWith(db) });
    expect(blank.status).toBe(400);
    expect(((await blank.json()) as { error: string }).error).toBe('body_required');
    const evil = await pushPost({ request: adminReq({ title: 'T', body: 'B', link: 'https://evil.example/x' }), env: envWith(db) });
    expect(evil.status).toBe(400);
    expect(((await evil.json()) as { error: string }).error).toBe('bad_link');
  });
});

describe('feedback inbox', () => {
  it('excludes admin-audit rows from the customer-feedback list (D-4)', async () => {
    const db = await fakeD1Ready();
    seed(db, 'vinax_feedback', [
      { device_id: 'd1', type: 'bug', message: 'real feedback', created_at: '2026-08-20T00:00:00.000Z' },
      { device_id: 'admin', type: 'admin-audit', message: 'delete-user|x', status: 'audit', created_at: '2026-08-21T00:00:00.000Z' },
    ]);
    const request = new Request('https://admin.test/api/admin/feedback', {
      headers: { 'x-admin-token': 'test-secret', 'cf-connecting-ip': `10.8.1.${++ipSeq % 250}` },
    });
    const res = await feedbackGet({ request, env: envWith(db) });
    const body = (await res.json()) as { feedback: { type: string; message: string }[] };
    expect(body.feedback).toHaveLength(1);
    expect(body.feedback[0].message).toBe('real feedback');
  });
});

describe('content blocklist', () => {
  it('unknown action → 400 unknown_action (was a bare {ok:false})', async () => {
    const db = await fakeD1Ready();
    const res = await contentPost({ request: adminReq({ action: 'explode', songId: 'x1' }), env: envWith(db) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('unknown_action');
  });

  it('unblock namespaces artist/keyword kinds like block does (D-19)', async () => {
    const db = await fakeD1Ready();
    seed(db, 'vinax_blocklist', [{ song_id: 'artist:some artist', song_title: 'Some Artist' }]);
    await contentPost({ request: adminReq({ action: 'unblock', songId: 'Some Artist', kind: 'artist' }), env: envWith(db) });
    expect(tableRows(db, 'vinax_blocklist')).toHaveLength(0); // namespaced id matched + removed
  });
});

describe('admin auth brute-force lockout', () => {
  it('locks a source out after repeated wrong tokens — even a later correct guess fails', () => {
    const mk = (tok: string) =>
      new Request('https://admin.test/api/admin/x', {
        headers: { 'x-admin-token': tok, 'cf-connecting-ip': '198.51.100.7' },
      });
    for (let i = 0; i < 15; i++) expect(isAdmin(mk(`wrong-${i}`), BASE_ENV)).toBe(false);
    expect(isAdmin(mk('test-secret'), BASE_ENV)).toBe(false); // locked out
    // A different source with the right token is unaffected.
    const other = new Request('https://admin.test/api/admin/x', {
      headers: { 'x-admin-token': 'test-secret', 'cf-connecting-ip': '198.51.100.8' },
    });
    expect(isAdmin(other, BASE_ENV)).toBe(true);
  });
});
