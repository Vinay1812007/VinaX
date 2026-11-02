import { Block, Row, RowButton, Toggle } from '@/features/settings/SettingsControls';
import { Chip } from '@/components/Chip';
import { toast } from '@/store/toastStore';
import { HOME_SECTIONS } from '@/services/recommendation/homeDesign';
import { resetHomeDecision } from '@/services/home/homeBuilder';
import { invalidateRecommendationCache } from '@/services/recommendation/engine';
import { bringShelfBack, setHomeAiEnabled, useHomeAiPrefs } from './homeAiPrefs';
import { refreshHome } from './homeRefresh';
import { resetSessionHomeOrder } from './homeOrder';

/** Names a listener recognises for every shelf the AI can build, the two new ones included. */
const SHELF_NAMES: Record<string, string> = { ...HOME_SECTIONS, rightnow: 'Made for right now', generated: 'Generated for you', engine: 'Your personal engine shelves' };

/**
 * 1.4 — Settings → Home: the AI Home Builder's switch, "Rebuild Home now", and
 * the shelves the listener said they are not interested in, each with "Bring
 * back". Every change shows on the next Home build, never on the Home that is
 * already open.
 */
export function HomeAiSettings() {
  const prefs = useHomeAiPrefs();
  const rebuild = (): void => {
    resetHomeDecision();
    resetSessionHomeOrder();
    invalidateRecommendationCache();
    refreshHome();
    toast('Home will be built again when you open it', { key: 'home-rebuild' });
  };
  return (
    <>
      <Row
        label="Let AI build my Home"
        note="VinaX's AI picks which shelves you see, their order and their names for the time of day and your mood, from a short summary of your taste. Every song still comes from VinaX's own picks. Off: Home arranges itself on this device."
        keywords="ai home builder shelves layout order personalised"
      >
        <Toggle on={prefs.enabled} onChange={setHomeAiEnabled} label="Let AI build my Home" />
      </Row>
      <Row label="Rebuild Home now" note="Build a fresh Home the next time you open it." keywords="refresh home rebuild new shelves">
        <RowButton onClick={rebuild}>Rebuild</RowButton>
      </Row>
      <Block label="Shelves you are not interested in" note="Left out of every Home built from now on. Bring one back here." keywords="not interested shelf hidden home ai">
        {prefs.notInterested.length ? (
          <div className="flex flex-wrap gap-2">
            {prefs.notInterested.map((t) => (
              <Chip key={t} onClick={() => bringShelfBack(t)}>{`Bring back ${SHELF_NAMES[t] ?? t}`}</Chip>
            ))}
          </div>
        ) : (
          <p className="vx-set-now">None. Tap “Not interested” on a shelf to leave it out.</p>
        )}
      </Block>
    </>
  );
}
