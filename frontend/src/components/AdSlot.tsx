import { useEffect, useRef } from 'react';
import { isNativePlatform } from '@/services/native';
import { useSettingsStore } from '@/store/settingsStore';

const AD_CLIENT = 'ca-pub-4235914042802141';
const AD_SCRIPT = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${AD_CLIENT}`;
/** Display unit id from the ad console. Empty until a unit is created: the
 *  slot then renders a responsive placement the network fills on its own. */
const AD_SLOT = '';

/**
 * 8.4.0 — one sponsored placement at the end of a browsing page (song,
 * artist, album, language and mood pages, Help). Never in the player, the
 * queue, VinaX AI, the Android app or Kid mode: the component renders nothing
 * there, so no ad script loads. The script is injected on first mount only.
 */
export function AdSlot({ className }: { className?: string }) {
  const kidMode = useSettingsStore((s) => s.kidMode);
  const hidden = kidMode || isNativePlatform();
  const pushed = useRef(false);
  useEffect(() => {
    if (hidden || pushed.current) return;
    try {
      if (!document.querySelector('script[src^="https://pagead2.googlesyndication.com/"]')) {
        const s = document.createElement('script');
        s.src = AD_SCRIPT;
        s.async = true;
        s.crossOrigin = 'anonymous';
        document.head.appendChild(s);
      }
      pushed.current = true;
      const w = window as unknown as { adsbygoogle?: unknown[] };
      (w.adsbygoogle = w.adsbygoogle || []).push({});
    } catch {
      /* ad blocker or offline — the page stays quiet and harmless */
    }
  }, [hidden]);
  if (hidden) return null;
  return (
    <aside className={className ?? 'vx-section'} aria-label="Advertisement">
      <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-400">Advertisement</p>
      <ins
        className="adsbygoogle block w-full overflow-hidden rounded-xl"
        style={{ display: 'block', minHeight: 100 }}
        data-ad-client={AD_CLIENT}
        {...(AD_SLOT ? { 'data-ad-slot': AD_SLOT } : {})}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </aside>
  );
}
