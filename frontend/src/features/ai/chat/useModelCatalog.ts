import { useCallback, useEffect, useRef, useState } from 'react';
import { MODELS_ENDPOINT } from './endpoints';
import { NO_FEATURES, parseCatalogResponse, parseFeatures, type CatalogState } from './models';
import type { AiFeatures, Provider } from './types';

/** How long a fetched catalogue is trusted before the next open re-asks. */
export const CATALOG_TTL_MS = 5 * 60_000;

// One cache for the page's lifetime in the tab: the composer menu and the
// "default model" menu in Settings share it, and reopening a menu inside the
// window costs nothing.
let cached: { at: number; providers: Provider[]; features: AiFeatures } | null = null;
let inflight: Promise<Provider[]> | null = null;

/** Tests only. */
export function resetModelCatalogCache(): void {
  cached = null;
  inflight = null;
}

function fetchCatalog(): Promise<Provider[]> {
  inflight ??= fetch(MODELS_ENDPOINT)
    .then((r) => (r.ok ? (r.json() as Promise<unknown>) : Promise.reject(new Error('bad response'))))
    .then((j) => {
      const providers = parseCatalogResponse(j);
      // 10.3 — a body without the providers list (an older server) is a
      // failed read, not four empty providers.
      if (!providers.length) throw new Error('unrecognised list');
      // 10.3 — which kinds of model (image, speech, …) and tools exist at all.
      cached = { at: Date.now(), providers, features: parseFeatures(j) };
      return providers;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/**
 * The live model catalogue, on demand. Nothing is fetched until `load()` is
 * first called (the model menu opening, or the default-model setting), and
 * a result is reused for five minutes. A failure is reported as a failure —
 * the menu says the list is unavailable rather than showing an invented one,
 * and Auto keeps working.
 */
export function useModelCatalog(): {
  state: CatalogState;
  providers: Provider[];
  /** 10.3 — all off until the list is read (and on an older server). */
  features: AiFeatures;
  load: () => Promise<Provider[]>;
} {
  const [state, setState] = useState<CatalogState>(() => (cached ? 'ready' : 'idle'));
  const [providers, setProviders] = useState<Provider[]>(() => cached?.providers ?? []);
  const [features, setFeatures] = useState<AiFeatures>(() => cached?.features ?? NO_FEATURES);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback((): Promise<Provider[]> => {
    if (cached && Date.now() - cached.at < CATALOG_TTL_MS) {
      setProviders(cached.providers);
      setFeatures(cached.features);
      setState('ready');
      return Promise.resolve(cached.providers);
    }
    // A stale list stays on screen while the fresh one loads.
    if (!cached) setState('loading');
    return fetchCatalog().then(
      (g) => {
        if (alive.current) {
          setProviders(g);
          setFeatures(cached?.features ?? NO_FEATURES);
          setState('ready');
        }
        return g;
      },
      () => {
        if (alive.current) setState(cached ? 'ready' : 'failed');
        return cached?.providers ?? [];
      },
    );
  }, []);

  return { state, providers, features, load };
}
