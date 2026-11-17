/**
 * v5.19.0 — Web Audio effects chain (lazy module; never on the first-load path).
 *
 *   MediaElementSource → vocals (karaoke) → 5-band EQ (60 / 250 / 1k / 4k /
 *   12k) → mono mix → StereoPanner (balance) → level gain (loudness) →
 *   DynamicsCompressor (peak limiter) → Analyser → out
 *
 *   vocals → K-weighting shelf → high-pass → meter analyser (a side tap that
 *   measures the song's loudness; it goes nowhere else)
 *
 * One AudioContext per page, one source node per element (the Web Audio API
 * binds an element to its context permanently — the engine swaps in a fresh
 * element when the chain must come off). Every stage is always wired; an
 * "off" stage is set to its transparent parameters (0 dB, pan 0, stereo,
 * ratio 1) so toggles never re-patch the graph mid-stream.
 *
 * Loudness normalisation levels song against song, not the dynamics inside
 * one: the meter measures a song over its first ~10 s of playback, the level
 * gain moves it towards −14 LUFS (±9 dB, gliding), and the result is cached
 * per song id so a replay is levelled at once. The compressor then runs only
 * as a fast limiter just under 0 dBFS (its makeup gain taken back off in the
 * level gain), so a boosted song never clips. The
 * meter sits right after the vocals stage, before the listener's EQ, so the
 * stored value belongs to the song, not to today's EQ; it pauses while
 * karaoke changes the vocals.
 *
 * Mono sits BEFORE the panner on purpose: a listener with hearing in one ear
 * turns on mono and then steers the whole mix to that side with balance —
 * panning first and mixing after would throw the balance away.
 *
 * Vocals sits first, while the song is still the stereo the file holds: it
 * works by cancelling what is identical in both channels, so nothing that
 * mixes the channels may run before it. Karaoke is its only user, and it is
 * not one of the listener's sound effects (it runs even when the chain is
 * flat for disco lights).
 *
 * Tainted sources: a cross-origin file loaded without CORS reaches the graph
 * as digital silence. The probe watches the analyser while the element is
 * audibly playing and time is advancing; ~1.5 s of true zeros means the chain
 * is eating the audio, so it detaches and tells the engine to bypass.
 */
import { create } from 'zustand';
import { blockLoudness, cachedLoudness, dbToGain, integratedLoudness, levelGainDb, priorLoudness, storeLoudness } from './loudness';

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

// ── Karaoke vocals ────────────────────────────────────────────────────────
// A lead voice is usually mixed dead centre: the same signal in left and
// right. (L − R) cancels it, along with everything else in the centre — so
// bass and kick, also centred, come back from a low-passed mono copy of the
// original. A mono song is centre only and goes almost silent with vocals off.
// Off plays the side signal alike in both speakers (a phone's mono speaker
// would cancel an anti-phase pair); Low blends the dry song with the side
// signal in anti-phase, since a same-sign blend would tilt the mix to the left.
// On a mono speaker, Low therefore only lowers the whole song.

export type VocalMode = 'full' | 'low' | 'off';

export const VOCAL_MODES: ReadonlyArray<{ id: VocalMode; label: string }> = [
  { id: 'full', label: 'Full' },
  { id: 'low', label: 'Low' },
  { id: 'off', label: 'Off' },
];

/** Cut-off (Hz) of the low-passed copy that keeps bass and kick with the voice taken out. */
export const VOCAL_BASS_HZ = 180;
/** Gain on each leg of (L − R): 0.7 sits ~3 dB above the plain (L − R) / 2 side signal, since taking the centre out leaves the song quieter. */
export const VOCAL_SIDE_GAIN = 0.7;
/** Gain glide time constant (s) for a mode change, so switching never clicks. */
const VOCAL_GLIDE_S = 0.05;

export interface VocalMix {
  /** The untouched song. */
  dry: number;
  /** The (L − R) side signal, where a centred voice cancels, into the left output… */
  sideL: number;
  /** …and into the right. Off sends it to both alike (it survives a phone's mono
   *  speaker); Low sends it in anti-phase (R − L on the right) so the blend with
   *  the dry song stays balanced instead of leaning left. */
  sideR: number;
  /** The low-passed mono copy that keeps bass and kick. */
  bass: number;
}

