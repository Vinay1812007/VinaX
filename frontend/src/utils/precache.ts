/**
 * Asks the service worker (public/sw.js PRECACHE) to download the app's chunks
 * so every page opens with no network. Loaded after the page has loaded
 * (main.tsx), never in the first load.
 *
 * With Settings > Data saver on, or the browser's own data saver
 * (navigator.connection.saveData), it asks for the light precache: the shell,
 * the layout's chunks and the /offline, Library and Now Playing pages. Other pages are
 * fetched and cached the first time they open. On Wi-Fi or a wire (where the
 * browser says so) it still asks for everything, since that costs no data.
 * The Android app always asks for everything: offline launch onto /offline
 * with saved songs depends on it.
 */
import { Capacitor } from '@capacitor/core';
import { useSettingsStore } from '@/store/settingsStore';

export type PrecacheMode = 'full' | 'light';

interface Connection extends EventTarget {
  saveData?: boolean;
  /** 'wifi' | 'ethernet' | 'cellular' | … ; missing where the browser does not say. */
  type?: string;
}

export interface PrecacheFacts {
  native: boolean;
  dataSaver: boolean;
  saveData?: boolean;
  type?: string;
}

/** Full, unless data is being saved on a connection that is (or may be) metered. */
export function precacheMode(f: PrecacheFacts): PrecacheMode {
  if (f.native) return 'full';
  if (!f.dataSaver && !f.saveData) return 'full';
  return f.type === 'wifi' || f.type === 'ethernet' ? 'full' : 'light';
}

const connection = (): Connection | undefined => (navigator as Navigator & { connection?: Connection }).connection;

function currentMode(): PrecacheMode {
  const c = connection();
  return precacheMode({
    native: Capacitor.isNativePlatform(),
    dataSaver: useSettingsStore.getState().dataSaver,
    saveData: c?.saveData,
    type: c?.type,
  });
}

/** Precache now, when the network comes back, when a new worker takes over, and when the connection turns unmetered or Data saver is turned off. */
export function startPrecache(reg: ServiceWorkerRegistration): void {
  const precache = (): void => {
    try {
      const mode = currentMode();
      reg.active?.postMessage(mode === 'light' ? { type: 'PRECACHE', mode } : { type: 'PRECACHE' });
    } catch {
      /* ignore */
    }
  };
  precache();
  window.addEventListener('online', precache);
  navigator.serviceWorker.addEventListener('controllerchange', precache);
  // Data saver on a phone that moves onto Wi-Fi: the full precache is free now.
  try {
    connection()?.addEventListener('change', () => {
      if (currentMode() === 'full') precache();
    });
  } catch {
    /* older browsers: the next boot or 'online' event catches up */
  }
  // Settings > Data saver turned off: fetch the rest now, not at the next boot.
  useSettingsStore.subscribe((s, prev) => {
    if (prev.dataSaver && !s.dataSaver && currentMode() === 'full') precache();
  });
}
