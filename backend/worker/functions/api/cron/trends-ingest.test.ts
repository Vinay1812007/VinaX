/**
 * POST /api/cron/trends-ingest — secret in the header only, compared in
 * constant time; a run with no provider configured is honest about it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeRest, type FakeRest } from '../../_lib/trends/fakeRest.testutil';
import { onRequestPost } from './trends-ingest';

const ENV = { CRON_SECRET: 'cron-secret', SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'srk' };
let db: FakeRest;
beforeEach(() => {
  db = createFakeRest();
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => db.handle(String(input), init) ?? Promise.resolve(new Response('', { status: 599 })));
});
afterEach(() => vi.unstubAllGlobals());

const post = (qs = '', headers: Record<string, string> = {}, env: Record<string, string> = ENV) =>
  onRequestPost({ request: new Request(`https://www.example.test/api/cron/trends-ingest${qs}`, { method: 'POST', headers }), env });

describe('POST /api/cron/trends-ingest', () => {
  it('refuses a missing or wrong secret, and a secret in the URL', async () => {
    expect((await post()).status).toBe(401);
    expect((await post('', { 'x-cron-secret': 'nope' })).status).toBe(401);
    expect((await post('?key=cron-secret')).status).toBe(401);
    expect((await post('', { 'x-cron-secret': 'cron-secret' }, { SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'srk' })).status).toBe(401);
    expect(db.requests).toHaveLength(0);
  });

  it('needs the database', async () => {
    const res = await post('', { 'x-cron-secret': 'cron-secret' }, { CRON_SECRET: 'cron-secret' });
    expect(res.status).toBe(503);
  });

  it('validates the optional scope', async () => {
    expect((await post('?source=nope', { 'x-cron-secret': 'cron-secret' })).status).toBe(400);
    expect((await post('?region=india', { 'x-cron-secret': 'cron-secret' })).status).toBe(400);
  });

  it('without a video key runs only the editorial source and lists the rest as not run', async () => {
    const res = await post('', { 'x-cron-secret': 'cron-secret' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; runs: Array<{ source: string; status: string }>; notRun: Array<{ source: string; status: string }>; pruned: Record<string, boolean> };
    expect(body.notRun.map((n) => [n.source, n.status])).toEqual([
      ['youtube', 'not_configured'],
      ['instagram', 'disabled'],
      ['web', 'not_configured'],
    ]);
    expect(body.runs.map((r) => [r.source, r.status])).toEqual([['editorial', 'ok']]);
    expect(body.pruned).toMatchObject({ snapshots: true, matches: true, runs: true, editorial: true });
  });
});
