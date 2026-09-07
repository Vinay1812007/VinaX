import { useEffect, useState } from 'react';

/**
 * Reactive network status.
 *
 * v5.11.5 — `navigator.onLine === false` is a HINT, not a verdict. Chrome on
 * macOS reports it false with a perfectly working connection whenever a VPN or
 * virtual adapter confuses its interface detection (2026-09-07: the whole app
 * loaded, artwork and queue included, under a "You're offline" banner). So a
 * false reading is verified with a real request before anyone acts on it, and
 * re-verified every few seconds until it clears. `true` is trusted as-is.
 */
const PROBE_URL = '/manifest.webmanifest';
const RECHECK_MS = 15_000;

/** True when the network actually answers. HEAD passes straight through the
 *  service worker (it only handles GET), so a cached copy can never fake it;
 *  any HTTP status proves connectivity — only a thrown fetch means offline. */
export async function probeOnline(): Promise<boolean> {
  try {
    await fetch(PROBE_URL, { method: 'HEAD', cache: 'no-store', credentials: 'omit' });
    return true;
  } catch {
    return false;
  }
}

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    let alive = true;
    let timer = 0;
    const verify = (): void => {
      window.clearTimeout(timer);
      void probeOnline().then((ok) => {
        if (!alive) return;
        setOnline(ok);
        // Still offline by the real test: keep checking so the banner clears
        // itself the moment the network is back, even if no 'online' event fires.
        if (!ok) timer = window.setTimeout(verify, RECHECK_MS);
      });
    };
    const on = (): void => {
      window.clearTimeout(timer);
      setOnline(true);
    };
    const off = (): void => verify();
    const onVisible = (): void => {
      if (document.visibilityState === 'visible' && !navigator.onLine) verify();
    };
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    document.addEventListener('visibilitychange', onVisible);
    if (!navigator.onLine) verify();
    return () => {
      alive = false;
      window.clearTimeout(timer);
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return online;
}
