/**
 * Listen Together "Start session" — drives the REAL handler against a real
 * (in-memory) SQLite database through the D1 layer, pinning both the happy
 * path and the honest schema diagnostics (security H8 / prod bug 2026-08).
 */
import { describe, expect, it } from 'vitest';
import { onRequestPost } from '../functions/api/room';
import { fakeD1, fakeD1Ready, tableRows } from './fake-d1';
import { __resetDbBootstrap } from '../functions/_lib/db';

let ipSeq = 0;
function createReq(): Request {
  ipSeq += 1;
  return new Request('https://app.test/api/room', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': `10.7.0.${ipSeq % 250}` },
    body: JSON.stringify({ action: 'create', hostName: 'Sekhar', song: null }),
  });
}

describe('room create', () => {
  it('healthy schema: returns a code and a host token, and persists the room', async () => {
    const db = await fakeD1Ready();
    const res = await onRequestPost({ request: createReq(), env: { DB: db } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { code: string; hostToken: string };
    expect(body.code).toHaveLength(6);
    expect(body.hostToken.length).toBeGreaterThan(20);
    const rooms = tableRows(db, 'vinax_rooms');
    expect(rooms).toHaveLength(1);
    expect(rooms[0].code).toBe(body.code);
    expect(rooms[0].host_token).toBe(body.hostToken);
  });

  it('missing host_token column: an honest 503 needs_migration, not a blind 500', async () => {
    // Simulate a legacy database: schema_version says "current" (so the
    // bootstrap skips), but vinax_rooms predates host_token.
    const db = fakeD1();
    db.raw.exec(`create table vinax_meta (key text primary key, value text);
      insert into vinax_meta values ('schema_version', '999');
      create table vinax_rooms (code text primary key, host_name text, song text,
        position real, playing integer, updated_at text, created_at text);`);
    const res = await onRequestPost({ request: createReq(), env: { DB: db } });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('needs_migration');
    expect(body.message).toContain('host_token');
    __resetDbBootstrap();
  });

  it('missing table entirely: points at the D1 binding as the fix', async () => {
    const db = fakeD1();
    db.raw.exec(`create table vinax_meta (key text primary key, value text);
      insert into vinax_meta values ('schema_version', '999');`);
    const res = await onRequestPost({ request: createReq(), env: { DB: db } });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { message: string }).message).toContain('wrangler.toml');
    __resetDbBootstrap();
  });
});
