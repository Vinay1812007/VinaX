/**
 * /api/account/data — the signed-in listener's synced copy in
 * `account_backups`: needs a session; 204 before the first write; versions
 * climb by one; a stale version is a 409 carrying the newer copy; oversized
 * bodies are 413; without a database everything is 503 unavailable.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { issueSession } from '../functions/_lib/googleAuth';
import { onRequestGet, onRequestPut } from '../functions/api/account/data';
import { DB_ENV, fakeDb } from './helpers/fakeDb';

const AUTH = { GOOGLE_CLIENT_ID: 'x.apps.googleusercontent.com', AUTH_SECRET: 'auth-secret' };
const ENV = { ...AUTH, ...DB_ENV };
const BACKUP = { format: 'vinax-backup', schemaVersion: 2, categories: { library: { 'vinax.library.v1': { state: {} } } } };

let ip = 0;
const req = async (method: string, body?: unknown, session?: string | null, env: { AUTH_SECRET: string } = ENV): Promise<Request> =>
  new Request('https://example.test/api/account/data', {
    method,
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': `10.66.0.${++ip % 250}`, ...(session === null ? {} : { authorization: `Bearer ${session ?? (await issueSession(env, '1001'))}` }) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

afterEach(() => vi.unstubAllGlobals());

describe('/api/account/data', () => {
  it('needs a session', async () => {
    fakeDb();
    expect((await onRequestGet({ request: await req('GET', undefined, null), env: ENV })).status).toBe(401);
    expect((await onRequestPut({ request: await req('PUT', { version: 0, backup: BACKUP }, 'vx1.forged.sig'), env: ENV })).status).toBe(401);
  });

  it('without a database reading and writing are unavailable and nothing is sent anywhere', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const get = await onRequestGet({ request: await req('GET', undefined, undefined, AUTH), env: AUTH });
    expect(get.status).toBe(503);
    expect(await get.json()).toEqual({ error: 'unavailable' });
    expect((await onRequestPut({ request: await req('PUT', { version: 0, backup: BACKUP }, undefined, AUTH), env: AUTH })).status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('204 before the first copy, then the copy comes back with its version', async () => {
    const fake = fakeDb();
    expect((await onRequestGet({ request: await req('GET'), env: ENV })).status).toBe(204);
    const put = await onRequestPut({ request: await req('PUT', { version: 0, backup: BACKUP }), env: ENV });
    expect(put.status).toBe(200);
    expect(((await put.json()) as { version: number }).version).toBe(1);
    const row = fake.rows('account_backups')[0];
    expect(row).toMatchObject({ account_id: '1001', version: 1, payload: BACKUP });
    expect(row.bytes).toBe(JSON.stringify(BACKUP).length);
    const get = await onRequestGet({ request: await req('GET'), env: ENV });
    expect(get.status).toBe(200);
    expect(await get.json()).toMatchObject({ version: 1, backup: BACKUP });
  });

  it('a write naming the stored version advances it; a stale one is 409 with the newer copy', async () => {
    const newer = { ...BACKUP, categories: { library: { newer: true } } };
    fakeDb({ account_backups: [{ account_id: '1001', payload: newer, version: 3, bytes: 10, updated_at: '2026-10-24T09:00:00Z' }] });
    const ok = await onRequestPut({ request: await req('PUT', { version: 3, backup: BACKUP }), env: ENV });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { version: number }).version).toBe(4);
    const stale = await onRequestPut({ request: await req('PUT', { version: 2, backup: BACKUP }), env: ENV });
    expect(stale.status).toBe(409);
    const body = (await stale.json()) as { version: number; backup: unknown };
    expect(body.version).toBe(4);
    expect(body.backup).toEqual(BACKUP);
  });

  it('refuses a body that is not a backup, and one that is too large', async () => {
    fakeDb();
    expect((await onRequestPut({ request: await req('PUT', { version: 0, backup: { format: 'other' } }), env: ENV })).status).toBe(400);
    expect((await onRequestPut({ request: await req('PUT', { version: -1, backup: BACKUP }), env: ENV })).status).toBe(400);
    const huge = { ...BACKUP, blob: 'x'.repeat(2_100_000) };
    expect((await onRequestPut({ request: await req('PUT', { version: 0, backup: huge }), env: ENV })).status).toBe(413);
  });
});