/** How much of each path a mode mixes. Full is the song as it is; Low leaves the voice about 9 dB down; Off cancels it. */
export function vocalMix(mode: VocalMode): VocalMix {
  if (mode === 'off') return { dry: 0, sideL: 1, sideR: 1, bass: 1 };
  if (mode === 'low') return { dry: 0.35, sideL: 0.65, sideR: -0.65, bass: 0.65 };
  return { dry: 1, sideL: 0, sideR: 0, bass: 0 };
}

function isVocalMode(v: unknown): v is VocalMode {
  return v === 'full' || v === 'low' || v === 'off';
}

interface VocalNodes {
  /** Entry: forces two channels, so a mono source arrives as L = R. */
  input: GainNode;
  dry: GainNode;
  splitter: ChannelSplitterNode;
  /** +left and −right legs (fixed at ±VOCAL_SIDE_GAIN), summed in `side`. */
  left: GainNode;
  right: GainNode;
  /** One channel: the (L − R) side signal. */
  side: GainNode;
  /** How much side goes to each output channel (the mode sets these). */
  toLeft: GainNode;
  toRight: GainNode;
  merger: ChannelMergerNode;
  /** One channel: down-mixes L + R, then keeps only the low end. */
  low: BiquadFilterNode;
  bass: GainNode;
  output: GainNode;
}

function buildVocals(c: AudioContext): VocalNodes {
  const channels = (n: AudioNode, count: number) => {
    n.channelCountMode = 'explicit';
    n.channelInterpretation = 'speakers';
    n.channelCount = count;
  };
  const input = c.createGain();
  channels(input, 2);
  const dry = c.createGain();
  const splitter = c.createChannelSplitter(2);
  const left = c.createGain();
  left.gain.value = VOCAL_SIDE_GAIN;
  const right = c.createGain();
  right.gain.value = -VOCAL_SIDE_GAIN;
  const side = c.createGain();
  channels(side, 1);
  const toLeft = c.createGain();
  const toRight = c.createGain();
  const merger = c.createChannelMerger(2);
  const low = c.createBiquadFilter();
  low.type = 'lowpass';
  low.frequency.value = VOCAL_BASS_HZ;
  low.Q.value = Math.SQRT1_2;
  channels(low, 1);
  const bass = c.createGain();
  const output = c.createGain();
  channels(output, 2);

  input.connect(dry);
  dry.connect(output);
  input.connect(splitter);
  splitter.connect(left, 0);
  splitter.connect(right, 1);
  left.connect(side);
  right.connect(side);
  side.connect(toLeft);
  side.connect(toRight);
  toLeft.connect(merger, 0, 0);
  toRight.connect(merger, 0, 1);
  merger.connect(output);
  input.connect(low);
  low.connect(bass);
  bass.connect(output);
  return { input, dry, splitter, left, right, side, toLeft, toRight, merger, low, bass, output };
}

function setParam(p: AudioParam, v: number, glide: boolean, timeConstant = VOCAL_GLIDE_S): void {
  if (glide && ctx && typeof p.setTargetAtTime === 'function') {
    p.cancelScheduledValues(ctx.currentTime);
    p.setTargetAtTime(v, ctx.currentTime, timeConstant);
  } else {
    p.value = v;
  }
}

function applyVocals(v: VocalNodes, mode: VocalMode, glide: boolean): void {
  const mix = vocalMix(mode);
  setParam(v.dry.gain, mix.dry, glide);
  setParam(v.toLeft.gain, mix.sideL, glide);
  setParam(v.toRight.gain, mix.sideR, glide);
  setParam(v.bass.gain, mix.bass, glide);
}

