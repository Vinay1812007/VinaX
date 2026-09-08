/**
 * v5.19.0 — Web Audio effects chain (lazy module; never on the first-load path).
 *
 *   MediaElementSource → 5-band EQ (60 / 250 / 1k / 4k / 12k) → mono mix →
 *   StereoPanner (balance) → DynamicsCompressor (loudness) → Analyser → out
 *
 * One AudioContext per page, one source node per element (the Web Audio API
 * binds an element to its context permanently — the engine swaps in a fresh
 * element when the chain must come off). Every stage is always wired; an
 * "off" stage is set to its transparent parameters (0 dB, pan 0, stereo,
 * ratio 1) so toggles never re-patch the graph mid-stream.
 *
 * Mono sits BEFORE the panner on purpose: a listener with hearing in one ear
 * turns on mono and then steers the whole mix to that side with balance —
 * panning first and mixing after would throw the balance away.
 *
 * Tainted sources: a cross-origin file loaded without CORS reaches the graph
 * as digital silence. The probe watches the analyser while the element is
 * audibly playing and time is advancing; ~1.5 s of true zeros means the chain
 * is eating the audio, so it detaches and tells the engine to bypass.
 */
import { create } from 'zustand';

export const EQ_BANDS = [60, 250, 1000, 4000, 12000] as const;
export const EQ_BAND_LABELS = ['60', '250', '1k', '4k', '12k'] as const;
export const EQ_MAX_DB = 12;

/** Preset gains in dB, one per band (±EQ_MAX_DB). */
export const EQ_PRESETS: Record<string, number[]> = {
  flat: [0, 0, 0, 0, 0],
  bass: [6, 4, 0, 0, 0],
  vocal: [-2, 0, 3, 4, 1],
  treble: [0, 0, 0, 4, 6],
  loud: [5, 2, 0, 3, 5],
  podcast: [-4, 1, 4, 3, -2],
};

export const EQ_PRESET_LABELS: Record<string, string> = {
  flat: 'Flat',
  bass: 'Bass boost',
  vocal: 'Vocal',
  treble: 'Treble',
  loud: 'Loud',
  podcast: 'Podcast',
};

export interface EffectSettings {
  eqGains: number[];
  balance: number;
  mono: boolean;
  normalize: boolean;
}

export interface EffectsStatus {
  /** A graph is attached to the playing element. */
  active: boolean;
  /** The probe found silence: chain detached, direct playback restored. */
  bypassed: boolean;
}

/** UI-facing status ("Active" / "Not available for this source"). */
export const useEffectsStatus = create<EffectsStatus>()(() => ({ active: false, bypassed: false }));

/** Clamp a gain to ±EQ_MAX_DB and coerce anything non-finite to 0. */
export function clampGain(db: number): number {
  if (!Number.isFinite(db)) return 0;
  return Math.max(-EQ_MAX_DB, Math.min(EQ_MAX_DB, db));
}

/** Always exactly five clamped gains, whatever shape persisted state has. */
export function normalizeGains(gains: readonly number[] | undefined): number[] {
  return EQ_BANDS.map((_, i) => clampGain(gains?.[i] ?? 0));
}

export function clampBalance(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(-1, Math.min(1, v));
}

/** RMS below this is treated as digital silence (analyser float data). */
export const SILENCE_RMS = 1e-4;
/** Probe cadence and the number of consecutive silent samples (~1.5 s). */
export const PROBE_INTERVAL_MS = 250;
export const PROBE_SILENT_SAMPLES = 6;
/** Stop probing once this many audible samples have been seen (~8 s). */
const PROBE_MAX_AUDIBLE = 32;

/**
 * Pure bypass decision: `samples` are RMS readings taken ONLY while the
 * element was audibly playing and its clock advanced. Bypass once the last
 * `window` readings are all silent. Anything audible in that window resets
 * the verdict, so a quiet intro shorter than the window never trips it.
 */
export function shouldBypass(samples: readonly number[], window = PROBE_SILENT_SAMPLES): boolean {
  if (samples.length < window) return false;
  for (let i = samples.length - window; i < samples.length; i += 1) {
    if (!(samples[i] < SILENCE_RMS)) return false;
  }
  return true;
}

export function rmsOf(buf: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buf.length; i += 1) sum += buf[i] * buf[i];
  return Math.sqrt(sum / Math.max(1, buf.length));
}

interface Graph {
  el: HTMLAudioElement;
  source: MediaElementAudioSourceNode;
  eq: BiquadFilterNode[];
  mono: GainNode;
  panner: StereoPannerNode;
  compressor: DynamicsCompressorNode;
  analyser: AnalyserNode;
  probeTimer: number | null;
  probeSamples: number[];
  probeAudible: number;
  probeLastTime: number;
  onBypass?: () => void;
}

let ctx: AudioContext | null = null;
let graph: Graph | null = null;
let current: EffectSettings = { eqGains: [0, 0, 0, 0, 0], balance: 0, mono: false, normalize: false };

function getContext(): AudioContext | null {
  if (ctx) return ctx;
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }
  return ctx;
}

/** Resume a suspended context — call from the play path (a user gesture). */
export function resumeContext(): void {
  if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
}

/** Mirror the element's output device on the context (Chromium only). */
export function setEffectsSink(deviceId: string): void {
  const c = ctx as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null;
  if (c && typeof c.setSinkId === 'function') void c.setSinkId(deviceId).catch(() => undefined);
}

export function isAttached(el: HTMLAudioElement): boolean {
  return graph?.el === el;
}

