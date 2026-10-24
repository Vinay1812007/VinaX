/** 14.0 — published settings (vocabulary, memo, history) and the audit trail's redaction. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAuditRow, audit, redactSecrets } from '../functions/_lib/audit';
import { SETTING_KEYS, isSettingKey, readSettings, resetSettingsMemo, setting, settingsMap, writeSetting } from '../functions/_lib/settings';

const ENV = { SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'k' };
interface Call { url: string; method: string; body: unknown }
function stub(answer: (c: Call) => Response): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (u: unknown, init?: RequestInit) => {
    const c = { url: String(u), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null };
    calls.push(c);
    return answer(c);
  }));
  return calls;
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
beforeEach(() => resetSettingsMemo());
afterEach(() => vi.unstubAllGlobals());

describe('settings', () => {
  it('has a closed vocabulary with unique keys', () => {
    const keys = SETTING_KEYS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(isSettingKey('banners')).toBe(true);
    expect(isSettingKey('drop-table')).toBe(false);
  });

  it('reads once a minute and answers a map, a value, and nothing without a database', async () => {
    const calls = stub(() => json([{ key: 'greeting', value: { text: 'hi' }, updated_at: 'now', updated_by: 'owner' }]));
    expect((await settingsMap(ENV)).values).toEqual({ greeting: { text: 'hi' } });
    expect(await setting(ENV, 'greeting')).toEqual({ text: 'hi' });
    expect(await setting(ENV, 'flags')).toBeNull();
    expect(calls.length).toBe(1);
    const r = await readSettings({});
    expect(!r.ok && r.error).toBe('not_configured');
    expect((await settingsMap({})).values).toEqual({});
  });

  it('a failed read is reported, never an empty table', async () => {
    stub(() => json({ message: 'down' }, 503));
    const m = await settingsMap(ENV);
    expect(m.ok).toBe(false);
  });

  it('writes a known key with history, clears with null, refuses unknown and oversized values', async () => {
    const calls = stub((c) => (c.method === 'DELETE' ? json([{ key: 'greeting' }]) : c.url.includes('settings_history') ? new Response(null, { status: 201 }) : json([{ key: 'greeting', value: { text: 'yo' }, updated_at: 'now', updated_by: 'owner' }])));
    const w = await writeSetting(ENV, 'greeting', { text: 'yo' });
    expect(w.ok && w.row?.value).toEqual({ text: 'yo' });
    expect(calls[0].url).toContain('settings?on_conflict=key');
    expect(calls[1].url).toContain('settings_history');
    expect(calls[1].body).toMatchObject({ key: 'greeting', value: { text: 'yo' } });
    const c = await writeSetting(ENV, 'greeting', null);
    expect(c.ok && c.row).toBeNull();
    expect(calls[2].method).toBe('DELETE');
    expect(await writeSetting(ENV, 'nope', 1)).toMatchObject({ ok: false, error: 'unknown_key' });
    expect(await writeSetting(ENV, 'support-faq', 'x'.repeat(70_000))).toMatchObject({ ok: false, error: 'too_large' });
  });
});

describe('audit', () => {
  it('redacts secret-looking keys and values, clips long strings, bounds depth', () => {
    const out = redactSecrets({
      password: 'hunter2', apiKey: 'abc', token: 'x', maxTokens: 400, url: 'https://h.example/p?key=SECRET&q=1',
      jwt: 'eyJabcdef.eyJabcdef.sigsigsig', opaque: 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8', long: 'y'.repeat(400),
      nested: { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } },
    }) as Record<string, unknown>;
    expect(out.password).toBe('[redacted]');
    expect(out.apiKey).toBe('[redacted]');
    expect(out.token).toBe('[redacted]');
    expect(out.maxTokens).toBe(400);
    expect(out.url).toBe('https://h.example/p?key=%5Bredacted%5D&q=1');
    expect(out.jwt).toBe('[redacted]');
    expect(out.opaque).toBe('[redacted]');
    expect(String(out.long)).toMatch(/…\(\+100 chars\)$/);
    expect(JSON.stringify(out.nested)).toContain('nested too deep');
  });

  it('builds a bounded row and writes it best-effort', async () => {
    const calls = stub(() => new Response(null, { status: 201 }));
    const row = await buildAuditRow({ env: ENV, request: new Request('https://admin.test/x', { headers: { 'cf-ray': 'ray-123' } }) }, { action: 'settings/write!', summary: '  changed   greeting ', target: 'greeting', before: null, after: { text: 'yo' } });
    expect(row).toMatchObject({ actor: 'owner', action: 'settings/write-', summary: 'changed greeting', target: 'greeting', after: { text: 'yo' }, request_id: 'ray-123' });
    await audit({ env: ENV }, { action: 'x', summary: 'y' });
    expect(calls[0].url).toBe('https://db.example/rest/v1/audit_log');
    await expect(audit({ env: {} }, { action: 'x', summary: 'y' })).resolves.toBeUndefined();
  });
});
