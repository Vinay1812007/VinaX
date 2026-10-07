import { lazy, Suspense } from 'react';
import { useFestivalNow } from '@/features/festival/festivalPreview';

// The banner (and the emblem art it draws) loads only while a festival is on.
const FestivalBanner = lazy(() => import('./FestivalBanner'));

export function FestivalBannerSlot() {
  const { festival } = useFestivalNow();
  if (!festival) return null;
  return (
    <Suspense fallback={null}>
      <FestivalBanner />
    </Suspense>
  );
}
