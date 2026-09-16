/**
 * /api/username identity regression — two fresh clients behind ONE ip +
 * user-agent must never share a vinax_users row.
 *
 * The old resolver derived an unverified device id from HMAC(ip|ua). Client A
 * claimed "alice" → row {s_X, alice}. Client B (same NAT, same browser build)
 * claimed "bob" → the same s_X → the upsert REPLACED alice's row with bob.
 * Alice's handle silently vanished. These tests drive the real handler over
 * an in-memory stand-in for the two Supabase calls it makes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Row { device_id: string; username?: string | null; name?: string; last_seen?: string }
const table = new Map<string, Row>();
let storeDown = false;

vi.mock('../functions/_lib/supabase', () => ({
  supabaseConfigured: () => true,
  sbSelect: async (_env: unknown, _table: string, query: string) => {
    if (storeDown) return [];
    const m = /^username=ilike\.([^&]+)/.exec(query);
    if (m) {
      const want = decodeURIComponent(m[1]).toLowerCase();
      const hit = [...table.values()].find((r) => (r.username ?? '').toLowerCase() === want);
      return hit ? [{ device_id: hit.device_id }] : [];
    }
    throw new Error(`unexpected sbSelect query: ${query}`);
  },
  sbSelectRes: async (_env: unknown, _table: string, query: string) => {
    if (storeDown) return { ok: false, rows: [] };
    const m = /^device_id=eq\.([^&]+)/.exec(query);
    if (!m) throw new Error(`unexpected sbSelectRes query: ${query}`);
    const row = table.get(decodeURIComponent(m[1]));
    return { ok: true, rows: row ? [{ username: row.username ?? null }] : [] };
  },
  sbUpsert: async (_env: unknown, _table: string, row: Row) => {
    if (storeDown) return false;
    // Mirror the DB's unique index on lower(username).
    const clash = [...table.values()].find(
      (r) => r.device_id !== row.device_id && (r.username ?? '').toLowerCase() === (row.username ?? '').toLowerCase(),
    );
    if (clash) return false;
    table.set(row.device_id, { ...(table.get(row.device_id) ?? { device_id: row.device_id }), ...row });
    return true;
  },
}));

import { onRequestPost } from '../functions/api/username';
import { verifyDeviceId } from '../functions/_lib/deviceid';

const env = { SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'y', DEVICE_ID_SECRET: 'test-secret' };
const SHARED = { 'user-agent': 'Mozilla/5.0 (same build)', 'content-type': 'application/json' };
// The claim endpoint is rate-limited per ip (10 per isolate), so every test
// gets its own network address — within a test all clients still share it.
let testIp = '';
let ipCounter = 0;

interface ClaimReply { ok?: boolean; username?: string; signed_device_id_next?: string; error?: string; suggestions?: string[] }

async function claim(body: Record<string, unknown>, ip = testIp): Promise<{ status: number; json: ClaimReply }> {
  const req = new Request('https://www.example.test/api/username', {
    method: 'POST',
    headers: { ...SHARED, 'cf-connecting-ip': ip },
    body: JSON.stringify(body),
  });
  const res = await onRequestPost({ request: req, env });
  return { status: res.status, json: (await res.json()) as ClaimReply };
}

const rows = () => [...table.values()].map((r) => ({ id: r.device_id, username: r.username }));

beforeEach(() => {
  table.clear();
  storeDown = false;
  ipCounter += 1;
  testIp = `203.0.113.${ipCounter}`;
});

describe('username claims from two clients sharing ip + user-agent', () => {
  it('gives each fresh client its own row and signed id; the first claim survives the second', async () => {
    const a = await claim({ username: 'alice', name: 'Alice' });
    const b = await claim({ username: 'bob', name: 'Bob' });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.json.signed_device_id_next).toBeTruthy();
    expect(b.json.signed_device_id_next).toBeTruthy();
    expect(a.json.signed_device_id_next).not.toBe(b.json.signed_device_id_next);
    expect(rows()).toHaveLength(2);
    expect(rows().map((r) => r.username).sort()).toEqual(['alice', 'bob']);
  });

  it('keeps clients apart by their own install id, not by the network', async () => {
    const a = await claim({ username: 'alice', deviceId: '11111111-aaaa-4bbb-8ccc-111111111111' });
    const b = await claim({ username: 'bob', deviceId: '22222222-aaaa-4bbb-8ccc-222222222222' });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(rows()).toHaveLength(2);
    // The install id alone is not proof of ownership: re-claiming without the
    // issued token reads as taken (no row is touched), while the token the
    // first claim handed back re-claims the same row from a new ip.
    const noToken = await claim({ username: 'alice', deviceId: '11111111-aaaa-4bbb-8ccc-111111111111' }, '198.51.100.9');
    expect(noToken.status).toBe(409);
    const again = await claim(
      { username: 'alice', deviceId: '11111111-aaaa-4bbb-8ccc-111111111111', signed_device_id: a.json.signed_device_id_next, current_username: 'alice' },
      '198.51.100.9',
    );
    expect(again.status).toBe(200);
    expect(rows()).toHaveLength(2);
  });

  it('an unverified second client cannot take an existing handle', async () => {
    await claim({ username: 'alice' });
    const b = await claim({ username: 'alice' });
    expect(b.status).toBe(409);
    expect(b.json.error).toBe('taken');
    expect(rows().filter((r) => r.username === 'alice')).toHaveLength(1);
  });

  it('a device that proves its signed id can re-claim and rename its own handle', async () => {
    const a = await claim({ username: 'alice' });
    const signed = a.json.signed_device_id_next!;
    const id = await verifyDeviceId(signed, env.DEVICE_ID_SECRET);
    expect(id).toBeTruthy();
    const re = await claim({ username: 'alice', signed_device_id: signed, current_username: 'alice' });
    expect(re.status).toBe(200);
    expect(re.json.signed_device_id_next).toBeUndefined();
    const renamed = await claim({ username: 'alicia', signed_device_id: signed, current_username: 'alice' });
    expect(renamed.status).toBe(200);
    expect(rows()).toEqual([{ id, username: 'alicia' }]);
  });

  it('a client holding a legacy shared token but a different handle is split into its own identity', async () => {
    // Two clients ended up with the SAME signed token in the past (the old
    // ip+ua derivation). One already owns "alice"; the other believes it
    // owns "carol" and now claims "bob". It must not overwrite alice's row.
    const a = await claim({ username: 'alice' });
    const sharedToken = a.json.signed_device_id_next!;
    const other = await claim({ username: 'bob', signed_device_id: sharedToken, current_username: 'carol' });
    expect(other.status).toBe(200);
    expect(other.json.signed_device_id_next).toBeTruthy();
    expect(other.json.signed_device_id_next).not.toBe(sharedToken);
    expect(rows().map((r) => r.username).sort()).toEqual(['alice', 'bob']);
  });

  it('reports the store as unavailable instead of pretending the claim succeeded', async () => {
    storeDown = true;
    const a = await claim({ username: 'alice' });
    expect(a.status).toBe(503);
    expect(a.json.error).toBe('unavailable');
    expect(rows()).toHaveLength(0);
  });
});
