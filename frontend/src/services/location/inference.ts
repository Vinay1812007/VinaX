import type { RegionInfo } from '@/types';
import { KEYS } from '@/constants/storage-keys';
import { getLocal, setLocal } from '@/services/storage/local';
import { browserRegionInfo, readBrowserSignals } from './browserSignals';
import { fetchEdgeGeo } from './cloudflare';

export interface ResolveOptions {
  allowInference: boolean;
  manualCountry: string | null;
  manualRegionLabel: string | null;
  /** Ignore the cached value and ask the edge again ("Refresh" in Settings). */
  refresh?: boolean;
  signal?: AbortSignal;
}

/** A cached edge answer is reused for this long before the edge is asked again. */
export const REGION_TTL_MS = 12 * 3_600_000;

/**
 * Resolve the listener's coarse place context, in this order:
 *
 *   1  manual override   whatever they chose in Settings. Nothing else is consulted.
 *   2  edge inference    /api/geo, only while "Allow region inference" is on.
 *   3  browser signals   locale country + IANA time zone. A device setting, not
 *                        a network inference, so it needs no edge round trip.
 *   4  unknown           said plainly rather than guessed.
 *
 * The time zone is attached from the browser whenever the edge did not supply
 * one, including under a manual override and when inference is off: it is the
 * device's own clock setting, which every web page can already read, and
 * "what time is it for this listener" is the part of place context that date
 * and time answers actually need.
 *
 * 9.1.0 — a fresh cached value is reused instead of re-asking the edge on every
 * cold start, `refresh` forces a new read, and nothing raw ever reaches here:
 * /api/geo returns coarse fields only, never an IP.
 */
export async function resolveRegion(opts: ResolveOptions): Promise<RegionInfo> {
  const browser = readBrowserSignals();
  const now = Date.now();
  if (opts.manualCountry) {
    const manual: RegionInfo = {
      country: opts.manualCountry,
      regionLabel: opts.manualRegionLabel,
      city: null,
      timezone: browser.timezone,
      source: 'manual',
      resolvedAt: now,
    };
    setLocal(KEYS.region, manual);
    return manual;
  }
  if (!opts.allowInference) {
    // Inference is off: nothing is inferred and nothing is kept. The time zone
    // still rides along — it is the device's setting, not an inference.
    const off: RegionInfo = { country: null, regionLabel: null, city: null, timezone: browser.timezone, source: 'unknown', resolvedAt: now };
    setLocal(KEYS.region, off);
    return off;
  }
  const cached = getLocal<RegionInfo | null>(KEYS.region, null);
  const fresh = !opts.refresh && cached?.source === 'edge' && !!cached.country && typeof cached.resolvedAt === 'number' && now - cached.resolvedAt < REGION_TTL_MS;
  if (fresh && cached) return { ...cached, timezone: cached.timezone ?? browser.timezone };

  const edge = await fetchEdgeGeo(2500, opts.signal);
  const resolved = edge ?? browserRegionInfo();
  if (resolved.country) {
    const out: RegionInfo = { ...resolved, timezone: resolved.timezone ?? browser.timezone, resolvedAt: now };
    setLocal(KEYS.region, out);
    return out;
  }
  // The edge said nothing AND the browser has no country: keep what we had
  // (clearly stale rather than silently wrong), else say unknown.
  if (cached?.country) return { ...cached, timezone: cached.timezone ?? browser.timezone };
  return { ...resolved, timezone: browser.timezone, resolvedAt: now };
}
