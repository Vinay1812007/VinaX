/*
 * ============================================================================
 *  WARNING (audit finding M-OPS-4) — server.url deploy model
 * ============================================================================
 *  This APK is a THIN SHELL over the remote origin (`server.url` below).
 *  Consequences every maintainer must understand:
 *
 *   - Any origin compromise (Cloudflare account, DNS provider, cert issuance
 *     for our zone) instantly ships attacker-controlled JS to EVERY installed
 *     copy of this app — no update prompt, no user action required.
 *   - A DNS or certificate outage on the origin turns every installed app
 *     into a blank white screen for the duration of the outage. There is no
 *     offline fallback shell shipped with the APK.
 *   - `allowMixedContent: false` + `androidScheme: 'https'` are load-bearing.
 *     Do NOT relax either without redoing the threat model.
 *
 *  RECOMMENDED LONG-TERM FIX: bundle `dist/` inside the APK (drop `server.url`
 *  or gate it behind a build flag) and use the remote origin only for a
 *  version-check OTA that swaps assets after signature validation. That
 *  removes the "one compromised origin ships JS to every phone" blast radius
 *  and gives us offline-launch capability out of the box.
 * ============================================================================
 */
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.tarang.music',
  appName: 'VinaX',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
  },
  server: {
    androidScheme: 'https',
    // Load the live web app so feature updates arrive over-the-air — no
    // reinstall. The service worker caches the shell for offline launches.
    // See top-of-file WARNING before changing.
    url: 'https://www.sirimillavinay.online',
  },
};

export default config;
