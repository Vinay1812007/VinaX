import { useSettingsStore } from '@/store/settingsStore';

/**
 * 1.12 — festive sounds, synthesised (no audio files): a confetti "pop", a
 * firework "whoosh-boom" and a soft chime. Off unless Settings → Appearance
 * → Festival sounds is on; silent when the browser refuses audio without a
 * gesture; never throws. Kept very short and quiet so it never fights music.
 */
export type FestiveSound = 'pop' | 'firework' | 'chime';

let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  try {
    const Ctor = (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
    if (!Ctor) return null;
    ctx ??= new Ctor();
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    return ctx;
  } catch {
    return null;
  }
}

function noise(ac: AudioContext, seconds: number): AudioBufferSourceNode {
  const buf = ac.createBuffer(1, Math.ceil(ac.sampleRate * seconds), ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = ac.createBufferSource();
  src.buffer = buf;
  return src;
}

export function festiveSoundsOn(): boolean {
  return useSettingsStore.getState().festivalSound;
}

/** Play one sound if the setting allows it. */
export function playFestiveSound(kind: FestiveSound): void {
  if (!festiveSoundsOn()) return;
  const ac = context();
  if (!ac) return;
  try {
    const t = ac.currentTime;
    const out = ac.createGain();
    out.gain.value = 0.16;
    out.connect(ac.destination);
    if (kind === 'pop') {
      const n = noise(ac, 0.12);
      const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 0.8;
      const g = ac.createGain(); g.gain.setValueAtTime(1, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      n.connect(f).connect(g).connect(out); n.start(t); n.stop(t + 0.14);
    } else if (kind === 'firework') {
      const whoosh = noise(ac, 0.7);
      const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.setValueAtTime(400, t); hp.frequency.exponentialRampToValueAtTime(3000, t + 0.6);
      const wg = ac.createGain(); wg.gain.setValueAtTime(0.0001, t); wg.gain.exponentialRampToValueAtTime(0.5, t + 0.3); wg.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
      whoosh.connect(hp).connect(wg).connect(out); whoosh.start(t); whoosh.stop(t + 0.75);
      const boom = noise(ac, 0.9);
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(900, t + 0.7); lp.frequency.exponentialRampToValueAtTime(120, t + 1.5);
      const bg = ac.createGain(); bg.gain.setValueAtTime(0.0001, t); bg.gain.setValueAtTime(1, t + 0.7); bg.gain.exponentialRampToValueAtTime(0.001, t + 1.6);
      boom.connect(lp).connect(bg).connect(out); boom.start(t + 0.7); boom.stop(t + 1.7);
    } else {
      for (const [i, freq] of [660, 880, 1320].entries()) {
        const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
        const g = ac.createGain(); const at = t + i * 0.09;
        g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.6, at + 0.02); g.gain.exponentialRampToValueAtTime(0.001, at + 0.9);
        o.connect(g).connect(out); o.start(at); o.stop(at + 1);
      }
    }
  } catch {
    /* audio is decoration */
  }
}
