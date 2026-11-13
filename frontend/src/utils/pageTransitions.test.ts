// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enablePageTransitions } from './pageTransitions';

type Nav = (to: unknown, opts?: Record<string, unknown>) => Promise<void>;

function fakeRouter(path: string) {
  const calls: [unknown, Record<string, unknown> | undefined][] = [];
  const router = {
    state: { location: { pathname: path } },
    navigate: ((to: unknown, opts?: Record<string, unknown>) => {
      calls.push([to, opts]);
      return Promise.resolve();
    }) as Nav,
  };
  enablePageTransitions(router as never);
  return { router, calls };
}

beforeEach(() => {
  (document as unknown as { startViewTransition: unknown }).startViewTransition = vi.fn();
});
afterEach(() => {
  delete (document as unknown as Record<string, unknown>).startViewTransition;
  document.documentElement.classList.remove('vx-vt', 'vx-vt-on', 'reduce-motion');
});

describe('page transitions', () => {
  it('turns the transition on for a page change, even when a <Link> passes viewTransition: undefined', async () => {
    const { router, calls } = fakeRouter('/library');
    expect(document.documentElement.classList.contains('vx-vt')).toBe(true);
    await router.navigate('/discover', { replace: false, viewTransition: undefined });
    expect(calls[0][1]).toMatchObject({ viewTransition: true });
    // The names go on for the transition only.
    expect(document.documentElement.classList.contains('vx-vt-on')).toBe(true);
  });

  it('respects an explicit opt-out', async () => {
    const { router, calls } = fakeRouter('/library');
    await router.navigate('/discover', { viewTransition: false });
    expect(calls[0][1]).toMatchObject({ viewTransition: false });
  });

  it('skips replace navigations, history steps and moves inside one screen', async () => {
    const { router, calls } = fakeRouter('/search');
    await router.navigate('/library', { replace: true });
    await router.navigate(-1);
    await router.navigate('/search/kesariya');
    expect(calls.map((c) => c[1]?.viewTransition)).toEqual([undefined, undefined, undefined]);
  });

  it('chat threads are one screen too', async () => {
    const { router, calls } = fakeRouter('/vinaxai');
    await router.navigate('/vinaxai/c/abc');
    expect(calls[0][1]?.viewTransition).toBeUndefined();
  });

  it('does nothing under reduced motion', async () => {
    const { router, calls } = fakeRouter('/library');
    document.documentElement.classList.add('reduce-motion');
    await router.navigate('/discover');
    expect(calls[0][1]?.viewTransition).toBeUndefined();
  });

  it('leaves the router alone where the browser has no View Transitions', () => {
    delete (document as unknown as Record<string, unknown>).startViewTransition;
    const router = { state: { location: { pathname: '/' } }, navigate: vi.fn() };
    const original = router.navigate;
    enablePageTransitions(router as never);
    expect(router.navigate).toBe(original);
    expect(document.documentElement.classList.contains('vx-vt')).toBe(false);
  });
});
