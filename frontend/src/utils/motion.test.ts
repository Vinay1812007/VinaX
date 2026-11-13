// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { animate, stagger, withViewTransition, DURATION } from './motion';

afterEach(() => {
  document.documentElement.classList.remove('reduce-motion');
  delete (document as unknown as Record<string, unknown>).startViewTransition;
});

describe('design system v2 motion', () => {
  it('keeps the duration table in step with tokens.css', () => {
    expect(DURATION).toEqual({ instant: 90, quick: 160, base: 240, slow: 360, page: 420 });
  });

  it('animates on the tokens, and does nothing under reduced motion', () => {
    const el = document.createElement('div');
    const spy = vi.fn(() => ({}) as Animation);
    (el as unknown as { animate: typeof spy }).animate = spy;
    expect(animate(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 'slow', easing: 'enter' })).not.toBeNull();
    expect(spy).toHaveBeenCalledWith([{ opacity: 0 }, { opacity: 1 }], expect.objectContaining({ duration: 360, easing: 'cubic-bezier(0.05, 0.7, 0.1, 1)' }));
    document.documentElement.classList.add('reduce-motion');
    expect(animate(el, [{ opacity: 0 }])).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(animate(null, [{ opacity: 0 }])).toBeNull();
  });

  it('caps the stagger so a long list never waits', () => {
    expect(stagger(0)).toBe(0);
    expect(stagger(3, 40)).toBe(120);
    expect(stagger(50, 40)).toBe(320);
    expect(stagger(-2)).toBe(0);
  });

  it('runs the update inside a view transition when there is one, straight away otherwise', async () => {
    const update = vi.fn();
    await withViewTransition(update);
    expect(update).toHaveBeenCalledTimes(1);

    const start = vi.fn((cb: () => void) => {
      cb();
      return { finished: Promise.resolve(), ready: Promise.resolve() };
    });
    (document as unknown as { startViewTransition: typeof start }).startViewTransition = start;
    await withViewTransition(update);
    expect(start).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(2);

    document.documentElement.classList.add('reduce-motion');
    await withViewTransition(update);
    expect(start).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(3);
  });
});
