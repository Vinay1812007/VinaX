import './services/storage/earlyMigrations';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import App from './App';
import './styles/index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Boot succeeded: reset the shell's update-recovery counter.
try {
  window.sessionStorage.removeItem('vinax.bootRetry');
} catch {
  /* ignore */
}

// A deploy can remove old hashed chunks while a session is open; when a lazy
// route chunk fails to load, reload once to pick up the new build.
let reloadedForStaleChunk = false;
window.addEventListener('vite:preloadError', (event) => {
  if (reloadedForStaleChunk) return;
  reloadedForStaleChunk = true;
  event.preventDefault();
  window.location.reload();
});

// Device-class engine: html carries device-* and pointer-* classes so styles
// key on real capabilities (touch, hover, TV) instead of viewport width alone.
// A landscape tablet is wide like a laptop but must behave like touch.
function applyDeviceClass(): void {
  const el = document.documentElement;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const tv = /\b(TV|CrKey|SMART-TV|BRAVIA|Tizen|Web0S|WebOS|AFT[A-Z])\b/i.test(navigator.userAgent);
  const device = tv ? 'tv' : window.innerWidth < 768 ? 'phone' : coarse ? 'tablet' : 'desktop';
  el.classList.toggle('pointer-coarse', coarse);
  el.classList.toggle('pointer-fine', !coarse);
  for (const d of ['phone', 'tablet', 'desktop', 'tv']) el.classList.toggle(`device-${d}`, device === d);
}
applyDeviceClass();
// Coalesce burst resize events with a rAF-throttled scheduler so a
// desktop drag doesn't fire tens of classList toggles per second and
// force a style recalc each time (audit finding L4).
let deviceClassRaf = 0;
function scheduleApplyDeviceClass(): void {
  if (deviceClassRaf) return;
  deviceClassRaf = window.requestAnimationFrame(() => {
    deviceClassRaf = 0;
    applyDeviceClass();
  });
}
window.addEventListener('resize', scheduleApplyDeviceClass);
try {
  window.matchMedia('(pointer: coarse)').addEventListener('change', applyDeviceClass);
} catch {
  /* older WebViews: resize listener alone is fine */
}

// Progressive enhancement: register the app-shell service worker on the web
// (production only). Skipped inside the native shell. Failures are non-fatal.
const remoteOrigin =
  typeof location !== 'undefined' && /(^|\.)sirimillavinay\.online$/.test(location.hostname);
if (
  'serviceWorker' in navigator &&
  import.meta.env.PROD &&
  (!Capacitor.isNativePlatform() || remoteOrigin)
) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      /* ignore: the app works fine without a service worker */
    });
  });
}
