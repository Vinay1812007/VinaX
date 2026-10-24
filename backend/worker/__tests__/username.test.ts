/**
 * /api/username — handles on the `listeners` row: a probe says whether a
 * handle is free, a claim writes it to the caller's own row, a handle held by
 * another device is taken (with free suggestions), and without a database the
 * answers say `unchecked`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestGet, onRequestOptions, onRequestPost } from '../functions/api/username';
import { idFromInstall, signId } from '../functions/_lib/identity';
import { DB_ENV, fakeDb } from './helpers/fakeDb';

const SECRET = 'device-secret-for-tests';
const ENV = { ...DB_ENV, DEVICE_ID_SECRET: SECRET };
const OWNER = 'd_' + 'ab'.repeat(16);

afterEach(() => vi.unstubAllGlobals());

let ip = 0;
const get = (u: string, env: object = ENV) => onRequestGet({ request: new Request(`https://x.test/api/username?u=${encodeURIComponent(u)}`, { headers: { 'cf-connecting-ip': `10.44.0.${++ip % 250}` } }), env });
const post = (body: unknown, env: object = ENV) =>
  onRequestPost({ request: new Request('https://x.test/api/username', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': `10.44.1.${++ip % 250}` }, body: JSON.stringify(body) }), env });

describe('/api/username without a database', () => {
  it('answers the unchecked shapes and touches nothing remote', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await (await onRequestGet()).json()).toEqual({ available: true, unchecked: true });
    expect(await (await onRequestPost()).json()).toEqual({ ok: true, unchecked: true });
    expect(await (await get('vinay', { DEVICE_ID_SECRET: SECRET })).json()).toEqual({ available: true, unchecked: true });
    expect((await onRequestOptions()).status).toBe(204);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('/api/username', () => {
  it('a probe says free or taken (case-insensitively) and refuses a bad handle', async () => {
    fakeDb({ listeners: [{ id: 'd_a', handle: 'vinay' }] });
    expect(await (await get('VINAY')).json()).toEqual({ available: false });
    expect(await (await get('someone_else')).json()).toEqual({ available: true });
    const bad = await get('no spaces!');
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ available: false, error: 'invalid' });
  });

  it('a first claim writes the handle to the derived row and hands back a signed id; the same device may rename', async () => {
    const fake = fakeDb();
    const first = await post({ username: 'Vinay_01', name: 'Vinay', deviceId: 'install-uuid-0001' });
    expect(first.status).toBe(200);
    const out = (await first.json()) as { ok: boolean; username: string; signed_device_id_next: string };
    expect(out.ok).toBe(true);
    expect(out.username).toBe('vinay_01');
    const expectedId = await idFromInstall(SECRET, 'install-uuid-0001');
    expect(out.signed_device_id_next.startsWith(`${expectedId}.`)).toBe(true);
    expect(fake.rows('listeners')[0]).toMatchObject({ id: expectedId, handle: 'vinay_01', display_name: 'Vinay' });
    // Renaming with the signed id: same row, new handle, no new token.
    const renamed = await post({ username: 'vinay_02', signed_device_id: out.signed_device_id_next, current_username: 'vinay_01' });
    const r2 = (await renamed.json()) as Record<string, unknown>;
    expect(r2).toEqual({ ok: true, username: 'vinay_02' });
    expect(fake.rows('listeners')).toHaveLength(1);
    expect(fake.rows('listeners')[0].handle).toBe('vinay_02');
  });

  it('a handle another device holds is taken, with free suggestions; only a PROVED owner may re-claim it', async () => {
    const signed = await signId(SECRET, OWNER);
    fakeDb({ listeners: [{ id: OWNER, handle: 'vinay' }] });
    const taken = await post({ username: 'vinay', deviceId: 'install-uuid-0002' });
    expect(taken.status).toBe(409);
    const body = (await taken.json()) as { error: string; suggestions: string[] };
    expect(body.error).toBe('taken');
    expect(body.suggestions.length).toBeGreaterThan(0);
    expect(body.suggestions.every((s) => /^vinay_\d{4}$/.test(s))).toBe(true);
    // The owner, proving itself, keeps it.
    expect(await (await post({ username: 'vinay', signed_device_id: signed })).json()).toEqual({ ok: true, username: 'vinay' });
    // A forged token is just an unverified claimer: still taken.
    expect((await post({ username: 'vinay', signed_device_id: OWNER + '.forged' })).status).toBe(409);
  });

  it('a race the unique index refuses reads as taken', async () => {
    const fake = fakeDb();
    fake.answer('listeners', (c) => c.method === 'POST'
      ? new Response(JSON.stringify({ code: '23505', message: 'duplicate key' }), { status: 409, headers: { 'content-type': 'application/json' } })
      : new Response('[]', { headers: { 'content-type': 'application/json' } }));
    const res = await post({ username: 'racer', deviceId: 'install-uuid-0003' });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe('taken');
  });
});
