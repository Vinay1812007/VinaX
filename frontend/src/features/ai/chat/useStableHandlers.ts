import { useMemo, useRef } from 'react';

type Fn = (...args: never[]) => unknown;

/**
 * A handlers object whose identity never changes while each function always
 * runs the latest closure. Memoised rows (messages, sidebar rows) can take it
 * as a prop without re-rendering every time the page does — which, while a
 * reply streams, is many times a second.
 */
export function useStableHandlers<T extends Record<string, Fn>>(handlers: T): T {
  const latest = useRef(handlers);
  latest.current = handlers;
  return useMemo(() => {
    const out: Record<string, Fn> = {};
    for (const key of Object.keys(latest.current)) {
      out[key] = ((...args: never[]) => latest.current[key](...args)) as Fn;
    }
    return out as T;
    // Keys are fixed for the life of the component by construction.
  }, []);
}
