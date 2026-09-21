/**
 * 7.2.0 — the admin audit trail: who, what, when, which request, and safe
 * before/after values for configuration changes. Real handlers with a
 * stubbed database REST layer; the row is read back the way
 * /api/admin/audit reads it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REDACTED, auditValue, buildAuditRecord, logAdminAudit, parseAuditMessage, redactSecrets } from '../functions/_lib/adminAudit';
import { onRequestPost as appconfigPost } from '../functions/api/admin/appconfig';
import { onRequestPost as contentPost } from '../functions/api/admin/content';
import { onRequestPost as experimentsPost } from '../functions/api/admin/experiments';
import { onRequestPost as maintenancePost } from '../functions/api/admin/maintenance';
import { onRequestGet as auditGet } from '../functions/api/admin/audit';

const ENV = { ADMIN_LOGIN_PASSWORD: 'test-secret', SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'srk' };

interface Call { url: string; method: string; body: string | null }
const calls: Call[] = [];
function db(rows: Array<[string, unknown]> = []): void {
  calls.length = 0;
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body ? String(init.body) : null });
    // Reads and returning deletes answer from `rows`; writes just succeed.
    if (method === 'GET' || method === 'DELETE') {
      for (const [needle, body] of rows) if (url.includes(needle)) return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
      return Promise.resolve(new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }));
    }
    return Promise.resolve(new Response(null, { status: 201 }));
  });
}
/** The audit row this action wrote, parsed the way the trail reads it. */
function auditRow(): { action: string; record: ReturnType<typeof parseAuditMessage>['record']; row: Record<string, unknown> } | null {
  const write = calls.find((c) => c.method === 'POST' && c.url.includes('vinax_feedback'));
  if (!write) return null;
  const row = JSON.parse(write.body ?? '{}') as Record<string, unknown>;
  const parsed = parseAuditMessage(row.message as string);
  return { action: parsed.action, record: parsed.record, row };
}

let ipSeq = 0;
const adminReq = (path: string, body: unknown, headers: Record<string, string> = {}): Request => {
  ipSeq += 1;
  return new Request(`https://admin.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-token': 'test-secret', 'cf-connecting-ip': `10.50.0.${ipSeq % 250}`, ...headers },
    body: JSON.stringify(body),
  });
};

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe('redactSecrets', () => {
  it('replaces values under secret-looking keys, at any depth', () => {
    expect(redactSecrets({ password: 'hunter2', apiKey: 'abc', nested: { authorization: 'Basic x', accessToken: 'y', auth: 'z' } })).toEqual({
      password: REDACTED,
      apiKey: REDACTED,
      nested: { authorization: REDACTED, accessToken: REDACTED, auth: REDACTED },
    });
  });

  it('keeps ordinary configuration values readable, including token COUNTS', () => {
    expect(redactSecrets({ emergencyOff: true, dailyTokenCap: 2_000_000, maxTokens: 900, features: { dj: false }, title: 'Holi offer' })).toEqual({
      emergencyOff: true,
      dailyTokenCap: 2_000_000,
      maxTokens: 900,
      features: { dj: false },
      title: 'Holi offer',
    });
  });

  it('replaces credential-looking strings wherever they appear', () => {
    const out = redactSecrets({
      note: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghijklmnop',
      header: 'Bearer sk-abcdefghijklmnopqrstuvwxyz0123456789',
      blob: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
      plain: 'a normal sentence about a song',
    }) as Record<string, string>;
    expect(out.note).toBe(REDACTED);
    expect(out.header).toBe(REDACTED);
    expect(out.blob).toBe(REDACTED);
    expect(out.plain).toBe('a normal sentence about a song');
  });

  it('strips secrets out of URLs and shrinks data URLs', () => {
    const out = redactSecrets({
      link: 'https://www.sirimillavinay.online/song/x?token=abc123&utm=home',
      creds: 'https://user:pw@example.test/path',
      image: `data:image/png;base64,${'A'.repeat(500)}`,
    }) as Record<string, string>;
    expect(out.link).toBe(`https://www.sirimillavinay.online/song/x?token=${encodeURIComponent(REDACTED)}&utm=home`);
    expect(out.creds).not.toContain('pw');
    expect(out.image).toBe(`[data url, ${'data:image/png;base64,'.length + 500} chars]`);
  });

  it('clips long strings and bounds wide, deep or circular structures', () => {
    expect(redactSecrets('x'.repeat(400))).toBe(`${'x'.repeat(300)}…(+100 chars)`);
    const wide = redactSecrets(Array.from({ length: 60 }, (_, i) => i)) as unknown[];
    expect(wide).toHaveLength(51);
    expect(wide[50]).toBe('[+10 more]');
    let deep: Record<string, unknown> = { v: 1 };
    for (let i = 0; i < 10; i += 1) deep = { deep };
    expect(JSON.stringify(redactSecrets(deep))).toContain('[nested too deep]');
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(redactSecrets(loop)).toEqual({ self: '[circular]' });
  });

  it('a value too large for a row is reduced to its size and a digest', async () => {
    const big = { banners: Array.from({ length: 40 }, (_, i) => ({ title: `banner ${i}`, body: 'y'.repeat(200) })) };
    const out = (await auditValue(big)) as { omitted: string; chars: number; sha256_64: string };
    expect(out.omitted).toBe('too_large');
    expect(out.chars).toBeGreaterThan(3000);
    expect(out.sha256_64).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(out)).not.toContain('yyyy');
  });
});

