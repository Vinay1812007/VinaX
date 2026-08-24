import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useBanners, type PromoBannerData } from '@/features/home/useAppConfig';
import { getLocal, setLocal } from '@/services/storage/local';
import { useSettingsStore } from '@/store/settingsStore';

/**
 * Owner-published promo banner (Banner & Promotion in the admin). Renders at
 * most ONE banner — rotating daily when several are live — is dismissible per
 * banner id, and never renders in Kid mode. Zero layout shift while loading:
 * nothing is reserved until a banner actually exists.
 */
const DISMISSED_KEY = 'vinax.dismissed-banners.v1';

function linkPath(b: PromoBannerData): string | null {
  if (!b.linkType || !b.linkId) return null;
  if (b.linkType === 'song') return `/song/${encodeURIComponent(b.linkId)}`;
  if (b.linkType === 'album') return `/album/${encodeURIComponent(b.linkId)}`;
  if (b.linkType === 'playlist') return `/playlist/${encodeURIComponent(b.linkId)}`;
  if (b.linkType === 'artist') return `/artist/${encodeURIComponent(b.linkId)}`;
  return null;
}

export function PromoBanner({ className = '' }: { className?: string }) {
  const kidMode = useSettingsStore((s) => s.kidMode);
  const { data } = useBanners();
  const [dismissed, setDismissed] = useState<string[]>(() => getLocal<string[]>(DISMISSED_KEY, []));

  const banner = useMemo(() => {
    if (!data?.length) return null;
    const live = data.filter((b) => !dismissed.includes(b.id ?? b.title));
    if (!live.length) return null;
    // Rotate by day so multiple live campaigns share the slot fairly.
    const day = Math.floor(Date.now() / 86_400_000);
    return live[day % live.length];
  }, [data, dismissed]);

  if (kidMode || !banner) return null;
  const path = linkPath(banner);
  const key = banner.id ?? banner.title;

  const dismiss = () => {
    const next = [...dismissed, key].slice(-50);
    setDismissed(next);
    setLocal(DISMISSED_KEY, next);
  };

  const inner = (
    <div className="flex items-center gap-4 min-w-0">
      {banner.img && (
        <img src={banner.img} alt="" className="w-14 h-14 rounded-xl object-cover shrink-0" loading="lazy" />
      )}
      <div className="min-w-0">
        <p className="font-bold text-sm truncate">{banner.title}</p>
        {banner.subtitle && <p className="text-xs text-ink-400 truncate">{banner.subtitle}</p>}
      </div>
    </div>
  );

  return (
    <div className={`relative glass-card rounded-2xl p-4 pr-11 ${className}`}>
      {path ? (
        <Link to={path} className="block min-w-0 hover:opacity-90 transition">
          {inner}
        </Link>
      ) : (
        inner
      )}
      <button
        onClick={dismiss}
        aria-label="Dismiss banner"
        className="absolute top-3 right-3 w-7 h-7 rounded-full flex items-center justify-center text-ink-400 hover:text-ink-100 hover:bg-ink-800/50 transition"
      >
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}
