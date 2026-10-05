// @vitest-environment jsdom
/**
 * 10.1 allotment rules, with fake timers and a fake fetch: latency-aware
 * ranking, hedged interactive calls (and the loser aborted), Retry-After
 * cooling, weighted spreading of background calls, the per-endpoint
 * concurrency cap, and in-flight de-duplication with a short memo.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activeBases } from '@/constants/endpoints';
import { clearRequestMemo, orchestratedRequest, type OrchestratedRequest } from './client';
import { HEDGE_MAX_MS, HEDGE_MIN_MS, healthRegistry, MAX_IN_FLIGHT, parseRetryAfter } from './health';

const [A, B, C] = activeBases();

interface Plan {
  /** ms before answering; Infinity = hang until aborted. */
  delay?: number;
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
}

interface Call {
  url: string;
  base: string;
  signal: AbortSignal | null | undefined;
}

/** A fake fetch: `plans` maps a base id to how that endpoint behaves. */
function fakeFetch(plans: Record<string, Plan>) {
  const calls: Call[] = [];
  const baseOf = (url: string) =>
    [A, B, C].find((b) => (b.url.startsWith('/') ? url.startsWith(b.url) : url.startsWith(b.url)))!.id;
  const fn = vi.fn((url: string, init?: RequestInit) => {
    const base = baseOf(url);
    calls.push({ url, base, signal: init?.signal });
    const plan = plans[base] ?? { delay: 0 };
    return new Promise<Response>((resolve, reject) => {
      const abort = () => reject(new DOMException('aborted', 'AbortError'));
      if (init?.signal?.aborted) return abort();
      init?.signal?.addEventListener('abort', abort, { once: true });
      if (plan.delay === Infinity) return;
      window.setTimeout(() => {
        resolve(
          new Response(JSON.stringify(plan.body ?? { from: base }), {
            status: plan.status ?? 200,
            headers: { 'content-type': 'application/json', ...(plan.headers ?? {}) },
          }),
        );
      }, plan.delay ?? 0);
    });
  });
  vi.stubGlobal('fetch', fn);
  return { fn, calls };
}

const req = (extra: Partial<OrchestratedRequest<string>> = {}): OrchestratedRequest<string> => ({
  paths: ['/search/songs?query=x'],
  validate: (j) => ((j as { from?: string })?.from ? (j as { from: string }).from : null),
  ...extra,
});

/** Run a request, recording when (and how) it settles. */
function track<T>(p: Promise<T>) {
  const out = { done: false, value: undefined as T | undefined, error: null as unknown };
  void p.then(
    (v) => {
      out.value = v;
      out.done = true;
    },
    (e: unknown) => {
      out.error = e;
      out.done = true;
    },
  );
  return out;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
  healthRegistry.reset();
  clearRequestMemo();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  healthRegistry.reset();
  clearRequestMemo();
});

describe('latency-aware ranking', () => {
  it('ranks by expected time to success, not pass/fail alone', () => {
    // A: fast but fails half the time. B: slower, always answers. C: very slow.
    for (let i = 0; i < 6; i += 1) {
      healthRegistry.recordSuccess(A.id, 150);
      healthRegistry.recordFailure(A.id);
      healthRegistry.recordSuccess(B.id, 400);
      healthRegistry.recordSuccess(C.id, 3000);
    }
    healthRegistry.recordSuccess(A.id, 150); // A is not on a failure streak
    expect(healthRegistry.expectedMs(B.id)).toBeLessThan(healthRegistry.expectedMs(A.id));
    expect(healthRegistry.ranked([A, B, C]).map((b) => b.id)).toEqual([B.id, A.id, C.id]);
  });

  it('among endpoints that always answer, the faster one leads', () => {
    for (let i = 0; i < 5; i += 1) {
      healthRegistry.recordSuccess(A.id, 900);
      healthRegistry.recordSuccess(B.id, 200);
    }
    expect(healthRegistry.ranked([A, B]).map((b) => b.id)).toEqual([B.id, A.id]);
  });

  it('a cooling endpoint goes last; the hedge delay is its bounded p75', () => {
    for (let i = 0; i < 3; i += 1) healthRegistry.recordFailure(A.id);
    expect(healthRegistry.isCoolingDown(A.id)).toBe(true);
    expect(healthRegistry.ranked([A, B, C])[2].id).toBe(A.id);
    for (let i = 0; i < 10; i += 1) healthRegistry.recordSuccess(B.id, 50);
    expect(healthRegistry.hedgeDelayMs(B.id)).toBe(HEDGE_MIN_MS);
    for (let i = 0; i < 10; i += 1) healthRegistry.recordSuccess(C.id, 5000);
    expect(healthRegistry.hedgeDelayMs(C.id)).toBe(HEDGE_MAX_MS);
  });

  it('a hedged loser we gave up on is remembered as at least that slow', () => {
    const before = healthRegistry.snapshot().find((h) => h.id === A.id)!.latencyEmaMs;
    healthRegistry.recordSlow(A.id, 3000);
    expect(healthRegistry.snapshot().find((h) => h.id === A.id)!.latencyEmaMs).toBeGreaterThan(before);
    expect(healthRegistry.snapshot().find((h) => h.id === A.id)!.failures).toBe(0);
  });
});

