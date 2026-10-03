import type { RegionInfo } from '@/types';
import { isNativePlatform } from '@/services/native';

/**
 * The backend's coarse place endpoint (/api/geo), which reads `request.cf` at
 * the edge and returns country, region, approximate city and time zone. The
 * raw IP never reaches this client and is never stored.
 *
 * 9.1.0 — this works on Android again. 9.0 returned null on Capacitor outright
 * ("a relative fetch runs against capacitor://localhost and always fails"),
 * so the app NEVER had edge context and fell back to a nine-entry time-zone
 * table. It now calls the deployed origin by absolute URL on native, exactly
 * as the trends, DJ and playlist clients in this codebase already do. The
 * timeout and the "null means unknown" contract are unchanged, so every caller
 * still falls back to browser signals when the edge says nothing.
 */
export const GEO_ORIGIN = 'https://www.sirimillavinay.online';
export const geoEndpoint = (): string => (isNativePlatform() ? `${GEO_ORIGIN}/api/geo` : '/api/geo');

interface GeoBody {
  country?: unknown;
  region?: unknown;
  city?: unknown;
  timezone?: unknown;
  unknown?: unknown;
}

const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null);

/** Parse an /api/geo body. Null when it carries no usable country. */
export function readGeoBody(body: unknown, now = Date.now()): RegionInfo | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as GeoBody;
  const country = text(b.country, 2)?.toUpperCase() ?? null;
  // An older deployment answers { country, region, source } with no `unknown`.
  if (!country || !/^[A-Z]{2}$/.test(country) || country === 'XX' || country === 'T1') return null;
  return {
    country,
    regionLabel: text(b.region, 60),
    city: text(b.city, 80),
    timezone: text(b.timezone, 64),
    source: 'edge',
    resolvedAt: now,
  };
}

export async function fetchEdgeGeo(timeoutMs = 2500, signal?: AbortSignal): Promise<RegionInfo | null> {
  const controller = new AbortController();
  const relay = (): void => controller.abort();
  const timer = setTimeout(relay, timeoutMs);
  if (signal?.aborted) {
    clearTimeout(timer);
    return null;
  }
  signal?.addEventListener('abort', relay, { once: true });
  try {
    const res = await fetch(geoEndpoint(), { headers: { accept: 'application/json' }, signal: controller.signal });
    if (!res.ok) return null;
    return readGeoBody(await res.json());
  } catch {
    // Offline, timed out, local dev, or hosting that does not serve the route.
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', relay);
  }
}
