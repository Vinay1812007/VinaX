/**
 * Phase 5 nav-state primitives: the overlay back-stack (P0-2) and scroll
 * memory/restoration (P0-3).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

/** Queue rAF callbacks for manual stepping. */
function stubRaf(): Array<() => void> {
  const frames: Array<() => void> = [];
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => frames.push(cb) && 0);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  return frames;
}
afterEach(() => vi.unstubAllGlobals());
import { closeTopOverlay, pushOverlay } from '../hooks/useDismissOnBack';
import { recallScroll, rememberScroll, restoreWhenTall } from '../features/nav/scrollMemory';

describe('overlayStack', () => {
  it('closes LIFO: the most recently opened overlay goes first', () => {
    const order: string[] = [];
    const a = pushOverlay(() => order.push('a'));
    const b = pushOverlay(() => order.push('b'));
    expect(closeTopOverlay()).toBe(true);
    expect(closeTopOverlay()).toBe(true);
    expect(order).toEqual(['b', 'a']);
    expect(closeTopOverlay()).toBe(false); // empty → hardware back may pop history
    a();
    b(); // unregister after close is a no-op, never a crash
  });

  it('an overlay that closes itself (Escape/tap-out) unregisters cleanly', () => {
    let closed = 0;
    const unregister = pushOverlay(() => closed++);
    unregister(); // component closed by other means → effect cleanup
    expect(closeTopOverlay()).toBe(false);
    expect(closed).toBe(0);
  });
});

describe('scrollMemory', () => {
  it('remembers and recalls per history entry, defaulting to top', () => {
    rememberScroll('key-1', 480);
    rememberScroll('key-2', 90);
    rememberScroll('key-1', 512); // later scroll wins
    expect(recallScroll('key-1')).toBe(512);
    expect(recallScroll('key-2')).toBe(90);
    expect(recallScroll('never-seen')).toBe(0);
  });

  it('restores immediately when the page is already tall enough', () => {
    const el = { scrollTop: 0, scrollHeight: 3000, clientHeight: 800 };
    restoreWhenTall(el, 1200);
    expect(el.scrollTop).toBe(1200);
  });

  it('waits for content to stream in, then jumps once', () => {
    const frames = stubRaf();
    const el = { scrollTop: 0, scrollHeight: 400, clientHeight: 800 };
    restoreWhenTall(el, 1000);
    expect(el.scrollTop).toBe(0); // not yet — page still skeleton-short
    el.scrollHeight = 2400; // cached data rendered
    frames.shift()?.();
    expect(el.scrollTop).toBe(1000);
    expect(frames).toHaveLength(0); // done — no more polling
  });

  it('gives up to best-effort when the page never regrows', () => {
    const frames = stubRaf();
    const el = { scrollTop: 0, scrollHeight: 900, clientHeight: 800 };
    restoreWhenTall(el, 5000, 3);
    frames.shift()?.();
    frames.shift()?.();
    expect(el.scrollTop).toBe(100); // scrollHeight - clientHeight, not 5000
  });

  it('a cancelled restore never touches the scroller again', () => {
    const frames = stubRaf();
    const el = { scrollTop: 0, scrollHeight: 100, clientHeight: 800 };
    const cancel = restoreWhenTall(el, 700);
    cancel(); // user navigated again mid-restore
    el.scrollHeight = 5000;
    frames.shift()?.();
    expect(el.scrollTop).toBe(0);
  });
});
