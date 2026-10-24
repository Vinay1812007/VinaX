/** 14.0 — device identity: signed ids, install-derived ids, fresh ids. */
import { describe, expect, it } from 'vitest';
import { idFromInstall, mintIdentity, resolveIdentity, signId, verifySignedId, verifiedIdentity } from '../functions/_lib/identity';

const ENV = { DEVICE_ID_SECRET: 'device-secret-for-tests' };

describe('identity', () => {
  it('a signed id round-trips; a changed one, another secret or junk does not', async () => {
    const token = await signId(ENV.DEVICE_ID_SECRET, 'd_0123456789abcdef0123456789abcdef');
    expect(await verifySignedId(ENV.DEVICE_ID_SECRET, token)).toBe('d_0123456789abcdef0123456789abcdef');
    expect(await verifySignedId(ENV.DEVICE_ID_SECRET, token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A'))).toBeNull();
    expect(await verifySignedId('other', token)).toBeNull();
    for (const junk of ['', 'x', 'd_abc', 42, null, 'a'.repeat(300)]) expect(await verifySignedId(ENV.DEVICE_ID_SECRET, junk)).toBeNull();
  });

  it('the install id derives a stable server id and is never used raw', async () => {
    const a = await idFromInstall(ENV.DEVICE_ID_SECRET, '2b6c8e30-aaaa-4bbb-8ccc-1234567890ab');
    expect(a).toMatch(/^d_[a-f0-9]{32}$/);
    expect(a).toBe(await idFromInstall(ENV.DEVICE_ID_SECRET, '2b6c8e30-aaaa-4bbb-8ccc-1234567890ab'));
    expect(a).not.toBe(await idFromInstall(ENV.DEVICE_ID_SECRET, '2b6c8e30-aaaa-4bbb-8ccc-1234567890ac'));
  });

  it('resolves in order: signed wins, else install, else fresh — and issues a token to the unverified', async () => {
    const install = await resolveIdentity(ENV, { deviceId: 'install-uuid-0001' });
    expect(install).toMatchObject({ verified: false, source: 'install' });
    expect(install!.issued).toMatch(/\./);
    const signed = await resolveIdentity(ENV, { deviceId: 'another-uuid-0002', signed_device_id: install!.issued });
    expect(signed).toEqual({ id: install!.id, verified: true, source: 'signed', issued: null });
    const fresh = await resolveIdentity(ENV, { deviceId: 'bad id!' });
    expect(fresh).toMatchObject({ verified: false, source: 'fresh' });
    expect(fresh!.id).toMatch(/^r_[a-f0-9]{32}$/);
    expect((await mintIdentity(ENV))!.id).not.toBe(fresh!.id);
  });

  it('reads the signed id from a header when the body has none', async () => {
    const minted = await mintIdentity(ENV);
    expect((await resolveIdentity(ENV, {}, minted!.issued))!.id).toBe(minted!.id);
    expect(await verifiedIdentity(ENV, minted!.issued)).toBe(minted!.id);
    expect(await verifiedIdentity(ENV, 'forged.token')).toBeNull();
  });

  it('without a secret nothing can be issued', async () => {
    expect(await resolveIdentity({}, { deviceId: 'install-uuid-0001' })).toBeNull();
    expect(await mintIdentity({})).toBeNull();
  });
});