describe('the audit record', () => {
  it('carries actor, action, ISO timestamp and the edge request id', async () => {
    const request = new Request('https://admin.test/x', { headers: { 'cf-ray': '8f2a1b3c4d5e6f70-BOM' } });
    const rec = await buildAuditRecord({ env: ENV, request }, { action: 'config', summary: 'updated flags' }, new Date('2026-09-19T12:00:00Z'));
    expect(rec).toMatchObject({ v: 2, actor: { id: 'owner', via: 'shared-token' }, action: 'config', at: '2026-09-19T12:00:00.000Z', requestId: '8f2a1b3c4d5e6f70-BOM', summary: 'updated flags' });
  });

  it('falls back to a random request id when the edge sent none', async () => {
    const rec = await buildAuditRecord({ env: ENV }, { action: 'config', summary: 's' });
    expect(rec.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('an action can never be forged out of free text', async () => {
    const rec = await buildAuditRecord({ env: ENV }, { action: 'blocklist-block|fake', summary: 'x' });
    expect(rec.action).toBe('blocklist-block/fake');
    expect(parseAuditMessage(`${rec.action}|${JSON.stringify(rec)}`).action).toBe('blocklist-block/fake');
  });

  it('survives the response through waitUntil, and is awaited when there is none', async () => {
    db();
    const pending: Array<Promise<unknown>> = [];
    await logAdminAudit({ env: ENV, waitUntil: (p) => pending.push(p) }, { action: 'config', summary: 'x' });
    expect(pending).toHaveLength(1);
    await Promise.all(pending);
    expect(auditRow()?.action).toBe('config');
    db();
    await logAdminAudit({ env: ENV }, { action: 'config', summary: 'y' });
    expect(auditRow()?.action).toBe('config');
  });

  it('a failed audit write never fails the action it describes', async () => {
    calls.length = 0;
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('{"message":"boom"}', { status: 500 })));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(logAdminAudit({ env: ENV }, { action: 'config', summary: 'x' })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('older rows still read: "kind|text" and the pre-E12 shape', () => {
    expect(parseAuditMessage('config|updated flags (12 bytes)')).toMatchObject({ action: 'config', text: 'updated flags (12 bytes)', record: null });
    expect(parseAuditMessage('Deleted user dev-abc…: spam')).toMatchObject({ action: 'user-delete', record: null });
  });
});

describe('configuration changes record before and after', () => {
  it('app config: the stored value before the publish and the value after', async () => {
    db([['vinax_config', [{ value: { aiDj: true, secretKey: 'should-not-appear' } }]]]);
    const res = await appconfigPost({ request: adminReq('/api/admin/appconfig', { key: 'flags', value: { aiDj: false } }), env: ENV });
    expect(res.status).toBe(200);
    const rec = auditRow()?.record;
    expect(rec).toMatchObject({ action: 'config', target: 'flags', before: { aiDj: true, secretKey: REDACTED }, after: { aiDj: false } });
  });

  it('app config: a failed read of the previous value is recorded as unavailable, not as "nothing was there"', async () => {
    calls.length = 0;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body ? String(init.body) : null });
      if (method === 'GET') return Promise.resolve(new Response('{"message":"boom"}', { status: 500 }));
      return Promise.resolve(new Response(null, { status: 201 }));
    });
    await appconfigPost({ request: adminReq('/api/admin/appconfig', { key: 'flags', value: { aiDj: false } }), env: ENV });
    expect(auditRow()?.record?.before).toEqual({ unavailable: 'db_unavailable' });
  });

  it('content control: the blocklist entry before and after', async () => {
    db([['vinax_blocklist', [{ song_id: 's1', song_title: 'Orbit', reason: 'old reason' }]]]);
    await contentPost({ request: adminReq('/api/admin/content', { action: 'block', songId: 's1', songTitle: 'Orbit', reason: 'explicit' }), env: ENV });
    expect(auditRow()?.record).toMatchObject({
      action: 'blocklist-block',
      target: 's1',
      before: { song_id: 's1', song_title: 'Orbit', reason: 'old reason' },
      after: { song_id: 's1', song_title: 'Orbit', reason: 'explicit' },
    });
    db([['vinax_blocklist', [{ song_id: 's1', song_title: 'Orbit', reason: 'explicit' }]]]);
    await contentPost({ request: adminReq('/api/admin/content', { action: 'unblock', songId: 's1' }), env: ENV });
    expect(auditRow()?.record).toMatchObject({ action: 'blocklist-unblock', before: { song_id: 's1' }, after: null });
  });

  it('experiments: save, toggle and delete each carry the previous definition', async () => {
    const stored = [{ key: 'e1', name: 'Old name', variants: [{ name: 'a', pct: 50 }, { name: 'b', pct: 50 }], active: false }];
    db([['vinax_experiments', stored]]);
    await experimentsPost({ request: adminReq('/api/admin/experiments', { action: 'save', key: 'e1', name: 'New name', active: true, variants: [{ name: 'a', pct: 30 }, { name: 'b', pct: 70 }] }), env: ENV });
    expect(auditRow()?.record).toMatchObject({ action: 'experiment-save', target: 'e1', before: { name: 'Old name', active: false }, after: { name: 'New name', active: true } });
    db([['vinax_experiments', stored]]);
    await experimentsPost({ request: adminReq('/api/admin/experiments', { action: 'toggle', key: 'e1', active: true }), env: ENV });
    expect(auditRow()?.record).toMatchObject({ action: 'experiment-toggle', before: { active: false }, after: { active: true } });
    db([['vinax_experiments', stored]]);
    await experimentsPost({ request: adminReq('/api/admin/experiments', { action: 'delete', key: 'e1' }), env: ENV });
    expect(auditRow()?.record).toMatchObject({ action: 'experiment-delete', before: { name: 'Old name' }, after: null });
  });

  it('site mode: the mode in force before the switch and the one after', async () => {
    db([['type=eq.site-mode', [{ message: 'live|' }]]]);
    await maintenancePost({ request: adminReq('/api/admin/maintenance', { action: 'site_mode', mode: 'maintenance', note: 'Back in 20 minutes' }), env: ENV });
    expect(auditRow()?.record).toMatchObject({ action: 'site-mode-change', before: { mode: 'live', note: '' }, after: { mode: 'maintenance', note: 'Back in 20 minutes' } });
  });

  it('a deletion records the action without the raw identifier', async () => {
    db([['vinax_users', [{ device_id: 'dev-abcdef123456' }]]]);
    await maintenancePost({ request: adminReq('/api/admin/maintenance', { action: 'delete_user', device_id: 'dev-abcdef123456', reason: 'listener request' }), env: ENV });
    const row = auditRow();
    expect(row?.record).toMatchObject({ action: 'user-delete' });
    expect(JSON.stringify(row?.row)).not.toContain('dev-abcdef123456');
    expect(row?.row.status).toBe('audit'); // outside the feedback KPI and inbox
    expect(row?.row.name).toBe('owner'); // the actor, queryable
  });
});

