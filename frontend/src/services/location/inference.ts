import type { RegionInfo } from '@/types';
import { KEYS } from '@/constants/storage-keys';
import { getLocal, setLocal } from '@/services/storage/local';
import { browserRegionInfo } from './browserSignals';
import { fetchEdgeGeo } from './cloudflare';

export interface ResolveOptions {
  allowInference: boolean;
  manualCountry: string | null;
  manualRegionLabel: string | null;
}

/**
 * Resolution order: manual override > Cloudflare edge hint > browser signals.
 * Only coarse country/region labels are persisted; raw IPs are never seen by
 * this code and never stored.
 */
export async function resolveRegion(opts: ResolveOptions): Promise<RegionInfo> {
  if (opts.manualCountry) {
    const manual: RegionInfo = {
      country: opts.manualCountry,
      regionLabel: opts.manualRegionLabel,
      source: 'manual',
    };
    setLocal(KEYS.region, manual);
    return manual;
  }
  if (!opts.allowInference) {
    return { country: null, regionLabel: null, source: 'unknown' };
  }
  const cached = getLocal<RegionInfo | null>(KEYS.region, null);
  const edge = await fetchEdgeGeo();
  const resolved = edge ?? browserRegionInfo();
  if (resolved.country) {
    setLocal(KEYS.region, resolved);
    return resolved;
  }
  return cached ?? resolved;
}
