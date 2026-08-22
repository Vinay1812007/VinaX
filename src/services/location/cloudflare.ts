import type { RegionInfo } from '@/types';
import { isNativePlatform } from '@/services/native';

/**
 * Asks the Cloudflare Pages Function at /api/geo for coarse edge geo data.
 * The function reads CF-IPCountry / request.cf on the edge and returns ONLY
 * country + region name. The raw IP never reaches this client and is never
 * stored anywhere. Returns null on local dev or non-Cloudflare hosting.
 */
export async function fetchEdgeGeo(timeoutMs = 2500): Promise<RegionInfo | null> {
  // Skip on Capacitor — a relative fetch runs against file:// / capacitor://
  // localhost and always fails, wasting a request + AbortController timer on
  // every cold start (audit finding L1). Callers already fall back to
  // browser signals.
  if (isNativePlatform()) return null;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch('/api/geo', { signal: controller.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as { country?: string | null; region?: string | null };
    if (!data.country || data.country === 'XX') return null;
    return { country: data.country, regionLabel: data.region ?? null, source: 'edge' };
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}
