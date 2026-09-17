import { useCallback, useEffect, useRef, useState } from 'react';
import { MODELS_ENDPOINT } from './endpoints';
import { parseCatalogResponse, type CatalogState } from './models';
import type { CatalogGroup } from './types';

/** How long a fetched catalogue is trusted before the next open re-asks. */
export const CATALOG_TTL_MS = 5 * 60_000;

// One cache for the page's lifetime in the tab: the composer menu and the
// "default model" menu in Settings share it, and reopening a menu inside the
// window costs nothing.
let cached: { at: number; groups: CatalogGroup[] } | null = null;
let inflight: Promise<CatalogGroup[]> | null = null;

/** Tests only. */
export function resetModelCatalogCache(): void {
  cached = null;
  inflight = null;
}

function fetchCatalog(): Promise<CatalogGroup[]> {
  inflight ??= fetch(MODELS_ENDPOINT)
    .then((r) => (r.ok ? (r.json() as Promise<unknown>) : Promise.reject(new Error('bad response'))))
    .then((j) => {
      const groups = parseCatalogResponse(j);
      cached = { at: Date.now(), groups };
      return groups;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/**
 * The live model catalogue, on demand. Nothing is fetched until `load()` is
 * first called (the model menu opening, or Agent mode being switched on), and
 * a result is reused for five minutes. A failure is reported as a failure —
 * the menu says the list is unavailable rather than showing an invented one,
 * and the pinned engines keep working.
 */
export function useModelCatalog(): { state: CatalogState; groups: CatalogGroup[]; load: () => Promise<CatalogGroup[]> } {
  const [state, setState] = useState<CatalogState>(() => (cached ? 'ready' : 'idle'));
  const [groups, setGroups] = useState<CatalogGroup[]>(() => cached?.groups ?? []);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback((): Promise<CatalogGroup[]> => {
    if (cached && Date.now() - cached.at < CATALOG_TTL_MS) {
      setGroups(cached.groups);
      setState('ready');
      return Promise.resolve(cached.groups);
    }
    // A stale list stays on screen while the fresh one loads.
    if (!cached) setState('loading');
    return fetchCatalog().then(
      (g) => {
        if (alive.current) {
          setGroups(g);
          setState('ready');
        }
        return g;
      },
      () => {
        if (alive.current) setState(cached ? 'ready' : 'failed');
        return cached?.groups ?? [];
      },
    );
  }, []);

  return { state, groups, load };
}
