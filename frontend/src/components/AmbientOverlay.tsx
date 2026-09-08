import { useEffect, useState } from 'react';
import type { Song } from '@/types';
import { bestImage, FALLBACK_ART } from '@/utils/images';

/**
 * v5.17.0 — ambient mode. After a while without touching anything while a
 * song plays in Now Playing, the page settles into a calm screen: big
 * artwork, the song, a clock. Any tap, key or pointer move brings the
 * controls back. Great on a desk or a bedside table.
 */
const IDLE_MS = 45_000;

export function useIdle(active: boolean, ms = IDLE_MS): [boolean, () => void] {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (!active) {
      setIdle(false);
      return;
    }
    let t = window.setTimeout(() => setIdle(true), ms);
    const wake = () => {
      setIdle(false);
      window.clearTimeout(t);
      t = window.setTimeout(() => setIdle(true), ms);
    };
    const evs: Array<keyof WindowEventMap> = ['pointermove', 'pointerdown', 'keydown', 'touchstart', 'wheel'];
    for (const e of evs) window.addEventListener(e, wake, { passive: true });
    return () => {
      window.clearTimeout(t);
      for (const e of evs) window.removeEventListener(e, wake);
    };
  }, [active, ms]);
  return [idle, () => setIdle(false)];
}

export function AmbientOverlay({ song, onWake }: { song: Song; onWake: () => void }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(t);
  }, []);
  const art = bestImage(song.images, 500);
  return (
    <div
      role="presentation"
      onClick={onWake}
      className="fixed inset-0 z-[60] bg-black text-white flex flex-col items-center justify-center gap-6 select-none cursor-none animate-fade-up"
      aria-label="Ambient mode — tap to show controls"
    >
      <img src={art} onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)} alt="" className="w-[min(60vmin,420px)] h-[min(60vmin,420px)] rounded-3xl object-cover shadow-[0_30px_80px_rgba(0,0,0,0.6)] motion-safe:animate-[ambient-breathe_9s_ease-in-out_infinite]" />
      <div className="text-center px-6">
        <p className="text-xl font-extrabold tracking-tight truncate max-w-[80vw]">{song.title}</p>
        <p className="text-sm text-white/60 truncate max-w-[80vw]">{song.artists?.[0]?.name ?? song.subtitle}</p>
      </div>
      <p className="text-5xl font-extrabold tabular-nums tracking-tight text-white/80">{now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</p>
      <p className="text-[11px] text-white/40">Tap anywhere to bring the controls back</p>
    </div>
  );
}
