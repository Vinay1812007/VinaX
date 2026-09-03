import { usePageTitle } from '@/hooks/usePageTitle';
import { MegaphoneIcon } from '@/components/Icons';

/**
 * v5.7.6 — Ads (placeholder). The sidebar seat exists now; sponsored
 * placements will be configured on this page later. Until then it states
 * plainly that nothing is live — no ad scripts, no trackers, nothing loads.
 */
export default function AdsPage() {
  usePageTitle('Ads');
  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">Ads</h1>
      <p className="text-sm text-ink-300 mb-8">Sponsored placements for VinaX.</p>
      <div className="rounded-3xl border border-dashed border-ink-700/60 bg-ink-850/40 px-6 py-14 text-center">
        <MegaphoneIcon className="w-10 h-10 mx-auto mb-4 text-ink-400" />
        <h2 className="text-lg font-semibold mb-1">Nothing here yet</h2>
        <p className="text-sm text-ink-300 max-w-sm mx-auto leading-relaxed">
          Ad placements are not configured yet. When sponsorships go live they will appear on this
          page — until then, listening stays exactly as clean as it is today.
        </p>
      </div>
    </div>
  );
}
