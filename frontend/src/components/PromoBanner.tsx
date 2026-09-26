import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useBanners, type PromoBannerData } from '@/features/home/useAppConfig';
import { getLocal, setLocal } from '@/services/storage/local';
import { useSettingsStore } from '@/store/settingsStore';
import { IconButton } from './IconButton';
import { XIcon } from './Icons';

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
    <>
      {banner.img && <img src={banner.img} alt="" className="vxh-note-icon" width={40} height={40} loading="lazy" />}
      <span className="vxh-note-text">
        <span className="vxh-note-title">{banner.title}</span>
        {banner.subtitle && <span className="vxh-note-sub">{banner.subtitle}</span>}
      </span>
    </>
  );

  return (
    <div className={`vxh-note ${className}`}>
      {path ? (
        <Link to={path} className="vxh-note-link">
          {inner}
        </Link>
      ) : (
        inner
      )}
      <IconButton size="sm" label="Dismiss banner" onClick={dismiss}>
        <XIcon className="w-4 h-4" />
      </IconButton>
    </div>
  );
}
