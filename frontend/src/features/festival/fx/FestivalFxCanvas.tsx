import '@/styles/festival-fx.css';
import { useEffect, useState } from 'react';
import type { Festival } from '@/constants/festivals';
import { fxFor, paletteOf } from './festivalFx';
import { useFxCanvas, useFestivalMotionAllowed } from './useFxCanvas';

/**
 * 1.12 — the live festival sky behind the app: the festival's effects
 * (fxFor) in its colours, on one canvas inside the ambient layer. It waits
 * for the page to load and the browser to go idle before it starts, so first
 * paint and the first song are never slower on a festival day; it stops the
 * moment festival animations, reduced motion or data saver say so.
 */
export default function FestivalFxCanvas({ festival }: { festival: Festival }) {
  const allowed = useFestivalMotionAllowed();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let idle = 0;
    // Not before the page has settled: after load, then on the listener's
    // first tap, click or key, then idle. A full-screen canvas painted on its
    // own is measured as the page's largest paint (it made the lab LCP 14 s
    // when it started on a timer), so it waits for a real touch: a listener
    // who never touches the page keeps the CSS particles and no sky.
    const EVENTS = ['pointerdown', 'touchstart', 'keydown'] as const;
    let armed = false;
    const start = () => {
      if (!armed) return;
      armed = false;
      for (const e of EVENTS) window.removeEventListener(e, start);
      const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
      if (ric) idle = ric(() => setReady(true), { timeout: 3000 });
      else setReady(true);
    };
    const go = () => {
      armed = true;
      for (const e of EVENTS) window.addEventListener(e, start, { passive: true, once: true });
    };
    if (document.readyState === 'complete') go();
    else window.addEventListener('load', go, { once: true });
    return () => {
      armed = false;
      window.removeEventListener('load', go);
      for (const e of EVENTS) window.removeEventListener(e, start);
      const cic = (window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
      if (idle && cic) cic(idle);
    };
  }, []);
  if (!allowed || !ready) return null;
  return <Sky festival={festival} />;
}

/** Remembered for the session: this device could not afford the sky, so it is not tried again on every page. */
let tooSlow = false;

function Sky({ festival }: { festival: Festival }) {
  const [off, setOff] = useState(tooSlow);
  const ref = useFxCanvas(fxFor(festival.id), paletteOf(festival), { seed: festival.id.length * 131, onTooSlow: () => { tooSlow = true; setOff(true); } });
  if (off) return null;
  return <canvas ref={ref} className="fest-fx" data-testid="fest-fx" data-fx={fxFor(festival.id).join(' ')} aria-hidden />;
}
