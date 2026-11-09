import { useEffect, useRef } from 'react';
import { useSettingsStore } from '@/store/settingsStore';
import { createSystem, draw, resize, step, type FxSystem } from './particles';
import type { FxKind } from './festivalFx';

/** True when nothing festive should move: the listener's switches, the system preference or data saver. */
export function useFestivalMotionAllowed(): boolean {
  const fx = useSettingsStore((s) => s.festivalFx);
  const reduce = useSettingsStore((s) => s.reduceMotion);
  const saver = useSettingsStore((s) => s.dataSaver);
  const system = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  return fx && !reduce && !saver && !system;
}

/** The device pixel ratio the sky draws at: crisp on a 2x phone, never the cost of 3x. */
export const FX_DPR_CAP = 1.5;

/**
 * Runs one particle system on a canvas: sizes it to its box (ResizeObserver),
 * steps it on requestAnimationFrame, pauses while the tab is hidden, and
 * throttles itself when frames run long (a slow phone drops to half the
 * pieces rather than half the frame rate). `setup` creates the system for
 * the first measured size; `onSystem` hands it back for bursts.
 */
export function useFxCanvas(kinds: FxKind[], palette: string[], o: { burst?: boolean; seed?: number; onSystem?: (s: FxSystem | null) => void; onIdle?: () => void; /** The device cannot afford even a thin sky: the caller takes the canvas down. */ onTooSlow?: () => void }): React.RefObject<HTMLCanvasElement | null> {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const key = `${kinds.join(',')}|${palette.join(',')}`;
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;
    let system: FxSystem | null = null;
    let raf = 0;
    let last = 0;
    let slow = 0;
    let idleFrames = 0;
    const dpr = Math.min(FX_DPR_CAP, window.devicePixelRatio || 1);
    const fit = () => {
      const w = canvas.clientWidth || window.innerWidth;
      const h = canvas.clientHeight || window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      if (!system) {
        system = createSystem(kinds, palette, w, h, { burst: o.burst, seed: o.seed });
        o.onSystem?.(system);
      } else resize(system, w, h);
    };
    // The ambient sky runs at 30 frames a second (a burst at the display's
    // rate); each frame's own cost is measured, and a device that cannot
    // afford it gets a thinner sky, then none — the music comes first.
    const interval = o.burst ? 0 : 1000 / 30;
    let acc = 0;
    let costSum = 0;
    let costN = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!system || document.hidden) { last = now; return; }
      const dt = last ? (now - last) / 1000 : 0.016;
      last = now;
      acc += dt * 1000;
      if (acc < interval) return;
      acc = 0;
      const t0 = performance.now();
      step(system, Math.max(dt, interval / 1000));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, system.w, system.h);
      draw(system, ctx);
      costSum += performance.now() - t0;
      if (++costN >= 45) {
        const avg = costSum / costN;
        costSum = 0; costN = 0;
        if (avg > 4) {
          if (system.maxParticles > 24) system.maxParticles = Math.max(24, Math.round(system.maxParticles * 0.6));
          else if (!o.burst && ++slow >= 2) { o.onTooSlow?.(); return; }
        } else slow = 0;
      }
      if (o.burst) {
        idleFrames = system.particles.length ? 0 : idleFrames + 1;
        if (idleFrames > 30) o.onIdle?.();
      }
    };
    fit();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
    ro?.observe(canvas);
    window.addEventListener('resize', fit);
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener('resize', fit);
      o.onSystem?.(null);
    };
    // The system is rebuilt when the festival (its effects or colours) changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, o.burst]);
  return ref;
}