describe('hedged interactive calls', () => {
  it('fires the same request at the next endpoint past the p75, takes the first answer, aborts the loser', async () => {
    const { calls } = fakeFetch({ [A.id]: { delay: Infinity }, [B.id]: { delay: 100 } });
    const hedgeAt = healthRegistry.hedgeDelayMs(A.id);
    const out = track(orchestratedRequest(req({ priority: 'interactive' })));
    await vi.advanceTimersByTimeAsync(hedgeAt - 1);
    expect(calls.map((c) => c.base)).toEqual([A.id]);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls.map((c) => c.base)).toEqual([A.id, B.id]);
    await vi.advanceTimersByTimeAsync(100);
    expect(out.done).toBe(true);
    expect(out.value).toBe(B.id);
    expect(calls[0].signal?.aborted).toBe(true); // the loser is cancelled
    expect(calls[1].signal?.aborted).toBe(false);
    // Losing a hedge is not a failure, but the slowness is noted.
    const a = healthRegistry.snapshot().find((h) => h.id === A.id)!;
    expect(a.failures).toBe(0);
    expect(a.inFlight).toBe(0);
  });

  it('keeps the first endpoint when it answers before the hedge', async () => {
    const { calls } = fakeFetch({ [A.id]: { delay: 200 }, [B.id]: { delay: 0 } });
    const out = track(orchestratedRequest(req({ priority: 'interactive' })));
    await vi.advanceTimersByTimeAsync(2000);
    expect(out.value).toBe(A.id);
    expect(calls.map((c) => c.base)).toEqual([A.id]);
  });

  it('background and standard calls never hedge', async () => {
    for (const priority of ['background', 'standard'] as const) {
      healthRegistry.reset();
      healthRegistry.random = () => 0; // background: the first ready endpoint
      const { calls } = fakeFetch({ [A.id]: { delay: 3000 }, [B.id]: { delay: 0 } });
      const out = track(orchestratedRequest(req({ priority })));
      await vi.advanceTimersByTimeAsync(2500);
      expect(calls.map((c) => c.base)).toEqual([A.id]);
      await vi.advanceTimersByTimeAsync(600);
      expect(out.value).toBe(A.id);
    }
  });

  it('a caller cancel aborts both racers and is not a health failure', async () => {
    const { calls } = fakeFetch({ [A.id]: { delay: Infinity }, [B.id]: { delay: Infinity } });
    const ctrl = new AbortController();
    const out = track(orchestratedRequest(req({ priority: 'interactive', signal: ctrl.signal })));
    await vi.advanceTimersByTimeAsync(HEDGE_MAX_MS);
    expect(calls).toHaveLength(2);
    ctrl.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(out.done).toBe(true);
    expect((out.error as Error).message).toBe('cancelled');
    expect(calls.every((c) => c.signal?.aborted)).toBe(true);
    expect(healthRegistry.snapshot().every((h) => h.failures === 0 && h.inFlight === 0)).toBe(true);
  });
});