interface Graph {
  el: HTMLAudioElement;
  source: MediaElementAudioSourceNode;
  vocals: VocalNodes;
  eq: BiquadFilterNode[];
  mono: GainNode;
  panner: StereoPannerNode;
  /** Loudness normalisation's per-song gain. */
  level: GainNode;
  compressor: DynamicsCompressorNode;
  analyser: AnalyserNode;
  /** K-weighting approximation and the analyser that measures loudness. */
  meter: { shelf: BiquadFilterNode; highpass: BiquadFilterNode; analyser: AnalyserNode };
  /** The song on the element (its id keys the loudness cache). */
  trackId: string | null;
  /** The song's loudness once known (cached or fully measured). */
  measured: number | null;
  /** K-weighted mean squares of the audible blocks measured so far. */
  meterBlocks: number[];
  meterTimer: number | null;
  meterLastTime: number;
  meterLastVolume: number;
  probeTimer: number | null;
  probeSamples: number[];
  probeAudible: number;
  probeLastTime: number;
  onBypass?: () => void;
}

let ctx: AudioContext | null = null;
let graph: Graph | null = null;
let current: EffectSettings = { eqGains: [0, 0, 0, 0, 0], balance: 0, mono: false, normalize: false };
/** False while the chain runs only so disco lights can hear the beat: every stage stays flat. */
let processing = true;
/** Karaoke's vocals level; not a sound effect, so `processing` never flattens it. */
let vocals: VocalMode = 'full';
const FLAT: EffectSettings = { eqGains: [0, 0, 0, 0, 0], balance: 0, mono: false, normalize: false };

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

// ── Loudness levelling ────────────────────────────────────────────────────

/** Meter block length: ~0.34 s at 48 kHz, close to BS.1770's 0.4 s blocks. */
export const METER_FFT_SIZE = 16384;
export const METER_INTERVAL_MS = 400;
/** Audible blocks that make a full measurement (~10 s of playback). */
export const METER_BLOCKS = 25;
/** Audible blocks before a first-time song's gain starts moving (~1.2 s). */
const METER_MIN_BLOCKS = 3;
/** K-weighting approximation: the BS.1770 head shelf and its low cut. */
export const K_SHELF_HZ = 1500;
export const K_SHELF_DB = 4;
export const K_HIGHPASS_HZ = 38;
/** Gain glides: a known level lands at once, a measurement moves gently. */
const LEVEL_SNAP_S = 0.03;
const LEVEL_SETTING_S = 0.25;
const LEVEL_MEASURE_S = 1.5;
/** The limiter: just under full scale, fast, near brick-wall. */
export const LIMITER = { threshold: -1.5, knee: 0, ratio: 20, attack: 0.001, release: 0.1 } as const;
/**
 * A Web Audio compressor adds its own makeup gain, (1 / curve(0 dBFS))^0.6:
 * about +0.9 dB for this limiter, on everything, which would also lift the
 * ceiling to about 0 dBFS. The level gain takes it back off, so songs land on
 * the target and a +9 dB boost still peaks below full scale.
 */
export const LIMITER_MAKEUP_DB = -0.6 * LIMITER.threshold * (1 - 1 / LIMITER.ratio);

function levelling(): boolean {
  return processing && current.normalize;
}

/** The song's levelling gain (dB): towards the target, ±MAX_LEVEL_DB. */
function songGainDb(g: Graph): number {
  if (g.measured != null) return levelGainDb(g.measured);
  if (g.meterBlocks.length >= METER_MIN_BLOCKS) return levelGainDb(integratedLoudness(g.meterBlocks));
  return levelGainDb(priorLoudness());
}

/** What the level gain node is set to: the song's gain, less the limiter's makeup. */
function levelDb(g: Graph): number {
  return levelling() ? songGainDb(g) - LIMITER_MAKEUP_DB : 0;
}

function applyLevel(g: Graph, timeConstant: number): void {
  setParam(g.level.gain, dbToGain(levelDb(g)), true, timeConstant);
}

function stopMeter(g: Graph): void {
  if (g.meterTimer != null) {
    window.clearInterval(g.meterTimer);
    g.meterTimer = null;
  }
}

/** Measure while levelling is on and this song's loudness is still unknown. */
function syncMeter(g: Graph): void {
  const wanted = levelling() && g.trackId != null && g.measured == null;
  if (!wanted) {
    stopMeter(g);
    return;
  }
  if (g.meterTimer != null) return;
  const buf = new Float32Array(g.meter.analyser.fftSize);
  g.meterLastTime = g.el.currentTime;
  g.meterLastVolume = g.el.volume;
  g.meterTimer = window.setInterval(() => meterTick(g, buf), METER_INTERVAL_MS);
}

