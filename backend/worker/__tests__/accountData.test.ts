/**
 * 13.0 — /api/account/data: the synced copy needs a session, a first write
 * creates version 1, a later write must name the stored version, and a stale
 * write gets the newer copy back (409) to merge. No network.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { issueSession } from '../functions/_lib/googleAuth';

const ENV = { GOOGLE_CLIENT_ID: 'x.apps.googleusercontent.com', AUTH_SECRET: 'auth-secret', SUPABASE_URL: 'https://db.example.test', SUPABASE_SERVICE_ROLE_KEY: 'svc' };
const BACKUP = { format: 'vinax-backup', schemaVersion: 2, categories: { library: { 'vinax.library.v1': { state: {} } } } };

interface Db { row: { version: number; updated_at: string; backup: unknown } | null }
function stub(db: Db): Array<{ url: string; method: string; body: Record<string, unknown> | null }> {
  const calls: Array<{ url: string; method: string; body: Record<string, unknown> | null }> = [];
  vi.stubGlobal('fetch', vi.fn(async (u: unknown, init?: RequestInit) => {
    const url = String(u);
    const method = init?.method ?? 'GET';
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ url, method, body });
    if (method === 'GET') return new Response(JSON.stringify(db.row ? [db.row] : []), { status: 200 });
    if (method === 'POST') {
      if (db.row) return new Response('[]', { status: 201 });
      db.row = { version: 1, updated_at: String(body?.updated_at), backup: body?.backup };
      return new Response(JSON.stringify([db.row]), { status: 201 });
    }
    if (method === 'PATCH') {
      const want = Number(/version=eq\.(\d+)/.exec(url)?.[1]);
      if (!db.row || db.row.version !== want) return new Response('[]', { status: 200 });
      db.row = { version: Number(body?.version), updated_at: String(body?.updated_at), backup: body?.backup };
      return new Response(JSON.stringify([{ version: db.row.version, updated_at: db.row.updated_at }]), { status: 200 });
    }
    return new Response(null, { status: 204 });
  }));
  return calls;
}
const req = async (method: string, body?: unknown, session?: string | null): Promise<Request> =>
  new Request('https://example.test/api/account/data', {
    method,
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '10.66.0.1', ...(session === null ? {} : { authorization: `Bearer ${session ?? (await issueSession(ENV, '1001'))}` }) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

afterEach(() => vi.unstubAllGlobals());

describe('/api/account/data', () => {
  it('needs a session', async () => {
    const m = await import('../functions/api/account/data');
    stub({ row: null });
    expect((await m.onRequestGet({ request: await req('GET', undefined, null), env: ENV })).status).toBe(401);
    expect((await m.onRequestPut({ request: await req('PUT', { version: 0, backup: BACKUP }, 'vx1.forged.sig'), env: ENV })).status).toBe(401);
  });

  it('nothing stored is 204; the first write is version 1; reading returns it', async () => {
    const m = await import('../functions/api/account/data');
    const db: Db = { row: null };
    stub(db);
    expect((await m.onRequestGet({ request: await req('GET'), env: ENV })).status).toBe(204);
    const put = await m.onRequestPut({ request: await req('PUT', { version: 0, backup: BACKUP }), env: ENV });
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ version: 1 });
    const got = await m.onRequestGet({ request: await req('GET'), env: ENV });
    expect(await got.json()).toMatchObject({ version: 1, backup: BACKUP });
  });

  it('a write naming the stored version lands; a stale one gets the newer copy back (409)', async () => {
    const m = await import('../functions/api/account/data');
    const db: Db = { row: { version: 3, updated_at: '2026-10-13T00:00:00Z', backup: BACKUP } };
    const calls = stub(db);
    const ok = await m.onRequestPut({ request: await req('PUT', { version: 3, backup: { ...BACKUP, n: 1 } }), env: ENV });
    expect(await ok.json()).toMatchObject({ version: 4 });
    expect(calls.find((c) => c.method === 'PATCH')?.url).toContain('google_sub=eq.1001&version=eq.3');
    const stale = await m.onRequestPut({ request: await req('PUT', { version: 3, backup: BACKUP }), env: ENV });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ version: 4, backup: { ...BACKUP, n: 1 } });
    // A second device's first write when a copy already exists is a conflict too.
    const late = await m.onRequestPut({ request: await req('PUT', { version: 0, backup: BACKUP }), env: ENV });
    expect(late.status).toBe(409);
  });

  it('refuses anything but a backup file, and more than 2 MB', async () => {
    const m = await import('../functions/api/account/data');
    stub({ row: null });
    expect((await m.onRequestPut({ request: await req('PUT', { version: 0, backup: { format: 'other' } }), env: ENV })).status).toBe(400);
    expect((await m.onRequestPut({ request: await req('PUT', { version: -1, backup: BACKUP }), env: ENV })).status).toBe(400);
    const big = { ...BACKUP, pad: 'x'.repeat(m.MAX_BYTES) };
    expect((await m.onRequestPut({ request: await req('PUT', { version: 0, backup: big }), env: ENV })).status).toBe(413);
  });
});
