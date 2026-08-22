/**
 * Listen Together "Start session" (prod bug 2026-08): the create insert
 * writes host_token (security H8); on databases that never ran that
 * migration PostgREST rejects the row and every session start failed with a
 * generic toast. These tests drive the REAL handler and pin the new honest
 * diagnostics.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestPost } from '../../worker/functions/api/room';

const ENV = { SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'srk' };

let ipSeq = 0;
function createReq(): Request {
  ipSeq += 1;
  return new Request('https://app.test/api/room', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': `10.7.0.${ipSeq % 250}` },
    body: JSON.stringify({ action: 'create', hostName: 'Sekhar', song: null }),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('room create', () => {
  it('healthy schema: returns a code and a host token', async () => {
    vi.stubGlobal('fetch', (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'POST') {
        const row = JSON.parse(String(init?.body)) as { code: string };
        return Promise.resolve(new Response(JSON.stringify([{ code: row.code }]), { status: 201 }));
      }
      return Promise.resolve(new Response('[]', { status: 200 }));
    });
    const res = await onRequestPost({ request: createReq(), env: ENV });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { code: string; hostToken: string };
    expect(body.code).toHaveLength(6);
    expect(body.hostToken.length).toBeGreaterThan(20);
  });

  it('missing host_token column: an honest 503 needs_migration, not a blind 500', async () => {
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      // Insert rejected (unknown column), host_token select rejected too,
      // but the table itself exists (select=code works).
      if (method === 'POST') return Promise.resolve(new Response('{"message":"column not found"}', { status: 400 }));
      if (url.includes('select=host_token')) return Promise.resolve(new Response('{"message":"column not found"}', { status: 400 }));
      return Promise.resolve(new Response('[]', { status: 200 }));
    });
    const res = await onRequestPost({ request: createReq(), env: ENV });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('needs_migration');
    expect(body.message).toContain('host_token');
  });

  it('missing table entirely: names schema.sql as the fix', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('{"message":"relation does not exist"}', { status: 404 })));
    const res = await onRequestPost({ request: createReq(), env: ENV });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { message: string }).message).toContain('schema.sql');
  });
});
