import { consented } from '@/services/analytics/telemetry';

/**
 * Session insights (heatmaps + anonymous session replays) — OPT-IN ONLY.
 *
 * The session-analytics tag loads only for listeners who ticked the analytics
 * opt-in at onboarding (the same consent that gates telemetry.ts), and only in
 * production builds. Privacy promises this module enforces in code, not just
 * in the provider dashboard:
 *   - every piece of on-screen text is masked on the device before upload
 *     (`data-clarity-mask` on <body>), so song titles, names, history and
 *     VinaX AI chats never appear in a replay — only layout, taps and scrolls;
 *   - the consent signal says analytics storage is granted and ad storage is
 *     denied — VinaX has no ads.
 *
 * Loaded from this module instead of an inline <head> snippet so the CSP's
 * sha256 hash list stays untouched (public/_headers, cspHashes.test.ts); the
 * tag's hosts are allowed in script-src / connect-src instead. Any change to
 * what this collects must be reflected in PrivacyPage.tsx and
 * docs/phase1/privacy-baseline.md BEFORE it ships.
 */
const PROJECT_ID = 'yghemvilpu';
const TAG_SRC = `https://www.clarity.ms/tag/${PROJECT_ID}`;

type TagFn = ((...args: unknown[]) => void) & { q?: unknown[][] };

declare global {
  interface Window {
    clarity?: TagFn;
  }
}

let loaded = false;

/** Start session insights if the listener opted in. Idempotent. */
export function initSessionInsights(isProd: boolean = import.meta.env.PROD): void {
  if (loaded || !isProd || !consented()) return;
  loaded = true;
  try {
    document.body.setAttribute('data-clarity-mask', 'True');
    // Command queue: calls made before the tag arrives are replayed by it.
    const tag: TagFn =
      window.clarity ??
      ((...args: unknown[]) => {
        (tag.q = tag.q ?? []).push(args);
      });
    window.clarity = tag;
    tag('consentv2', { ad_Storage: 'denied', analytics_Storage: 'granted' });
    const s = document.createElement('script');
    s.async = true;
    s.src = TAG_SRC;
    document.head.appendChild(s);
  } catch {
    /* insights are best-effort and must never affect playback */
  }
}

/** Test-only: forget that the tag was loaded. */
export function resetSessionInsightsForTest(): void {
  loaded = false;
}
