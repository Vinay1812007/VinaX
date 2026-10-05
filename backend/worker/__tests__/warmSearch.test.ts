/** 10.1 — waking the search instance: token-free /healthz, answered at once, rate-limited. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestPost } from '../functions/api/warm-search';

afterEach(() => vi.unstubAllGlobals());

describe('POST /api/warm-search', () => {
  it('pings the instance health path in the background and answers 204', async () => {
    const calls: Array<{ url: string; auth: string | null }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      calls.push({ url: String(input), auth: new Headers(init?.headers).get('authorization') });
      return new Response('ok');
    }));
    const jobs: Promise<unknown>[] = [];
    const res = await onRequestPost({
      request: new Request('https://app.test/api/warm-search', { method: 'POST', headers: { 'cf-connecting-ip': '10.50.0.1' } }),
      env: { SEARXNG_URL: 'https://search.example.org', SEARXNG_TOKEN: 'secret' },
      waitUntil: (p) => jobs.push(p),
    });
    expect(res.status).toBe(204);
    await Promise.all(jobs);
    expect(calls).toEqual([{ url: 'https://search.example.org/healthz', auth: null }]);
  });

  it('does nothing without an instance', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const res = await onRequestPost({ request: new Request('https://app.test/api/warm-search', { method: 'POST', headers: { 'cf-connecting-ip': '10.50.0.2' } }), env: {} });
    expect(res.status).toBe(204);
    expect(f).not.toHaveBeenCalled();
  });

  it('is rate-limited per address', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok')));
    const req = () => new Request('https://app.test/api/warm-search', { method: 'POST', headers: { 'cf-connecting-ip': '10.50.0.3' } });
    const codes: number[] = [];
    for (let i = 0; i < 8; i += 1) codes.push((await onRequestPost({ request: req(), env: {} })).status);
    expect(codes.filter((c) => c === 429).length).toBeGreaterThan(0);
  });
});
