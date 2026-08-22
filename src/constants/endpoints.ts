export interface ApiBase {
  id: string;
  url: string;
  label: string;
}

/**
 * The upstream music API wrappers. All are community wrappers and may
 * differ in shape, completeness, and availability — the orchestrator in
 * src/services/api treats every one of them as unreliable by default.
 * Pruned 2026-07 (DQA-10): saavn.dev (DNS no longer resolves) and the b4a.run
 * mirror (no CORS headers, so browsers can never read it) only produced
 * console errors and wasted requests. Re-add via VITE_API_BASES if revived.
 */
export const DEFAULT_API_BASES: ApiBase[] = [
  { id: 'saavn-sumit', url: 'https://saavn.sumit.co/api', label: 'saavn.sumit.co' },
  { id: 'nepotune', url: 'https://nepotuneapi.vercel.app/api', label: 'nepotuneapi' },
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

export const REQUEST_TIMEOUT_MS = 8000;
export const COOLDOWN_MS = 60_000;
export const MAX_CONSECUTIVE_FAILURES = 3;
export const FALLBACK_PASSES = 2; // full passes across ranked providers
export const RETRY_BACKOFF_MS = 600;
