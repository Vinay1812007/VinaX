import { useSyncExternalStore } from 'react';

/**
 * Live media-query match. Subscribes to the query itself, so a rotated
 * tablet or a resized desktop window re-renders exactly the components that
 * asked. Prerender/SSR (no `matchMedia`) reads as "no match".
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => undefined;
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => (typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(query).matches),
    () => false,
  );
}

/** Tailwind's `lg` — the two-column Now Playing layout. */
export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 1024px)');
}
