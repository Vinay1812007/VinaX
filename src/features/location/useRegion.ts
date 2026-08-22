import { useSettingsStore } from '@/store/settingsStore';
import type { RegionInfo } from '@/types';

/** Reactive resolved region: manual override wins, else inferred (coarse). */
export function useRegion(): RegionInfo | null {
  const manualCountry = useSettingsStore((s) => s.manualCountry);
  const manualRegionLabel = useSettingsStore((s) => s.manualRegionLabel);
  const inferred = useSettingsStore((s) => s.inferredRegion);
  if (manualCountry) {
    return { country: manualCountry, regionLabel: manualRegionLabel, source: 'manual' };
  }
  return inferred;
}
