import { lazy, Suspense, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { isNativePlatform } from '@/services/native';

/**
 * 13.7.4 — "Get the app" bar at the very top of the site for listeners on a
 * phone's browser (owner request). Android browsers are offered the Android
 * app (the /download page, which walks through installing the APK); iPhone
 * and iPad have no app to download, so Safari is offered the next best thing,
 * VinaX on the Home Screen, instead of a download that would not install.
 *
 * Not shown inside the Android app, in VinaX already added to an iPhone's Home
 * Screen, on desktop, or on the download page itself. "Not now" hides it for a
 * week on this device. Replaces the smaller Android-only note on Home.
 *
 * This file is the cheap part every visitor loads: which offer (if any) fits
 * this device. The bar itself is fetched only on phones; until it arrives a
 * placeholder of the same height holds its place, so nothing below it jumps.
 */
export type AppOffer = 'android' | 'ios' | null;

interface OfferContext {
  ua: string;
  native: boolean;
  /** Running as an installed web app (iOS Home Screen / display-mode standalone). */
  standalone: boolean;
  /** iPadOS reports a Mac user agent; touch points tell them apart. */
  maxTouchPoints: number;
  path: string;
}

export function appOfferFor({ ua, native, standalone, maxTouchPoints, path }: OfferContext): AppOffer {
  if (native || /^\/download\/?$/.test(path)) return null;
  if (/Android/i.test(ua)) return 'android';
  const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && maxTouchPoints > 1);
  return ios && !standalone ? 'ios' : null;
}

export const SNOOZE_KEY = 'vinax.getapp-bar.until';
export const SNOOZE_MS = 7 * 86_400_000;

export function snoozed(now = Date.now()): boolean {
  try {
    return Number(localStorage.getItem(SNOOZE_KEY) ?? 0) > now;
  } catch {
    return false;
  }
}

function currentOffer(path: string): AppOffer {
  if (typeof navigator === 'undefined') return null;
  const standalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches);
  return appOfferFor({
    ua: navigator.userAgent,
    native: isNativePlatform(),
    standalone,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    path,
  });
}

const GetAppBar = lazy(() => import('./GetAppBar'));

export function GetAppSlot() {
  const { pathname } = useLocation();
  const [hidden, setHidden] = useState(snoozed);
  const offer = currentOffer(pathname);
  if (!offer || hidden) return null;
  return (
    <Suspense fallback={<div className="vx-getapp" aria-hidden />}>
      <GetAppBar offer={offer} onHide={() => setHidden(true)} />
    </Suspense>
  );
}
