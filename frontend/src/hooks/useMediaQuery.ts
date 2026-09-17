import { useCallback, useSyncExternalStore } from 'react';

/**
 * Live answer to a CSS media query. Components that are only ever SHOWN above
 * a breakpoint use this to not MOUNT below it — a `hidden xl:flex` subtree
 * still runs its subscriptions, fetches and image downloads on every phone.
 *
 * useSyncExternalStore over matchMedia: no effect-then-setState flash, the
 * listener is removed on unmount / query change, and the server snapshot (and
 * any runtime without matchMedia) answers `false`.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void): (() => void) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    [query],
  );
  const getSnapshot = useCallback(
    (): boolean =>
      typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
    [query],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function getServerSnapshot(): boolean {
  return false;
}
