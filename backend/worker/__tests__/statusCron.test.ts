/**
 * 8.5.0 — the status probe round runs on the Worker's own Cron Trigger.
 *
 * GitHub's scheduler fired the 30-minute status-tick workflow only every
 * 4–6 hours, so uptime_last went stale and the public page read "API down"
 * while the API answered. The Worker's `scheduled` handler now records the
 * same round the POST route does.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const upserts: Array<{ table: string; row: Record<string, unknown> }> = [];
let configured = true;
vi.mock('../functions/_lib/supabase', () => ({
  supabaseConfigured: () => configured,
  sbCount: async () => 3,
  sbSelect: async () => [],
  sbUpsert: async (_env: unknown, table: string, row: Record<string, unknown>) => {
    upserts.push({ table, row });
    return true;
  },
}));

import worker from '../index';
import { onRequestPost, recordProbeRound } from '../functions/api/status';

beforeEach(() => {
  upserts.length = 0;
  configured = true;
  vi.stubGlobal('fetch', async () => new Response('ok', { status: 200 }));
});

describe('status probe round', () => {
  it('records every component, with the API up because the round ran', async () => {
    const r = await recordProbeRound({} as never);
    expect(r.recorded).toBe(5);
    const last = upserts.filter((u) => u.table === 'uptime_last').map((u) => [u.row.component, u.row.ok]);
    expect(last).toEqual([['website', true], ['api', true], ['catalog', true], ['database', true], ['admin', true]]);
  });

  it('is a quiet no-op without the database', async () => {
    configured = false;
    expect(await recordProbeRound({} as never)).toEqual({ recorded: 0, results: [] });
    expect(upserts).toHaveLength(0);
  });

  it('POST /api/status still answers the GitHub tick the same way', async () => {
    const res = await onRequestPost({ request: new Request('https://vinax.test/api/status', { method: 'POST', headers: { 'cf-connecting-ip': '10.7.0.1' } }), env: {} as never });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, recorded: 5 });
  });
});

describe('the Worker cron trigger', () => {
  it('scheduled() records a round through waitUntil', async () => {
    const pending: Promise<unknown>[] = [];
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await worker.scheduled({}, {} as never, { waitUntil: (p: Promise<unknown>) => void pending.push(p) });
    expect(pending).toHaveLength(1);
    await pending[0];
    expect(upserts.filter((u) => u.table === 'uptime_last')).toHaveLength(5);
  });

  it('a failing round is logged, never thrown', async () => {
    const pending: Promise<unknown>[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const spy = vi.spyOn(await import('../functions/api/status'), 'recordProbeRound');
    spy.mockRejectedValueOnce(new Error('db down'));
    await worker.scheduled({}, {} as never, { waitUntil: (p: Promise<unknown>) => void pending.push(p) });
    await expect(pending[0]).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('wrangler.toml schedules it every 30 minutes, as its own top-level table after every top-level key', () => {
    const toml = readFileSync(join(__dirname, '..', 'wrangler.toml'), 'utf8');
    expect(toml).toMatch(/^\[triggers\]\ncrons = \["7,37 \* \* \* \*"\]$/m);
    // A table header before `routes` would swallow it (TOML scoping): routes must come first.
    expect(toml.indexOf('\nroutes = [')).toBeLessThan(toml.indexOf('\n['));
  });
});