describe('Retry-After', () => {
  it('parses delta-seconds and HTTP dates', () => {
    expect(parseRetryAfter('120')).toBe(120_000);
    expect(parseRetryAfter(new Date(Date.now() + 30_000).toUTCString())).toBeGreaterThan(28_000);
    expect(parseRetryAfter('soon')).toBeNull();
    expect(parseRetryAfter(null)).toBeNull();
  });

  it('a 429 cools that endpoint for Retry-After and the call is allotted elsewhere', async () => {
    const { calls } = fakeFetch({
      [A.id]: { status: 429, headers: { 'retry-after': '120' }, body: { error: 'slow down' } },
      [B.id]: { delay: 10 },
    });
    const first = track(orchestratedRequest(req()));
    await vi.advanceTimersByTimeAsync(50);
    expect(first.value).toBe(B.id);
    expect(calls.map((c) => c.base)).toEqual([A.id, B.id]);
    expect(healthRegistry.isRateLimited(A.id)).toBe(true);

    // While cooling, A gets nothing — even though it was "first".
    calls.length = 0;
    const second = track(orchestratedRequest(req({ paths: ['/search/songs?query=y'] })));
    await vi.advanceTimersByTimeAsync(50);
    expect(second.value).toBe(B.id);
    expect(calls.map((c) => c.base)).not.toContain(A.id);

    // Retry-After honoured to the second, not the generic cooldown.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(healthRegistry.isRateLimited(A.id)).toBe(false);
  });

  it('a 503 with an HTTP-date Retry-After cools until that date', async () => {
    const until = new Date(Date.now() + 45_000).toUTCString();
    fakeFetch({ [A.id]: { status: 503, headers: { 'retry-after': until } }, [B.id]: { delay: 0 } });
    const out = track(orchestratedRequest(req()));
    await vi.advanceTimersByTimeAsync(10);
    expect(out.value).toBe(B.id);
    expect(healthRegistry.isRateLimited(A.id)).toBe(true);
    await vi.advanceTimersByTimeAsync(46_000);
    expect(healthRegistry.isRateLimited(A.id)).toBe(false);
  });
});

describe('fair spreading of background calls', () => {
  it('draws the first endpoint by health weight, and never a cooling one', () => {
    for (let i = 0; i < 5; i += 1) {
      healthRegistry.recordSuccess(A.id, 200);
      healthRegistry.recordSuccess(B.id, 200);
      healthRegistry.recordSuccess(C.id, 800);
    }
    const weights = [A, B, C].map((b) => 1 / healthRegistry.expectedMs(b.id));
    const total = weights.reduce((s, w) => s + w, 0);
    const firstFor = (r: number) => {
      healthRegistry.random = () => r;
      return healthRegistry.spread([A, B, C])[0].id;
    };
    // The draw walks the ranked ready list: A (tie with B, first in order), B, C.
    expect(firstFor(0)).toBe(A.id);
    expect(firstFor((weights[0] + 0.01 * weights[1]) / total)).toBe(B.id);
    expect(firstFor(0.999)).toBe(C.id);
    // Slow C gets a smaller share than the faster A and B.
    expect(weights[2]).toBeLessThan(weights[0]);
    // Every endpoint still appears as a fallback, exactly once.
    expect(new Set(healthRegistry.spread([A, B, C]).map((b) => b.id)).size).toBe(3);
    for (let i = 0; i < 3; i += 1) healthRegistry.recordFailure(C.id);
    expect(firstFor(0.999)).not.toBe(C.id);
  });

  it('spreads real background requests across endpoints; interactive ones keep the best', async () => {
    const { calls } = fakeFetch({});
    let n = 0;
    const draws = [0.1, 0.5, 0.9, 0.1, 0.5, 0.9];
    healthRegistry.random = () => draws[n++ % draws.length];
    for (let i = 0; i < 6; i += 1) void orchestratedRequest(req({ priority: 'background', paths: [`/bg?i=${i}`] }));
    await vi.advanceTimersByTimeAsync(10);
    expect(new Set(calls.map((c) => c.base)).size).toBe(3);
    calls.length = 0;
    const best = healthRegistry.ranked([A, B, C])[0].id;
    for (let i = 0; i < 3; i += 1) void orchestratedRequest(req({ priority: 'interactive', paths: [`/it?i=${i}`] }));
    await vi.advanceTimersByTimeAsync(10);
    expect(calls.map((c) => c.base)).toEqual([best, best, best]);
  });
});

