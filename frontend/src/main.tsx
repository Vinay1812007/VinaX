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

// Lift the boot transition guard (index.html pre-paint script) once the first
// hydrated frame has painted — transitions behave normally from then on.
requestAnimationFrame(() =>
  requestAnimationFrame(() => document.documentElement.classList.remove('boot-still')),
);

// Boot succeeded: reset every recovery counter the boot shell uses.
try {
  window.sessionStorage.removeItem('vinax.bootRetry');
  window.sessionStorage.removeItem('vinax.bootPanicked');
  window.sessionStorage.removeItem('vinax.preloadReload');
} catch {
  /* ignore */
}

// A deploy can remove old hashed chunks while a session is open; when a lazy
// route chunk fails to load, reload once to pick up the new build. The retry
// counter now lives in sessionStorage (not a module-scoped variable) — a
// module-scoped guard resets on every reload, so a persistent CSP or network
// failure could bounce the page endlessly (v4.13.1 hotfix).
window.addEventListener('vite:preloadError', (event) => {
  // v5.3.1 — offline downloads: with no network a reload can never fetch the
  // missing chunk; it only makes the screen flash over and over. Stay put and
  // let the error boundary render instead (the service worker precaches the
  // full chunk graph now, so this is a rare last resort).
  if (!navigator.onLine) return;
  const KEY = 'vinax.preloadReload';
  let n = 0;
  try { n = Number(sessionStorage.getItem(KEY) || 0); } catch { /* ignore */ }
  if (n >= 1) return; // one reload per session, then stop and let the user see the error
  try { sessionStorage.setItem(KEY, '1'); } catch { /* proceed anyway */ }
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
    void navigator.serviceWorker.register('/sw.js').then((reg) => {
      // v4.13.2 — the previous SW served stale HTML pointing at asset chunks
      // the origin had rotated away, stranding users on the boot splash.
      // When a fresh SW installs, tell it to skipWaiting so the next
      // navigation gets fresh HTML instead of one more grace period.
      const nudge = (w: ServiceWorker | null): void => { if (w) w.postMessage({ type: 'SKIP_WAITING' }); };
      nudge(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed') nudge(reg.waiting);
        });
      });
      // v5.3.1 — offline downloads: ask the worker to download the full
      // chunk graph (see public/sw.js PRECACHE) so every page — Downloads
      // included — opens with no network. Refresh it on every boot and
      // whenever connectivity comes back, because sw.js itself rarely
      // changes between deploys and install-time precache alone would
      // never pick up new chunks.
      const precache = (): void => {
        try {
          reg.active?.postMessage({ type: 'PRECACHE' });
        } catch {
          /* ignore */
        }
      };
      precache();
      window.addEventListener('online', precache);
      navigator.serviceWorker.addEventListener('controllerchange', precache);
    }).catch(() => {
      /* ignore: the app works fine without a service worker */
    });
  });
}