function applyTo(g: Graph, s: EffectSettings): void {
  const gains = normalizeGains(s.eqGains);
  g.eq.forEach((f, i) => {
    f.gain.value = gains[i];
  });
  // Explicit channelCount 1 makes the gain node down-mix L+R; 2 passes stereo.
  g.mono.channelCount = s.mono ? 1 : 2;
  g.panner.pan.value = clampBalance(s.balance);
  if (s.normalize) {
    g.compressor.threshold.value = -24;
    g.compressor.knee.value = 30;
    g.compressor.ratio.value = 12;
    g.compressor.attack.value = 0.003;
    g.compressor.release.value = 0.25;
  } else {
    // Transparent: nothing above 0 dBFS to compress, 1:1 ratio, hard knee.
    g.compressor.threshold.value = 0;
    g.compressor.knee.value = 0;
    g.compressor.ratio.value = 1;
    g.compressor.attack.value = 0.003;
    g.compressor.release.value = 0.25;
  }
}

function stopProbe(g: Graph): void {
  if (g.probeTimer != null) {
    window.clearInterval(g.probeTimer);
    g.probeTimer = null;
  }
}

function startProbe(g: Graph): void {
  stopProbe(g);
  const buf = new Float32Array(g.analyser.fftSize);
  g.probeSamples = [];
  g.probeAudible = 0;
  g.probeLastTime = g.el.currentTime;
  g.probeTimer = window.setInterval(() => {
    const el = g.el;
    // Only count samples the listener should be hearing: playing, clock
    // moving, not muted, not inside a crossfade dip, context running.
    const advanced = el.currentTime > g.probeLastTime + 0.05;
    g.probeLastTime = el.currentTime;
    if (el.paused || el.ended || !advanced || el.muted || el.volume < 0.05) return;
    if (ctx && ctx.state !== 'running') return;
    g.analyser.getFloatTimeDomainData(buf);
    const rms = rmsOf(buf);
    g.probeSamples.push(rms);
    if (g.probeSamples.length > PROBE_SILENT_SAMPLES * 2) g.probeSamples.shift();
    if (rms >= SILENCE_RMS) {
      g.probeAudible += 1;
      if (g.probeAudible >= PROBE_MAX_AUDIBLE) stopProbe(g); // verdict: healthy
      return;
    }
    if (shouldBypass(g.probeSamples)) {
      const cb = g.onBypass;
      detachEffects();
      useEffectsStatus.setState({ active: false, bypassed: true });
      cb?.();
    }
  }, PROBE_INTERVAL_MS);
}

/**
 * Build (once per element) and wire the chain. Returns false when Web Audio
 * is unavailable. Re-attaching the same element is a no-op; a different
 * element replaces the previous graph.
 */
export function attachEffects(el: HTMLAudioElement, opts: { onBypass?: () => void } = {}): boolean {
  if (graph?.el === el) {
    graph.onBypass = opts.onBypass ?? graph.onBypass;
    return true;
  }
  const c = getContext();
  if (!c) return false;
  if (graph) detachEffects();
  let source: MediaElementAudioSourceNode;
  try {
    source = c.createMediaElementSource(el);
  } catch {
    // Already bound to another context, or the element is in a bad state.
    return false;
  }
  const eq = EQ_BANDS.map((hz, i) => {
    const f = c.createBiquadFilter();
    f.type = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking';
    f.frequency.value = hz;
    f.Q.value = 1;
    f.gain.value = 0;
    return f;
  });
  const mono = c.createGain();
  mono.channelCountMode = 'explicit';
  mono.channelInterpretation = 'speakers';
  mono.channelCount = 2;
  const panner = c.createStereoPanner();
  const compressor = c.createDynamicsCompressor();
  const analyser = c.createAnalyser();
  analyser.fftSize = 1024;

  let node: AudioNode = source;
  for (const f of eq) {
    node.connect(f);
    node = f;
  }
  node.connect(mono);
  mono.connect(panner);
  panner.connect(compressor);
  compressor.connect(analyser);
  analyser.connect(c.destination);

  graph = {
    el,
    source,
    eq,
    mono,
    panner,
    compressor,
    analyser,
    probeTimer: null,
    probeSamples: [],
    probeAudible: 0,
    probeLastTime: 0,
    onBypass: opts.onBypass,
  };
  applyTo(graph, current);
  const sink = (el as HTMLAudioElement & { sinkId?: string }).sinkId;
  if (sink) setEffectsSink(sink);
  resumeContext();
  startProbe(graph);
  useEffectsStatus.setState({ active: true, bypassed: false });
  return true;
}

/** Update the live chain (and remember the values for the next attach). */
export function applyEffects(s: Partial<EffectSettings>): void {
  current = { ...current, ...s };
  if (graph) applyTo(graph, current);
}

/** Disconnect the chain. The element stays bound to the context (Web Audio
 *  has no unbind), so the engine replaces it to restore direct playback. */
export function detachEffects(): void {
  const g = graph;
  if (!g) return;
  graph = null;
  stopProbe(g);
  try {
    g.source.disconnect();
    g.eq.forEach((f) => f.disconnect());
    g.mono.disconnect();
    g.panner.disconnect();
    g.compressor.disconnect();
    g.analyser.disconnect();
  } catch {
    /* already disconnected */
  }
  useEffectsStatus.setState((st) => ({ ...st, active: false }));
}

/** Forget a previous bypass verdict (a new song gets a fresh attempt). */
export function clearBypass(): void {
  if (useEffectsStatus.getState().bypassed) useEffectsStatus.setState({ bypassed: false });
}