describe('/api/admin/audit reads both record versions', () => {
  it('shows actor, request id and the change for a 7.2 row, and still renders an older one', async () => {
    const rec = await buildAuditRecord(
      { env: ENV, request: new Request('https://admin.test/x', { headers: { 'cf-ray': '8f2a1b3c4d5e6f70-BOM' } }) },
      { action: 'config', summary: 'updated flags (12 bytes)', target: 'flags', before: { aiDj: true }, after: { aiDj: false } },
      new Date('2026-09-19T12:00:00Z'),
    );
    db([
      ['vinax_feedback', [
        { message: `${rec.action}|${JSON.stringify(rec)}`, created_at: '2026-09-19T12:00:01Z' },
        { message: 'blocklist-block|s1 — explicit', created_at: '2026-09-18T09:00:00Z' },
      ]],
    ]);
    const res = await auditGet({ request: new Request('https://admin.test/api/admin/audit', { headers: { 'x-admin-token': 'test-secret', 'cf-connecting-ip': '10.51.0.1' } }), env: ENV });
    const items = ((await res.json()) as { items: Array<Record<string, unknown>> }).items;
    expect(items[0]).toMatchObject({
      kind: 'config',
      text: 'updated flags (12 bytes)',
      at: '2026-09-19T12:00:00.000Z',
      actor: 'owner',
      actorVia: 'shared-token',
      requestId: '8f2a1b3c4d5e6f70-BOM',
      target: 'flags',
      before: { aiDj: true },
      after: { aiDj: false },
    });
    expect(items[1]).toEqual({ kind: 'blocklist-block', text: 's1 — explicit', at: '2026-09-18T09:00:00Z' });
  });
});
