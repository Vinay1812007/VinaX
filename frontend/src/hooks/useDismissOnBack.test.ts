// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { closeTopOverlay, pushOverlay, useDismissOnBack } from './useDismissOnBack';

describe('overlay back-stack', () => {
  it('reports false when nothing is open', () => {
    expect(closeTopOverlay()).toBe(false);
  });

  it('asks the topmost overlay to close, newest first', () => {
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = pushOverlay(first);
    const offSecond = pushOverlay(second);
    expect(closeTopOverlay()).toBe(true);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    offSecond(); // what the closing overlay's effect cleanup does
    expect(closeTopOverlay()).toBe(true);
    expect(first).toHaveBeenCalledTimes(1);
    offFirst();
    expect(closeTopOverlay()).toBe(false);
  });

  it('an overlay that refuses to close keeps swallowing back presses', () => {
    const refuse = vi.fn(); // mandatory dialog: its close is a no-op
    const off = pushOverlay(refuse);
    expect(closeTopOverlay()).toBe(true);
    expect(closeTopOverlay()).toBe(true);
    expect(closeTopOverlay()).toBe(true);
    expect(refuse).toHaveBeenCalledTimes(3);
    off();
    expect(closeTopOverlay()).toBe(false);
  });

  it('unregistering is idempotent', () => {
    const close = vi.fn();
    const off = pushOverlay(close);
    off();
    off();
    expect(closeTopOverlay()).toBe(false);
  });
});

describe('useDismissOnBack', () => {
  it('registers while open, reads the latest callback, unregisters on close', () => {
    const a = vi.fn();
    const b = vi.fn();
    const { rerender } = renderHook(({ open, close }) => useDismissOnBack(open, close), {
      initialProps: { open: true, close: a },
    });
    rerender({ open: true, close: b });
    expect(closeTopOverlay()).toBe(true);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
    rerender({ open: false, close: b });
    expect(closeTopOverlay()).toBe(false);
  });

  it('unregisters on unmount', () => {
    const { unmount } = renderHook(() => useDismissOnBack(true, () => undefined));
    expect(closeTopOverlay()).toBe(true);
    unmount();
    expect(closeTopOverlay()).toBe(false);
  });
});