function meterTick(g: Graph, buf: Float32Array<ArrayBuffer>): void {
  const el = g.el;
  const advanced = el.currentTime > g.meterLastTime + 0.05;
  const steady = Math.abs(el.volume - g.meterLastVolume) < 0.01;
  g.meterLastTime = el.currentTime;
  g.meterLastVolume = el.volume;
  // Only steady listening counts: playing, clock moving, not muted, not inside
  // a fade, the vocals as recorded, the context running.
  if (el.paused || el.ended || !advanced || !steady || el.muted || el.volume < 0.2) return;
  if (vocals !== 'full' || !ctx || ctx.state !== 'running') return;
  g.meter.analyser.getFloatTimeDomainData(buf);
  const rms = rmsOf(buf);
  // The element's volume scales what the graph hears; take it back out so the
  // stored value is the song's own.
  const meanSquare = (rms * rms) / (el.volume * el.volume);
  if (!(blockLoudness(meanSquare) > -70)) return; // silence does not count
  g.meterBlocks.push(meanSquare);
  if (g.meterBlocks.length >= METER_BLOCKS) {
    const lufs = integratedLoudness(g.meterBlocks);
    if (lufs != null && g.trackId) {
      g.measured = lufs;
      storeLoudness(g.trackId, lufs);
    }
    stopMeter(g);
  }
  if (g.meterBlocks.length >= METER_MIN_BLOCKS) applyLevel(g, LEVEL_MEASURE_S);
}

/** A new song on the element: its cached level lands at once, or it is measured. */
function setTrack(g: Graph, id: string | null): void {
  stopMeter(g);
  g.trackId = id;
  g.measured = id ? cachedLoudness(id) : null;
  g.meterBlocks = [];
  applyLevel(g, LEVEL_SNAP_S);
  syncMeter(g);
}