describe('per-endpoint concurrency cap', () => {
  it(`holds at most ${MAX_IN_FLIGHT} requests on one endpoint and allots the rest elsewhere`, async () => {
    const { calls } = fakeFetch({ [A.id]: { delay: 1000 }, [B.id]: { delay: 1000 }, [C.id]: { delay: 1000 } });
    for (let i = 0; i < MAX_IN_FLIGHT + 2; i += 1) void orchestratedRequest(req({ paths: [`/p?i=${i}`] }));
    await vi.advanceTimersByTimeAsync(1);
    const onA = calls.filter((c) => c.base === A.id).length;
    expect(onA).toBe(MAX_IN_FLIGHT);
    expect(calls.length).toBe(MAX_IN_FLIGHT + 2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(healthRegistry.snapshot().every((h) => h.inFlight === 0)).toBe(true);
  });

  it('queues for a slot when every endpoint is full, interactive first', async () => {
    fakeFetch({ [A.id]: { delay: 500 }, [B.id]: { delay: 500 }, [C.id]: { delay: 500 } });
    for (let i = 0; i < MAX_IN_FLIGHT * 3; i += 1) void orchestratedRequest(req({ paths: [`/f?i=${i}`] }));
    await vi.advanceTimersByTimeAsync(1);
    const order: string[] = [];
    const bg = orchestratedRequest(req({ priority: 'background', paths: ['/late-bg'] })).then(() => order.push('bg'));
    const it1 = orchestratedRequest(req({ priority: 'interactive', paths: ['/late-it'] })).then(() => order.push('it'));
    await vi.advanceTimersByTimeAsync(2000);
    await Promise.all([bg, it1]);
    expect(order[0]).toBe('it');
  });
});

describe('in-flight de-duplication and the short memo', () => {
  it('identical GETs share one call, and a repeat within the window is free', async () => {
    const { calls } = fakeFetch({ [A.id]: { delay: 100 } });
    const r = req({ cacheMs: 5000 });
    const one = track(orchestratedRequest(r));
    const two = track(orchestratedRequest(r));
    await vi.advanceTimersByTimeAsync(100);
    expect(one.value).toBe(A.id);
    expect(two.value).toBe(A.id);
    expect(calls).toHaveLength(1);

    const three = track(orchestratedRequest(r));
    await vi.advanceTimersByTimeAsync(0);
    expect(three.value).toBe(A.id);
    expect(calls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(5000);
    track(orchestratedRequest(r));
    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toHaveLength(2);
  });

  it('one sharer cancelling leaves the call running for the other; the last one out aborts it', async () => {
    const { calls } = fakeFetch({ [A.id]: { delay: 300 } });
    const c1 = new AbortController();
    const c2 = new AbortController();
    const one = track(orchestratedRequest(req({ cacheMs: 5000, signal: c1.signal })));
    const two = track(orchestratedRequest(req({ cacheMs: 5000, signal: c2.signal })));
    await vi.advanceTimersByTimeAsync(10);
    c1.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect((one.error as Error).message).toBe('cancelled');
    expect(calls[0].signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(300);
    expect(two.value).toBe(A.id);

    clearRequestMemo();
    const c3 = new AbortController();
    const c4 = new AbortController();
    track(orchestratedRequest(req({ cacheMs: 5000, signal: c3.signal, paths: ['/other'] })));
    track(orchestratedRequest(req({ cacheMs: 5000, signal: c4.signal, paths: ['/other'] })));
    await vi.advanceTimersByTimeAsync(10);
    c3.abort();
    c4.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls[calls.length - 1].signal?.aborted).toBe(true);
  });

  it('without cacheMs nothing is shared', async () => {
    const { calls } = fakeFetch({ [A.id]: { delay: 10 } });
    void orchestratedRequest(req());
    void orchestratedRequest(req());
    await vi.advanceTimersByTimeAsync(20);
    expect(calls).toHaveLength(2);
  });
});
