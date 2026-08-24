import { isNativePlatform } from '@/services/native';

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
 * V5.0 (2026-08): first-party catalog API (sirimillavinay.online) leads the
 * list for the web app — song delivery no longer depends on community wrappers.
 */
export const DEFAULT_API_BASES: ApiBase[] = isNativePlatform()
  ? [
      // Capacitor does not have the Cloudflare Pages function on its local
      // WebView origin, so native playback/search uses the deployed catalog.
      { id: 'sirimilla', url: 'https://www.sirimillavinay.online/api/cat', label: 'sirimillavinay.online' },
    ]
  : [
      // Browser/web builds always use our same-origin catalog. In local Vite
      // development, vite.config.ts mounts /api/cat and runs the exact same
      // Cloudflare catalog handler against JioSaavn. In production, Cloudflare
      // Pages serves functions/api/cat/[[path]].ts at this same path.
      { id: 'local-catalog', url: '/api/cat', label: 'VinaX Catalog' },
      // Remote first-party fallback for cases where the deployed same-origin
      // function is temporarily unavailable. Community mirrors are deliberately
      // not included because they have recently returned 429/402 outages.
      { id: 'sirimilla', url: 'https://www.sirimillavinay.online/api/cat', label: 'sirimillavinay.online' },
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
