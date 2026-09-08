/**
 * v5.19.0 — search-as-you-type hook: 250 ms after the (normalised) query
 * settles, fetch a six-song preview with an AbortController that cancels the
 * previous keystroke's request. Results for a query the listener has already
 * moved past are dropped, never shown.
 */
import { useEffect, useState } from 'react';
import type { Song } from '@/types';
import { fetchQuickResults, getCachedQuick } from './quickResults';

export const QUICK_DEBOUNCE_MS = 250;

export interface QuickResults {
  /** The key the songs belong to ('' when nothing is shown). */
  key: string;
  songs: Song[];
  /** A request for the CURRENT key is still in flight. */
  loading: boolean;
  /** `songs` belong to a previous key (kept on screen, dimmed, while loading). */
  stale: boolean;
}

/** `key` must already be normalised (the page's `normalizeQuery`), so two
 *  inputs differing only by trailing whitespace share one key and never
 *  refetch. Pass '' to switch previews off. */
export function useQuickResults(key: string): QuickResults {
  const [state, setState] = useState<{ key: string; songs: Song[] }>({ key: '', songs: [] });
  const [loadingKey, setLoadingKey] = useState('');

  useEffect(() => {
    if (key.length < 2) {
      setLoadingKey('');
      return undefined;
    }
    const cached = getCachedQuick(key);
    if (cached) {
      setState({ key, songs: cached });
      setLoadingKey('');
      return undefined;
    }
    const controller = new AbortController();
    setLoadingKey(key);
    const timer = window.setTimeout(() => {
      fetchQuickResults(key, controller.signal)
        .then((songs) => {
          if (controller.signal.aborted) return;
          setState({ key, songs });
        })
        .catch(() => {
          /* aborted or offline — the preview simply doesn't appear */
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
    songs: active ? state.songs : [],
    loading: active && loadingKey === key,
    stale: active && state.key !== key,
  };
}
