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
    let t = 0;
    let idle = 0;
    const go = () => {
      const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
      if (ric) idle = ric(() => setReady(true), { timeout: 2500 });
      else t = window.setTimeout(() => setReady(true), 1200);
    };
    if (document.readyState === 'complete') go();
    else window.addEventListener('load', go, { once: true });
    return () => {
      window.removeEventListener('load', go);
      window.clearTimeout(t);
      const cic = (window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
      if (idle && cic) cic(idle);
    };
  }, []);
  if (!allowed || !ready) return null;
  return <Sky festival={festival} />;
}

function Sky({ festival }: { festival: Festival }) {
  const ref = useFxCanvas(fxFor(festival.id), paletteOf(festival), { seed: festival.id.length * 131 });
  return <canvas ref={ref} className="fest-fx" data-testid="fest-fx" data-fx={fxFor(festival.id).join(' ')} aria-hidden />;
}
