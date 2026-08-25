import { useEffect, useMemo, useState } from 'react';
import { resolveFestival, resolveFestivalTheme } from '@/constants/festivals';
import { useFestivalOverride } from '@/features/home/useAppConfig';
import { getLocal, setLocal } from '@/services/storage/local';
import { STORAGE_PREFIX } from '@/constants/storage-keys';

const SEEN_KEY = `${STORAGE_PREFIX}.festival-splash`;

interface Piece {
  left: number;
  delay: number;
  duration: number;
  size: number;
  color: string;
  rotate: number;
  round: boolean;
}


/** 24-spoke Ashoka Chakra, drawn inline — spins slowly via CSS. */
function Chakra() {
  return (
    <svg className="fest-chakra" viewBox="-50 -50 100 100" aria-hidden>
      <circle r="45" fill="none" stroke="currentColor" strokeWidth="6" />
      <circle r="7" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="2.6">
        {Array.from({ length: 24 }, (_, i) => {
          const a = (i * 15 * Math.PI) / 180;
          return <line key={i} x1={Math.sin(a) * 9} y1={-Math.cos(a) * 9} x2={Math.sin(a) * 41} y2={-Math.cos(a) * 41} />;
        })}
      </g>
    </svg>
  );
}

/**
 * 80th Independence Day living backdrop (owner request, 4.17.4): a waving
 * tricolor in the air (nine cloth strips rippling with staggered delays,
 * chakra turning slowly) and tricolor balls drifting upward. Everything is
 * transform/opacity only (compositor-friendly), pointer-events-none, behind
 * the app content, and neutralised by the global reduced-motion cascade.
 * Renders ONLY while the independence window is active — gone at midnight
 * into Aug 16 with zero cleanup.
 */
function IndependenceBackdrop() {
  return (
    <div className="fest-sky" aria-hidden>
      <div className="fest-flag">
        {Array.from({ length: 9 }, (_, i) => (
          <i key={i} style={{ animationDelay: `${i * 0.14}s` }} />
        ))}
        <Chakra />
      </div>
      {Array.from({ length: 14 }, (_, i) => (
        <b
          key={i}
          className={`fest-ball fb${i % 3}`}
          style={{
            left: `${(i * 73 + 9) % 96}%`,
            width: 14 + ((i * 5) % 18),
            height: 14 + ((i * 5) % 18),
            animationDelay: `${(i * 1.9) % 11}s`,
            animationDuration: `${10 + (i % 6) * 2.5}s`,
          }}
        />
      ))}
    </div>
  );
}

