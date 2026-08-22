import { useEffect, useMemo, useState } from 'react';
import { activeFestival } from '@/constants/festivals';
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

/** 3-second festival opening: themed confetti + greeting, once per day. */
export function FestiveSplash() {
  const festival = useMemo(() => activeFestival(), []);
  const todayKey = `${festival?.id ?? ''}-${new Date().toDateString()}`;
  const [visible, setVisible] = useState(
    () => !!festival && getLocal<string>(SEEN_KEY, '') !== todayKey,
  );
  const [leaving, setLeaving] = useState(false);

  const pieces = useMemo<Piece[]>(() => {
    if (!festival) return [];
    return Array.from({ length: 90 }, () => ({
      left: Math.random() * 100,
      delay: Math.random() * 1.2,
      duration: 1.8 + Math.random() * 1.4,
      size: 6 + Math.random() * 8,
      color: festival.colors[Math.floor(Math.random() * festival.colors.length)],
      rotate: Math.random() * 360,
      round: Math.random() > 0.5,
    }));
  }, [festival]);

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

  if (!visible || !festival) return null;

  return (
    <div
      className={`fixed inset-0 z-[90] flex items-center justify-center bg-ink-950/95 overflow-hidden transition-opacity duration-500 ${leaving ? 'opacity-0' : 'opacity-100'}`}
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
  );
}
