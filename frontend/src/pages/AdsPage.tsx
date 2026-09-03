import { useEffect, useRef } from 'react';
import { usePageTitle } from '@/hooks/usePageTitle';
import { MegaphoneIcon } from '@/components/Icons';

const AD_CLIENT = 'ca-pub-4235914042802141';
const AD_SCRIPT = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${AD_CLIENT}`;

/**
 * v5.7.7 — sponsored placements, scoped HARD to this page: the ad script is
 * injected only when the Ads page mounts, so every other screen keeps
 * loading zero ad scripts and zero trackers. Site ownership for the ad
 * network is proven by /ads.txt (public/ads.txt), so nothing ad-related has
 * to ride index.html. While the publisher account is still under review the
 * unit stays unfilled and the note below explains why.
 */
export default function AdsPage() {
  usePageTitle('Ads');
  const pushed = useRef(false);
  useEffect(() => {
    try {
      if (!document.querySelector('script[src^="https://pagead2.googlesyndication.com/"]')) {
        const s = document.createElement('script');
        s.src = AD_SCRIPT;
        s.async = true;
        s.crossOrigin = 'anonymous';
        document.head.appendChild(s);
      }
      if (!pushed.current) {
        pushed.current = true;
        const w = window as unknown as { adsbygoogle?: unknown[] };
        (w.adsbygoogle = w.adsbygoogle || []).push({});
      }
    } catch {
      /* ad blocker or offline — the page stays quiet and harmless */
    }
  }, []);
  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">Ads</h1>
      <p className="text-sm text-ink-300 mb-8">Sponsored placements for VinaX — shown only on this page.</p>
      <ins
        className="adsbygoogle block w-full rounded-3xl overflow-hidden"
        style={{ display: 'block', minHeight: 280 }}
        data-ad-client={AD_CLIENT}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
      <div className="mt-8 rounded-3xl border border-dashed border-ink-700/60 bg-ink-850/40 px-6 py-10 text-center">
        <MegaphoneIcon className="w-9 h-9 mx-auto mb-3 text-ink-400" />
        <h2 className="text-base font-semibold mb-1">Placements are being set up</h2>
        <p className="text-sm text-ink-300 max-w-sm mx-auto leading-relaxed">
          If the space above is empty, the ad account is still under review or no sponsor matched
          just now. Ads load only on this page — the rest of VinaX stays exactly as clean as today.
        </p>
      </div>
    </div>
  );
}
