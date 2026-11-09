import '@/styles/festival-fx.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FESTIVALS } from '@/constants/festivals';
import { useFestivalNow } from '@/features/festival/festivalPreview';
import { burstInto, type FxSystem } from './particles';
import { onCelebrate, type Celebration } from './celebrate';
import { paletteOf } from './festivalFx';
import { playFestiveSound } from './sound';
import { useFxCanvas, useFestivalMotionAllowed } from './useFxCanvas';

/**
 * 1.12 — draws one-shot celebrations (celebrate.ts) over the whole app: a
 * pour of confetti, a volley of fireworks. Mounted once by FestiveSplash;
 * the canvas exists only while a celebration plays and goes away a second
 * after the last piece has fallen. Pointer events pass through it.
 */
export default function CelebrationLayer() {
  const allowed = useFestivalMotionAllowed();
  const { festival, theme } = useFestivalNow();
  const [active, setActive] = useState(false);
  const system = useRef<FxSystem | null>(null);
  // Every celebration of this run, replayed into a fresh system: the canvas
  // mounts after the first call (so it has no system yet), and a remount
  // (React's development double-mount) would otherwise lose the burst.
  const pending = useRef<Celebration[]>([]);
  const fallback = FESTIVALS.find((f) => f.id === 'diwali') ?? FESTIVALS[0]!;
  const palette = paletteOf(festival ?? theme ?? fallback);

  const into = (s: FxSystem, c: Celebration) => {
    if (c.palette?.length) s.palette = c.palette;
    burstInto(s, c.kind, c.at);
  };
  const fire = useCallback((c: Celebration) => {
    pending.current.push(c);
    if (system.current) into(system.current, c);
  }, []);

  useEffect(() => onCelebrate((c) => {
    if (c.sound) playFestiveSound(c.kind === 'fireworks' ? 'firework' : 'pop');
    if (!allowed) return;
    setActive(true);
    fire(c);
  }), [allowed, fire]);

  if (!active) return null;
  return (
    <Burst
      palette={palette}
      onSystem={(s) => { system.current = s; if (s) for (const c of pending.current) into(s, c); }}
      onIdle={() => { pending.current = []; setActive(false); }}
    />
  );
}

function Burst({ palette, onSystem, onIdle }: { palette: string[]; onSystem: (s: FxSystem | null) => void; onIdle: () => void }) {
  const ref = useFxCanvas(['confetti', 'fireworks'], palette, { burst: true, onSystem, onIdle });
  return <canvas ref={ref} className="fest-celebrate" data-testid="fest-celebrate" aria-hidden />;
}
