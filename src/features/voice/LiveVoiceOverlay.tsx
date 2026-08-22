import { useEffect, useRef, type MutableRefObject } from 'react';
import { cn } from '@/utils/cn';
import type { LiveVoiceState } from './liveVoiceEngine';

interface Props {
  state: LiveVoiceState;
  levelRef: MutableRefObject<number>;
  waveRef: MutableRefObject<Uint8Array | null>;
  muted: boolean;
  userCaption: string;
  aiCaption: string;
  error: string;
  voiceLabel: string;
  onInterrupt(): void;
  onToggleMute(): void;
  onEnd(): void;
}

const LABEL: Record<LiveVoiceState, string> = {
  idle: '',
  listening: 'Listening…',
  thinking: 'Thinking…',
  speaking: 'Speaking — tap the orb to interrupt',
};

/** Full-screen live-voice surface: an orb that breathes with your mic level,
 *  spins while thinking, ripples while speaking — with live captions. */
export function LiveVoiceOverlay({
  state,
  levelRef,
  waveRef,
  muted,
  userCaption,
  aiCaption,
  error,
  voiceLabel,
  onInterrupt,
  onToggleMute,
  onEnd,
}: Props) {
  const orbRef = useRef<HTMLButtonElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    // Older Safari (<16) and pre-2023 Firefox lack CanvasRenderingContext2D.roundRect;
    // feature-detect once outside the RAF loop so we can fall back to plain
    // rect() without paying an every-frame typeof check.
    const supportsRoundRect =
      typeof (CanvasRenderingContext2D.prototype as unknown as { roundRect?: unknown }).roundRect === 'function';
    let raf = 0;
    const drive = (): void => {
      try {
        orbRef.current?.style.setProperty('--lvl', levelRef.current.toFixed(3));
        const cv = canvasRef.current;
        const bins = waveRef.current;
        if (cv && bins) {
          const ctx = cv.getContext('2d');
          if (ctx) {
            const w = cv.width;
            const h = cv.height;
            ctx.clearRect(0, 0, w, h);
            const n = bins.length;
            const bw = w / n;
            for (let i = 0; i < n; i += 1) {
              const v = bins[i] / 255;
              const bh = Math.max(6, v * h * 0.92);
              const x = i * bw + bw * 0.24;
              const y = (h - bh) / 2;
              const g = n > 1 ? i / (n - 1) : 0;
              const r = Math.round(138 + (236 - 138) * g);
              const gr = Math.round(103 + (72 - 103) * g);
              const b = Math.round(255 + (153 - 255) * g);
              ctx.fillStyle = `rgba(${r}, ${gr}, ${b}, 0.95)`;
              ctx.beginPath();
              if (supportsRoundRect) ctx.roundRect(x, y, bw * 0.52, bh, 99);
              else ctx.rect(x, y, bw * 0.52, bh);
              ctx.fill();
            }
          }
        }
      } catch {
        /* a canvas throw here (context loss, older engines) must not kill the RAF loop */
      }
      raf = requestAnimationFrame(drive);
    };
    raf = requestAnimationFrame(drive);
    return () => cancelAnimationFrame(raf);
  }, [levelRef, waveRef]);

  const caption = error !== '' ? error : state === 'speaking' ? aiCaption : userCaption;
  return (
    <div className="lvo-bg fixed inset-0 z-[80] flex flex-col items-center justify-center gap-7 px-6" role="dialog" aria-label="Voice chat">
      <p className="h-4 text-[11px] font-bold uppercase tracking-[0.22em] text-ink-400">
        {error !== '' ? 'Voice chat stopped' : muted && state === 'listening' ? 'Mic muted' : LABEL[state]}
      </p>
      <button
        ref={orbRef}
        onClick={onInterrupt}
        aria-label={state === 'speaking' ? 'Interrupt' : 'Voice orb'}
        className={cn('lvo-orb', `lvo--${state}`, muted && state === 'listening' && 'lvo--muted')}
      >
        <i className="lvo-glow" />
        <i className="lvo-core" />
        <i className="lvo-ring" />
        <i className="lvo-ring lvo-ring-2" />
        {state === 'thinking' && (
          <span className="lvo-dots">
            <i />
            <i />
            <i />
          </span>
        )}
      </button>
      <canvas ref={canvasRef} width={640} height={112} className="h-14 w-[min(320px,72vw)]" aria-hidden />
      <div className="min-h-16 max-w-md text-center">
        <p className={cn('text-base leading-relaxed', state === 'speaking' ? 'text-ink-100' : 'text-ink-300 italic')}>
          {caption || (state === 'listening' && !muted ? 'Say something — I’m listening.' : '')}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleMute}
          className={cn(
            'px-4 py-2.5 rounded-full text-sm font-semibold transition',
            muted ? 'bg-ember-500 text-black' : 'bg-ink-800/80 text-ink-200 hover:text-ink-100',
          )}
        >
          {muted ? 'Unmute mic' : 'Mute mic'}
        </button>
        <button
          onClick={onEnd}
          className="px-4 py-2.5 rounded-full text-sm font-semibold bg-red-500/15 text-red-300 hover:bg-red-500/25 transition"
        >
          End voice chat
        </button>
      </div>
      {voiceLabel !== '' && <p className="-mt-3 text-[11px] text-ink-400">Voice: {voiceLabel}</p>}
    </div>
  );
}
