import { Row, RowButton } from '@/features/settings/SettingsControls';
import { toast } from '@/store/toastStore';
import { resetHomeDecision } from '@/services/home/homeBuilder';
import { invalidateRecommendationCache } from '@/services/recommendation/engine';
import { refreshHome } from './homeRefresh';
import { resetSessionHomeOrder } from './homeOrder';

/** Settings → Home: "Rebuild Home now". The change shows on the next Home build, never on the Home that is already open. */
export function HomeSettings() {
  const rebuild = (): void => {
    resetHomeDecision();
    resetSessionHomeOrder();
    invalidateRecommendationCache();
    refreshHome();
    toast('Home will be built again when you open it', { key: 'home-rebuild' });
  };
  return (
    <Row label="Rebuild Home now" note="Build a fresh Home the next time you open it." keywords="refresh home rebuild new shelves">
      <RowButton onClick={rebuild}>Rebuild</RowButton>
    </Row>
  );
}
