/**
 * Search-as-you-type hook: 150 ms after the (normalised) query settles, fetch
 * the quick hits with an AbortController that cancels the previous
 * keystroke's request. Results for a query the listener has already moved
 * past are dropped, never shown.
 */
import { useEffect, useState } from 'react';
import { fetchQuickResults, getCachedQuick, NO_HITS, type QuickHits } from './quickResults';

/** 10.1 — the typeahead answers within ~150 ms of a pause (was 250). */
export const QUICK_DEBOUNCE_MS = 150;

export interface QuickResults {
  /** The key the hits belong to ('' when nothing is shown). */
  key: string;
  hits: QuickHits;
  /** A request for the CURRENT key is still in flight. */
  loading: boolean;
  /** `hits` belong to a previous key (kept on screen, dimmed, while loading). */
  stale: boolean;
}

/** `key` must already be normalised (the page's `normalizeQuery`), so two
 *  inputs differing only by trailing whitespace share one key and never
 *  refetch. Pass '' to switch previews off. */
export function useQuickResults(key: string): QuickResults {
  const [state, setState] = useState<{ key: string; hits: QuickHits }>({ key: '', hits: NO_HITS });
  const [loadingKey, setLoadingKey] = useState('');

  useEffect(() => {
    if (key.length < 2) {
      setLoadingKey('');
      return undefined;
    }
    const cached = getCachedQuick(key);
    if (cached) {
      setState({ key, hits: cached });
      setLoadingKey('');
      return undefined;
    }
    const controller = new AbortController();
    setLoadingKey(key);
    const timer = window.setTimeout(() => {
      fetchQuickResults(key, controller.signal)
        .then((hits) => {
          if (controller.signal.aborted) return;
          setState({ key, hits });
        })
        .catch(() => {
          // Aborted: a newer keystroke owns the panel. Failed (offline, upstream
          // down): clear it — otherwise the previous query's hits stay on
          // screen, undimmed, under text they were never results for.
          if (!controller.signal.aborted) setState({ key, hits: NO_HITS });
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoadingKey('');
        });
    }, QUICK_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [key]);

  const active = key.length >= 2;
  return {
    key: active ? state.key : '',
    hits: active ? state.hits : NO_HITS,
    loading: active && loadingKey === key,
    stale: active && state.key !== key,
  };
}
