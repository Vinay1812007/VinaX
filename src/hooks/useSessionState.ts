import { useCallback, useState } from 'react';

/**
 * useState that survives navigation within the browsing session (delta audit
 * P2-21): selected ranges, sorts and filter chips restore when the user comes
 * back to a page, and reset naturally when the session ends. Same contract as
 * useState; storage failures (private mode, quota) degrade to plain state.
 */
export function useSessionState<T>(key: string, initial: T): [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.sessionStorage.getItem(key);
      return raw !== null ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        try {
          window.sessionStorage.setItem(key, JSON.stringify(resolved));
        } catch {
          /* private mode — the choice just won't stick */
        }
        return resolved;
      });
    },
    [key],
  );
  return [value, set];
}