function applyTo(g: Graph, wanted: EffectSettings): void {
  const s = processing ? wanted : FLAT;
  const gains = normalizeGains(s.eqGains);
  g.eq.forEach((f, i) => {
    f.gain.value = gains[i];
  });
  // Explicit channelCount 1 makes the gain node down-mix L+R; 2 passes stereo.
  g.mono.channelCount = s.mono ? 1 : 2;
  g.panner.pan.value = clampBalance(s.balance);
  if (s.normalize) {
    // Only a peak limiter: the level gain does the levelling, this catches
    // what a boost pushes past full scale.
    g.compressor.threshold.value = LIMITER.threshold;
    g.compressor.knee.value = LIMITER.knee;
    g.compressor.ratio.value = LIMITER.ratio;
    g.compressor.attack.value = LIMITER.attack;
    g.compressor.release.value = LIMITER.release;
  } else {
    // Transparent: nothing above 0 dBFS to compress, 1:1 ratio, hard knee.
    g.compressor.threshold.value = 0;
    g.compressor.knee.value = 0;
    g.compressor.ratio.value = 1;
    g.compressor.attack.value = 0.003;
    g.compressor.release.value = 0.25;
  }
  applyLevel(g, LEVEL_SETTING_S);
  syncMeter(g);
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
export function attachEffects(el: HTMLAudioElement, opts: { onBypass?: () => void; trackId?: string } = {}): boolean {
  if (graph?.el === el) {
    graph.onBypass = opts.onBypass ?? graph.onBypass;
    if (opts.trackId !== undefined && opts.trackId !== graph.trackId) setTrack(graph, opts.trackId || null);
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
  const level = c.createGain();
  const compressor = c.createDynamicsCompressor();
  const analyser = c.createAnalyser();
  analyser.fftSize = 1024;
  const vocalNodes = buildVocals(c);
  const shelf = c.createBiquadFilter();
  shelf.type = 'highshelf';
  shelf.frequency.value = K_SHELF_HZ;
  shelf.gain.value = K_SHELF_DB;
  const highpass = c.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = K_HIGHPASS_HZ;
  highpass.Q.value = 0.5;
  const meterAnalyser = c.createAnalyser();
  meterAnalyser.fftSize = METER_FFT_SIZE;

  source.connect(vocalNodes.input);
  let node: AudioNode = vocalNodes.output;
  for (const f of eq) {
    node.connect(f);
    node = f;
  }
  node.connect(mono);
  mono.connect(panner);
  panner.connect(level);
  level.connect(compressor);
  compressor.connect(analyser);
  analyser.connect(c.destination);
  // The meter is a dead-end tap: an analyser is processed without an output.
  vocalNodes.output.connect(shelf);
  shelf.connect(highpass);
  highpass.connect(meterAnalyser);

  graph = {
    el,
    source,
    vocals: vocalNodes,
    eq,
    mono,
    panner,
    level,
    compressor,
    analyser,
    meter: { shelf, highpass, analyser: meterAnalyser },
    trackId: opts.trackId || null,
    measured: opts.trackId ? cachedLoudness(opts.trackId) : null,
    meterBlocks: [],
    meterTimer: null,
    meterLastTime: 0,
    meterLastVolume: 1,
    probeTimer: null,
    probeSamples: [],
    probeAudible: 0,
    probeLastTime: 0,
    onBypass: opts.onBypass,
  };
  applyTo(graph, current);
  applyLevel(graph, LEVEL_SNAP_S); // a known level is in place from the first note
  applyVocals(vocalNodes, vocals, false);
  const sink = (el as HTMLAudioElement & { sinkId?: string }).sinkId;
  if (sink) setEffectsSink(sink);
  resumeContext();
  startProbe(graph);
  useEffectsStatus.setState({ active: true, bypassed: false });
  return true;
}

/** Sound effects on (the listener's settings apply) or off (a flat chain, kept for disco lights). */
export function setProcessing(on: boolean): void {
  if (processing === on) return;
  processing = on;
  if (graph) applyTo(graph, current);
}

/**
 * Karaoke's vocals level. Takes effect at once on an attached chain (with a
 * short glide) and is remembered for the next attach; karaoke puts it back
 * to Full when it closes, so normal listening is never affected.
 */
export function setVocals(mode: VocalMode): void {
  const next = isVocalMode(mode) ? mode : 'full';
  if (next === vocals) return;
  vocals = next;
  if (graph) applyVocals(graph.vocals, vocals, true);
}

export function getVocals(): VocalMode {
  return vocals;
}

/** Web Audio exists in this browser at all (the chain can be built). */
export function hasWebAudio(): boolean {
  if (typeof window === 'undefined') return false;
  return !!(window.AudioContext ?? (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext);
}

/** Frequency-data smoothing for the beat reader. The probe reads time-domain
 *  data, which smoothing does not touch, so the two share one analyser. */
const SPECTRUM_SMOOTHING = 0.35;

/**
 * Fill `out` with the playing song's spectrum (0-255 per bin, low to high)
 * and return the width of one bin in Hz; 0 when no chain is attached or the
 * context is not running (nothing to read: the caller falls back).
 */
export function readSpectrum(out: Uint8Array<ArrayBuffer>): number {
  const g = graph;
  if (!g || !ctx || ctx.state !== 'running') return 0;
  if (g.analyser.smoothingTimeConstant !== SPECTRUM_SMOOTHING) g.analyser.smoothingTimeConstant = SPECTRUM_SMOOTHING;
  g.analyser.getByteFrequencyData(out);
  return ctx.sampleRate / g.analyser.fftSize;
}

/** Bins `readSpectrum` fills (half the analyser's FFT size). */
export const SPECTRUM_BINS = 512;

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
  stopMeter(g);
  try {
    g.source.disconnect();
    Object.values(g.vocals).forEach((n: AudioNode) => n.disconnect());
    g.eq.forEach((f) => f.disconnect());
    g.mono.disconnect();
    g.panner.disconnect();
    g.level.disconnect();
    g.compressor.disconnect();
    g.analyser.disconnect();
    g.meter.shelf.disconnect();
    g.meter.highpass.disconnect();
    g.meter.analyser.disconnect();
  } catch {
    /* already disconnected */
  }
  useEffectsStatus.setState((st) => ({ ...st, active: false }));
}

/** Forget a previous bypass verdict (a new song gets a fresh attempt). */
export function clearBypass(): void {
  if (useEffectsStatus.getState().bypassed) useEffectsStatus.setState({ bypassed: false });
}
