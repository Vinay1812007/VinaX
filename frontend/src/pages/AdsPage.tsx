import { useEffect, useRef } from 'react';
import { usePageTitle } from '@/hooks/usePageTitle';
import { MegaphoneIcon } from '@/components/Icons';
import { PageHeader } from '@/components/PageHeader';
import '@/styles/pages/secondary.css';

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
    <div className="vx-sec">
      <PageHeader title="Ads" subtitle="Sponsored placements, shown only on this page." />
      <ins
        className="adsbygoogle block w-full rounded-xl overflow-hidden"
        style={{ display: 'block', minHeight: 280 }}
        data-ad-client={AD_CLIENT}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
      <div className="vx-group is-padded mt-8 flex items-start gap-4">
        <span className="vx-row-lead" aria-hidden>
          <MegaphoneIcon className="w-5 h-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-ink-100">Placements are being set up</h2>
          <p className="mt-1 text-sm text-ink-400 leading-relaxed">
            If the space above is empty, the ad account is still under review or no sponsor matched just now. Ads load
            only on this page.
          </p>
        </div>
      </div>
    </div>
  );
}
