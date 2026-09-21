import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequestGet } from '../functions/api/admin/query';

/**
 * Review probe 4 (2026-09-19): the Query Console answered 200 with an empty
 * table when the database read FAILED, because the select helper swallowed
 * upstream errors. A failed read must be reported as unavailable, not zero.
 */
const ENV = { ADMIN_LOGIN_PASSWORD: 'test-secret', SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'srk' };
let ipSeq = 0;
const req = (qs: string, token = 'test-secret'): Request => {
  ipSeq += 1;
  return new Request(`https://admin.test/api/admin/query?${qs}`, { headers: { 'x-admin-token': token, 'cf-connecting-ip': `10.4.0.${ipSeq % 250}` } });
};
const upstream = (status: number, body = '[]') => vi.stubGlobal('fetch', () => Promise.resolve(new Response(body, { status, headers: { 'content-type': 'application/json' } })));

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('/api/admin/query — a failed read is not an empty table', () => {
  it('an upstream 500 answers 502 query_failed, never 200 with no rows', async () => {
    upstream(500, '{"message":"boom"}');
    const res = await onRequestGet({ request: req('table=vinax_events&hours=1'), env: ENV });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error?: string; rows?: unknown[] };
    expect(body.rows).toBeUndefined();
    expect(body.error).toBeDefined();
  });

  it('an upstream 401 is reported as unauthorized, distinct from unavailable', async () => {
    upstream(401, '{"message":"JWT expired"}');
    const res = await onRequestGet({ request: req('table=vinax_events&hours=1'), env: ENV });
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error?: string }).error).toBe('db_unauthorized');
  });

  it('a network failure is unavailable', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('fetch failed')));
    const res = await onRequestGet({ request: req('table=vinax_events&hours=1'), env: ENV });
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error?: string }).error).toBe('db_unavailable');
  });

  it('a hung upstream is cut by a deadline and reported as unavailable', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', (_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const pending = onRequestGet({ request: req('table=vinax_events&hours=1'), env: ENV });
    await vi.advanceTimersByTimeAsync(15_000);
    const res = await pending;
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error?: string }).error).toBe('db_unavailable');
  });

  it('an empty table is still a 200 with no rows, and a populated one lists them', async () => {
    upstream(200, '[]');
    const empty = await onRequestGet({ request: req('table=vinax_events&hours=1'), env: ENV });
    expect(empty.status).toBe(200);
    expect(((await empty.json()) as { rows: unknown[] }).rows).toEqual([]);
    upstream(200, '[{"type":"play"}]');
    const full = await onRequestGet({ request: req('table=vinax_events&hours=1'), env: ENV });
    expect(((await full.json()) as { rows: unknown[] }).rows).toHaveLength(1);
  });

  it('not configured and unauthorized callers are distinct from a failed read', async () => {
    const none = await onRequestGet({ request: req('table=vinax_events'), env: { ADMIN_LOGIN_PASSWORD: 'test-secret' } });
    expect(none.status).toBe(200);
    expect(((await none.json()) as { configured: boolean }).configured).toBe(false);
    const bad = await onRequestGet({ request: req('table=vinax_events', 'wrong'), env: ENV });
    expect(bad.status).toBe(401);
  });
});
