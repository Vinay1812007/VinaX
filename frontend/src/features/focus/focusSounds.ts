/**
 * 15.0 — focus and sleep sounds, synthesised on the device with WebAudio:
 * no files, no network. Four textures — rain, wind, brown noise, white
 * noise — each a noise source shaped by filters, with a slow swell so it
 * breathes rather than hisses. They play beside the music (or alone), at
 * their own volume, and stop on their own after the chosen time; the
 * player's sleep timer can also stop everything.
 *
 * The generator lives in a tiny store so the sheet in Now Playing and the
 * mini "Focus" chip can both read it. The AudioContext is created on the
 * first tap (browsers require a gesture) and released when stopped.
 */
import { create } from 'zustand';

export type FocusSound = 'rain' | 'wind' | 'brown' | 'white';
export const FOCUS_SOUNDS: Array<{ id: FocusSound; label: string; hint: string }> = [
  { id: 'rain', label: 'Rain', hint: 'Steady rain on a roof' },
  { id: 'wind', label: 'Wind', hint: 'A slow wind, far away' },
  { id: 'brown', label: 'Deep', hint: 'Low, warm noise for sleep' },
  { id: 'white', label: 'Hush', hint: 'Even noise that masks a room' },
];
export const FOCUS_MINUTES = [15, 30, 60, 0] as const; // 0 = until stopped

interface Graph { ctx: AudioContext; gain: GainNode; nodes: AudioNode[]; lfo?: OscillatorNode }

let graph: Graph | null = null;
let stopTimer: number | null = null;

/** A 4-second looping noise buffer: white, or brown (integrated, leaky). */
function noiseBuffer(ctx: AudioContext, kind: 'white' | 'brown'): AudioBuffer {
  const len = ctx.sampleRate * 4;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'white') data[i] = w * 0.5;
    else {
      last = (last + 0.02 * w) / 1.02;
      data[i] = last * 3.5;
    }
  }
  return buf;
}

function build(ctx: AudioContext, sound: FocusSound, volume: number): Graph {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, sound === 'brown' ? 'brown' : 'white');
  src.loop = true;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  const nodes: AudioNode[] = [src];
  let head: AudioNode = src;
  const filt = (type: BiquadFilterType, f: number, q = 0.7): BiquadFilterNode => {
    const n = ctx.createBiquadFilter();
    n.type = type;
    n.frequency.value = f;
    n.Q.value = q;
    head.connect(n);
    head = n;
    nodes.push(n);
    return n;
  };
  let lfo: OscillatorNode | undefined;
  if (sound === 'rain') {
    filt('highpass', 400);
    filt('lowpass', 6500, 0.5);
  } else if (sound === 'wind') {
    const bp = filt('bandpass', 500, 0.8);
    filt('lowpass', 1800);
    // The wind wanders: a very slow oscillator moves the band.
    lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const depth = ctx.createGain();
    depth.gain.value = 320;
    lfo.connect(depth).connect(bp.frequency);
    lfo.start();
    nodes.push(depth);
  } else if (sound === 'brown') {
    filt('lowpass', 500, 0.4);
  } else {
    filt('highpass', 120);
    filt('lowpass', 9000, 0.3);
  }
  head.connect(gain).connect(ctx.destination);
  src.start();
  gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + 1.6);
  return { ctx, gain, nodes, lfo };
}

async function teardown(fade = 0.8): Promise<void> {
  const g = graph;
  graph = null;
  if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
  if (!g) return;
  try {
    g.gain.gain.cancelScheduledValues(g.ctx.currentTime);
    g.gain.gain.linearRampToValueAtTime(0, g.ctx.currentTime + fade);
    await new Promise((r) => setTimeout(r, fade * 1000 + 50));
    for (const n of g.nodes) { try { (n as AudioScheduledSourceNode).stop?.(); } catch { /* not a source */ } n.disconnect(); }
    g.lfo?.stop();
    await g.ctx.close();
  } catch {
    /* already closed */
  }
}

interface FocusState {
  sound: FocusSound | null;
  volume: number;
  /** When the sound stops on its own (ms epoch), or null for "until stopped". */
  until: number | null;
  start(sound: FocusSound, minutes: number): void;
  setVolume(v: number): void;
  stop(): void;
}

export const useFocusStore = create<FocusState>()((set, get) => ({
  sound: null,
  volume: 0.35,
  until: null,
  start: (sound, minutes) => {
    void teardown(0.3).then(() => {
      if (typeof AudioContext === 'undefined') return;
      const ctx = new AudioContext();
      graph = build(ctx, sound, get().volume);
      const until = minutes > 0 ? Date.now() + minutes * 60_000 : null;
      if (until) stopTimer = window.setTimeout(() => get().stop(), minutes * 60_000);
      set({ sound, until });
    });
  },
  setVolume: (v) => {
    const volume = Math.max(0, Math.min(1, v));
    set({ volume });
    if (graph) graph.gain.gain.linearRampToValueAtTime(volume, graph.ctx.currentTime + 0.15);
  },
  stop: () => {
    set({ sound: null, until: null });
    void teardown();
  },
}));
