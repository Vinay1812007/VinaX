import { isNativePlatform } from '@/services/native';

export interface ApiBase {
  id: string;
  url: string;
  label: string;
}

/**
 * Where the app gets its catalogue: its OWN origin, and nothing else.
 *
 * 14.0.4 — every provider URL left the bundle. /api/cat on the Worker holds
 * the ordered list of upstream wrappers in a secret (CATALOG_UPSTREAMS),
 * tries them in order and falls back to its built-in direct translation, so
 * a provider can be added, reordered or dropped in Cloudflare without a
 * release — and nobody can read the list out of the app. The same-origin
 * base leads on the web; the absolute one is the Android app's only base
 * and the web's fallback when the same-origin route is unreachable.
 * VITE_API_BASES still overrides the list at build time (and is public, like
 * every VITE_* value): use it only for local experiments.
 */
export const DEFAULT_API_BASES: ApiBase[] = isNativePlatform()
  ? [{ id: 'sirimilla', url: 'https://www.vinaxmusic.online/api/cat', label: 'VinaX Catalog' }]
  : [
      { id: 'local-catalog', url: '/api/cat', label: 'VinaX Catalog' },
      { id: 'sirimilla', url: 'https://www.vinaxmusic.online/api/cat', label: 'VinaX Catalog (remote)' },
    ];

function basesFromEnv(): ApiBase[] | null {
  const raw = import.meta.env.VITE_API_BASES;
  if (!raw) return null;
  const urls = raw.split(',').map((u) => u.trim()).filter(Boolean);
  if (urls.length === 0) return null;
  return urls.map((url, i) => {
    let label = url;
    try {
      label = new URL(url).host;
    } catch {
      /* keep raw */
    }
    return { id: `env-${i}-${label}`, url: url.replace(/\/$/, ''), label };
  });
}

export const API_BASES: ApiBase[] = basesFromEnv() ?? DEFAULT_API_BASES;

/** v5.15.0 — sources switched off from the admin console (Catalog Sources).
 *  Never empties the list: if every source were disabled, all stay on. */
let disabled = new Set<string>();
export function setDisabledSources(ids: string[] | undefined | null): void {
  disabled = new Set(Array.isArray(ids) ? ids : []);
}
export function activeBases(): ApiBase[] {
  const on = API_BASES.filter((b) => !disabled.has(b.id));
  return on.length ? on : API_BASES;
}

export const REQUEST_TIMEOUT_MS = 8000;
export const COOLDOWN_MS = 60_000;
export const MAX_CONSECUTIVE_FAILURES = 3;
export const FALLBACK_PASSES = 2; // full passes across ranked providers
export const RETRY_BACKOFF_MS = 600;
