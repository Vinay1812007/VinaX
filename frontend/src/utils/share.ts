import { isNativePlatform } from '@/services/native';

const CANONICAL_ORIGIN = 'https://www.sirimillavinay.online';

/** Share an in-app route via Web Share API with clipboard fallback.
 *  Native WebViews report a localhost/capacitor origin — always share the real site. */
export async function shareLink(path: string, title: string): Promise<'shared' | 'copied' | 'failed'> {
  void import('@/services/analytics/telemetry').then((m) => m.trackShare()).catch(() => undefined);
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(window.location.origin);
  const base = isNativePlatform() || local ? CANONICAL_ORIGIN : window.location.origin;
  const url = `${base}${path}`;
  try {
    if (navigator.share) {
      await navigator.share({ title, url });
      return 'shared';
    }
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'failed';
  }
}
