/**
 * useMediaQuery gates whole subtrees (the wide-screen Now Playing rail), so it
 * must follow the query live, clean its listener up, and never throw where
 * matchMedia is missing.
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useMediaQuery } from './useMediaQuery';

interface FakeMql {
  matches: boolean;
  media: string;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
}

function installMatchMedia(initial: boolean) {
  const listeners = new Set<() => void>();
  const state = { matches: initial };
  const add = vi.fn((_: string, cb: () => void) => listeners.add(cb));
  const remove = vi.fn((_: string, cb: () => void) => listeners.delete(cb));
  const matchMedia = vi.fn(
    (media: string): FakeMql => ({
      get matches() {
        return state.matches;
      },
      media,
      addEventListener: add,
      removeEventListener: remove,
    }),
  );
  Object.defineProperty(window, 'matchMedia', { value: matchMedia, configurable: true, writable: true });
  return {
    listeners,
    add,
    remove,
    flip(next: boolean) {
      state.matches = next;
      listeners.forEach((cb) => cb());
    },
  };
}

afterEach(() => {
  Object.defineProperty(window, 'matchMedia', { value: undefined, configurable: true, writable: true });
});

describe('useMediaQuery', () => {
  it('returns the current match and follows changes', () => {
    const mm = installMatchMedia(false);
    const { result } = renderHook(() => useMediaQuery('(min-width: 1280px)'));
    expect(result.current).toBe(false);
    act(() => mm.flip(true));
    expect(result.current).toBe(true);
    act(() => mm.flip(false));
    expect(result.current).toBe(false);
  });

  it('removes its listener on unmount', () => {
    const mm = installMatchMedia(true);
    const { result, unmount } = renderHook(() => useMediaQuery('(min-width: 1280px)'));
    expect(result.current).toBe(true);
    expect(mm.listeners.size).toBe(1);
    unmount();
    expect(mm.remove).toHaveBeenCalledTimes(1);
    expect(mm.listeners.size).toBe(0);
  });

  it('answers false (and does not throw) when matchMedia is unavailable', () => {
    const { result } = renderHook(() => useMediaQuery('(min-width: 1280px)'));
    expect(result.current).toBe(false);
  });
});
