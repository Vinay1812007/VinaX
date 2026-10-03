import { useState } from 'react';
import { Row, RowButton, Toggle } from '@/features/settings/SettingsControls';
import { useSettingsStore } from '@/store/settingsStore';
import { resolveRegion } from '@/services/location/inference';
import { toast } from '@/store/toastStore';
import { describeRegion, describeRegionSource, REGION_USES } from './describeRegion';
import { useRegion } from './useRegion';

/**
 * 9.1.0 — the place-context controls, in one row a listener can act on.
 *
 * 9.0 offered a toggle whose note said only `Now: IN (edge)`, and two override
 * dropdowns. There was no way to see what had actually been resolved (no city,
 * no time zone, no "when"), no way to ask again after moving or switching off a
 * VPN, and nothing anywhere said what the value is used for.
 *
 * This row shows the resolved value in full, says where it came from and when,
 * states plainly what it is used for, and offers Refresh. Turning the toggle off
 * clears the inferred value immediately rather than leaving the last one behind.
 */
export function LocationRow() {
  const allow = useSettingsStore((s) => s.allowRegionInference);
  const setAllow = useSettingsStore((s) => s.setAllowRegionInference);
  const setInferred = useSettingsStore((s) => s.setInferredRegion);
  const region = useRegion();
  const [busy, setBusy] = useState(false);

  const refresh = async (): Promise<void> => {
    setBusy(true);
    try {
      const s = useSettingsStore.getState();
      const next = await resolveRegion({
        allowInference: s.allowRegionInference,
        manualCountry: s.manualCountry,
        manualRegionLabel: s.manualRegionLabel,
        refresh: true,
      });
      setInferred(next);
      toast(next.country ? `Place context: ${describeRegion(next)}` : 'Your place could not be worked out.');
    } catch {
      toast('Could not check your place just now.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Row
        label="Allow region inference"
        note={`${REGION_USES} Now: ${describeRegion(region)} — ${describeRegionSource(region)}.`}
        keywords="location country ip city timezone region inference place"
      >
        <Toggle
          on={allow}
          label="Allow region inference"
          onChange={(v) => {
            setAllow(v);
            // Off means off now, not at the next cold start.
            if (!v) setInferred(null);
            else void refresh();
          }}
        />
      </Row>
      <Row
        label="Check my place again"
        note="Ask the network edge once more — after moving, or after turning a VPN on or off."
        keywords="refresh location recheck vpn"
      >
        <RowButton onClick={() => void refresh()} disabled={busy || !allow} label="Check my place again">
          {busy ? 'Checking…' : 'Refresh'}
        </RowButton>
      </Row>
    </>
  );
}