/** 3-second festival opening: themed confetti + greeting, once per day. */
export function FestiveSplash() {
  // Admin override (Festival Themes panel). Until the config answers, the
  // built-in calendar drives everything exactly as before — a forced or
  // suppressed festival simply catches up a moment after boot.
  const { data: override } = useFestivalOverride();
  const festival = useMemo(() => resolveFestival(override), [override]);
  const todayKey = `${festival?.id ?? ''}-${new Date().toDateString()}`;
  const [visible, setVisible] = useState(
    () => !!resolveFestival(null) && getLocal<string>(SEEN_KEY, '') !== todayKey,
  );
  const [leaving, setLeaving] = useState(false);

  // A festival arriving AFTER mount (admin force landing post-boot) still
  // gets its once-per-day splash; state initializers only run once.
  useEffect(() => {
    if (festival && getLocal<string>(SEEN_KEY, '') !== todayKey) {
      setLeaving(false);
      setVisible(true);
    }
    if (!festival) setVisible(false);
  }, [festival, todayKey]);

  const pieces = useMemo<Piece[]>(() => {
    if (!festival) return [];
    // 4.17.9 boot-cost pass: 90 confetti spans (each an animated compositor
    // layer) ran inside the LCP/TBT window on every cold load — PSI always
    // starts with empty storage, so every audited load paid for the full
    // spectacle. Density now scales with the screen that shows it: phones
    // get 40 pieces (visually identical at that width), larger screens 64.
    const pieceCount = window.innerWidth < 640 ? 40 : 64;
    return Array.from({ length: pieceCount }, () => ({
      left: Math.random() * 100,
      delay: Math.random() * 1.2,
      duration: 1.8 + Math.random() * 1.4,
      size: 6 + Math.random() * 8,
      color: festival.colors[Math.floor(Math.random() * festival.colors.length)],
      rotate: Math.random() * 360,
      round: Math.random() > 0.5,
    }));
  }, [festival]);

  // Festival skin (owner request; generalized from the 4.17.3 Independence
  // tricolor): EVERY festival now themes the whole app — accent ramp + top
  // ribbon + brand badge — via one html class (fest-<id>) the stylesheet
  // keys on. The skin runs from the day BEFORE the festival through its
  // last day (activeFestivalTheme), then auto-reverts. Independence keeps
  // its richer fest-ind treatment (flag backdrop) via the same class.
  useEffect(() => {
    const root = document.documentElement;
    const themeFest = resolveFestivalTheme(override);
    const wanted = themeFest ? `fest-${themeFest.id === 'independence' ? 'ind' : themeFest.id}` : null;
    for (const c of Array.from(root.classList)) if (c.startsWith('fest-') && c !== wanted) root.classList.remove(c);
    if (wanted) root.classList.add(wanted);
    return () => {
      for (const c of Array.from(document.documentElement.classList))
        if (c.startsWith('fest-')) document.documentElement.classList.remove(c);
    };
  }, [festival, override]);

  useEffect(() => {
    if (!visible || !festival) return;
    setLocal(SEEN_KEY, todayKey);
    const fade = window.setTimeout(() => setLeaving(true), 2500);
    const done = window.setTimeout(() => setVisible(false), 3000);
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(done);
    };
  }, [visible, festival, todayKey]);

  // 4.17.9: mount the living backdrop AFTER boot instead of at t=0. While the
  // splash is up the backdrop sits invisible behind a 95%-opaque overlay, so
  // mounting it with the splash was pure raster cost inside the exact window
  // Lighthouse measures (flag strips + chakra + 14 animated balls). It now
  // arrives as the splash starts fading (2.5 s) — a seamless reveal — or, on
  // splash-free visits, after the main thread first goes idle. The .fest-sky
  // ease-in keyframe makes the late mount read as intentional.
  const [backdropOn, setBackdropOn] = useState(false);
  useEffect(() => {
    if (festival?.id !== 'independence') return;
    if (visible) {
      const t = window.setTimeout(() => setBackdropOn(true), 2500);
      return () => window.clearTimeout(t);
    }
    let timer = 0;
    const arm = () => { timer = window.setTimeout(() => setBackdropOn(true), 1200); };
    const idle = 'requestIdleCallback' in window ? window.requestIdleCallback(arm, { timeout: 2500 }) : (arm(), 0);
    return () => {
      if (idle && 'cancelIdleCallback' in window) window.cancelIdleCallback(idle);
      window.clearTimeout(timer);
    };
  }, [festival, visible]);

  const backdrop = festival?.id === 'independence' && backdropOn ? <IndependenceBackdrop /> : null;
  if (!visible || !festival) return backdrop;

  return (
   <>
    {backdrop}
    <div
      className={`fixed inset-0 z-[90] flex items-center justify-center bg-ink-950/95 overflow-hidden pointer-events-none transition-opacity duration-500 ${leaving ? 'opacity-0' : 'opacity-100'}`}
      aria-hidden
    >
      {pieces.map((p, i) => (
        <span
          key={i}
          className="absolute top-[-4%] animate-confetti will-change-transform"
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.size * (p.round ? 1 : 0.45),
            background: p.color,
            borderRadius: p.round ? '50%' : '2px',
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            transform: `rotate(${p.rotate}deg)`,
          }}
        />
      ))}
      <div className="text-center animate-fade-up">
        <div className="text-6xl mb-4">{festival.emoji}</div>
        <p className="text-3xl font-bold tracking-tight">{festival.greeting}!</p>
        <p className="text-sm text-ink-300 mt-2">from VinaX</p>
      </div>
    </div>
   </>
  );
}
