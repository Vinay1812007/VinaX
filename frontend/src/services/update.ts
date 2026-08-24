import { isNativePlatform } from '@/services/native';

export interface UpdateInfo {
  latest: string;        // latest version name (cosmetic, e.g. "1.1")
  current: string;       // installed version name
  latestBuild: number;   // latest build/versionCode (the real comparison)
  currentBuild: number;  // installed build/versionCode
  apkUrl: string;
  sha256?: string;
}

/** Public update manifest + APK proxy (served by Cloudflare; works for the
 *  private repo without exposing it). The app never talks to GitHub directly. */
const VERSION_ENDPOINT = 'https://www.sirimillavinay.online/api/version';
export const APK_URLS = ['https://www.sirimillavinay.online/api/apk'];

/**
 * Android update check. Compares the installed Android versionCode (build
 * number) against the latest published build — NOT the version name — so the
 * display name can change freely (e.g. reset to "1.1") without breaking
 * detection. Returns null on web or when no newer build exists.
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!isNativePlatform()) return null;
  try {
    const [{ CapacitorHttp }, { App }] = await Promise.all([
      import('@capacitor/core'),
      import('@capacitor/app'),
    ]);

    // Installed build (versionCode) + name, straight from the native package.
    let installedBuild = 0;
    let installedName = (__APP_VERSION__ || '').split('+')[0] || '0';
    try {
      const info = await App.getInfo();
      installedBuild = parseInt(info.build, 10) || 0;
      installedName = info.version || installedName;
    } catch {
      /* fall back to the JS-baked version below */
    }
    if (!installedBuild) {
      installedBuild = parseInt((__APP_VERSION__.split('+')[1] ?? '').replace(/\D/g, ''), 10) || 0;
    }

    // Native HTTP avoids any WebView CORS issues.
    const res = await CapacitorHttp.get({ url: VERSION_ENDPOINT, headers: { Accept: 'application/json' } });
    if (res.status !== 200) return null;
    const data = (typeof res.data === 'string' ? JSON.parse(res.data) : res.data) as {
      build?: number;
      version?: string;
      apkUrl?: string;
      sha256?: string;
    };

    const latestBuild = Number(data.build) || 0;
    if (!latestBuild || latestBuild <= installedBuild) {
      // Up to date — a previous install attempt evidently succeeded, so the
      // reinstall-guidance marker (if any) is stale. Clear it.
      try { localStorage.removeItem(KEYS.updateAttempt); } catch { /* ignore */ }
      return null;
    }

    return {
      latest: data.version ?? String(latestBuild),
      current: installedName,
      latestBuild,
      currentBuild: installedBuild,
      apkUrl: data.apkUrl || APK_URLS[0],
      sha256: data.sha256,
    };
  } catch (err) {
    console.error('[update] Failed to check for updates:', err);
    return null;
  }
}

export type InstallPhase = 'downloading' | 'installing';

// ---------------------------------------------------------------------------
// Install-attempt tracking (v4.13.3). There is no callback from the Android
// package installer, so the only reliable signal that an install DIDN'T take
// is the update dialog reappearing for the same build after an attempt.
// That state flips the dialog into the one-time reinstall guidance — the
// path legacy installs signed with the old (debug) key need, since Android
// permanently refuses cross-signature upgrades ("package conflicts with an
// existing package").
// ---------------------------------------------------------------------------
import { KEYS } from '@/constants/storage-keys';

interface UpdateAttempt {
  build: number;
  ts: number;
}

export function markUpdateAttempt(build: number): void {
  try {
    localStorage.setItem(KEYS.updateAttempt, JSON.stringify({ build, ts: Date.now() } satisfies UpdateAttempt));
  } catch {
    /* storage full/blocked — guidance just won't trigger */
  }
}

/** True when a previous attempt at THIS build didn't stick (installer opened,
 *  app relaunched, dialog is back). 10-minute floor avoids flagging the very
 *  first attempt while the installer is still open in front of the app. */
export function installLikelyBlocked(build: number): boolean {
  try {
    const raw = localStorage.getItem(KEYS.updateAttempt);
    if (!raw) return false;
    const a = JSON.parse(raw) as Partial<UpdateAttempt>;
    return a.build === build && typeof a.ts === 'number' && Date.now() - a.ts > 10 * 60_000;
  } catch {
    return false;
  }
}

/**
 * Fully in-app update: downloads the signed APK with native HTTP (no browser,
 * no CORS), writes it to app cache, and hands it to the Android package
 * installer. Requires REQUEST_INSTALL_PACKAGES (added in CI manifest patch) —
 * Android shows its own "allow updates from this app" consent the first time.
 */
export async function downloadAndInstall(
  apkUrl: string,
  onPhase: (phase: InstallPhase) => void,
  expectedHash?: string,
  expectedBuild?: number,
): Promise<void> {
  const [{ CapacitorHttp }, { Filesystem, Directory }, { FileOpener }] = await Promise.all([
    import('@capacitor/core'),
    import('@capacitor/filesystem'),
    import('@capacitor-community/file-opener'),
  ]);
  onPhase('downloading');
  // Try the provided update URL first, then fall back to the proxy.
  const candidates = [...new Set([apkUrl, ...APK_URLS])];
  let res: { status: number; data: unknown } | null = null;
  let lastError = '';
  for (const url of candidates) {
    try {
      res = await CapacitorHttp.get({
        url,
        responseType: 'blob', // returns base64 in res.data
        headers: { Accept: 'application/octet-stream' },
      });
      if (res.status === 200 && typeof res.data === 'string' && res.data.length > 1000) break;
      lastError = `HTTP ${res.status}`;
      res = null;
    } catch (err) {
      lastError = String(err);
      res = null;
    }
  }
  if (!res || typeof res.data !== 'string') {
    throw new Error(`Download failed (${lastError || 'no source reachable'})`);
  }
  // SHA-256 integrity verification. This gate MUST hold or an update from a
  // compromised CDN proxy / mis-configured server would silently ship
  // arbitrary code to the user's device (audit finding H6). Reject any hash
  // that isn't a 64-char hex string, and any download whose bytes don't
  // match — no more "warn and continue".
  const raw = Uint8Array.from(atob(res.data), (c) => c.charCodeAt(0));
  const hashBuffer = await crypto.subtle.digest('SHA-256', raw);
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const normalizedExpected = typeof expectedHash === 'string' ? expectedHash.trim().toLowerCase() : '';
  if (!/^[0-9a-f]{64}$/.test(normalizedExpected)) {
    throw new Error('APK integrity metadata missing: no valid SHA-256 provided by version manifest');
  }
  if (hashHex !== normalizedExpected) {
    throw new Error('APK integrity check failed: SHA-256 mismatch');
  }

  await Filesystem.writeFile({
    path: 'vinax-update.apk',
    data: res.data,
    directory: Directory.Cache,
  });
  const { uri } = await Filesystem.getUri({ path: 'vinax-update.apk', directory: Directory.Cache });
  onPhase('installing');
  await FileOpener.open({ filePath: uri, contentType: 'application/vnd.android.package-archive' });
  // Handed off to the Android installer — remember it. If the dialog is back
  // for this same build later, the install didn't take (see installLikelyBlocked).
  if (expectedBuild) markUpdateAttempt(expectedBuild);
}
