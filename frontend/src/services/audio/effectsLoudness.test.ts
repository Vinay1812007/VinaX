// @vitest-environment jsdom
/**
 * Loudness normalisation in the effects chain: the level gain and limiter in
 * the graph, the side meter, per-song measuring and the cached replay. jsdom
 * has no Web Audio, so a small fake AudioContext records nodes and lets the
 * test choose what the meter hears.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeParam {
  value: number;
  setTargetAtTime: ReturnType<typeof vi.fn>;
  cancelScheduledValues: ReturnType<typeof vi.fn>;
}
interface FakeNode {
  kind: string;
  edges: FakeNode[];
  disconnected: boolean;
  channelCount: number;
  channelCountMode: string;
  channelInterpretation: string;
  gain: FakeParam;
  frequency: FakeParam;
  Q: FakeParam;
  pan: FakeParam;
  threshold: FakeParam;
  knee: FakeParam;
  ratio: FakeParam;
  attack: FakeParam;
  release: FakeParam;
  type: string;
  fftSize: number;
  smoothingTimeConstant: number;
  connect: (to: FakeNode) => FakeNode;
  disconnect: () => void;
  getFloatTimeDomainData: (buf: Float32Array) => void;
  getByteFrequencyData: () => void;
}

const nodes: FakeNode[] = [];
/** The constant sample value every analyser reads (its RMS). */
let level = 0.1;

function param(v = 0): FakeParam {
  const p: FakeParam = {
    value: v,
    setTargetAtTime: vi.fn((target: number) => {
      p.value = target; // the glide's end point is all these tests need
    }),
    cancelScheduledValues: vi.fn(),
  };
  return p;
}

function node(kind: string): FakeNode {
  const n = {
    kind,
    edges: [],
    disconnected: false,
    channelCount: 2,
    channelCountMode: 'max',
    channelInterpretation: 'speakers',
    gain: param(1),
    frequency: param(350),
    Q: param(1),
    pan: param(0),
    threshold: param(-24),
    knee: param(30),
    ratio: param(12),
    attack: param(0.003),
    release: param(0.25),
    type: '',
    fftSize: 2048,
    smoothingTimeConstant: 0.8,
    connect(to: FakeNode) {
      n.edges.push(to);
      return to;
    },
    disconnect() {
      n.disconnected = true;
      n.edges = [];
    },
    getFloatTimeDomainData: (buf: Float32Array) => buf.fill(level),
    getByteFrequencyData: () => undefined,
  } as FakeNode;
  nodes.push(n);
  return n;
}

class FakeAudioContext {
  state = 'running';
  currentTime = 0;
  sampleRate = 48000;
  destination = node('destination');
  createMediaElementSource = () => node('source');
  createGain = () => node('gain');
  createChannelSplitter = () => node('splitter');
  createChannelMerger = () => node('merger');
  createBiquadFilter = () => node('biquad');
  createStereoPanner = () => node('panner');
  createPanner = () => Object.assign(node('panner3d'), { positionX: param(), positionY: param(), positionZ: param() });
  createConvolver = () => node('convolver');
  createBuffer = (_ch: number, len: number) => ({ getChannelData: () => new Float32Array(len) });
  createDynamicsCompressor = () => node('compressor');
  createAnalyser = () => node('analyser');
  resume = () => Promise.resolve();
}

vi.stubGlobal('AudioContext', FakeAudioContext);

const effects = await import('./effects');
const { attachEffects, detachEffects, applyEffects, setProcessing, setVocals, LIMITER, LIMITER_MAKEUP_DB, METER_BLOCKS, METER_FFT_SIZE, METER_INTERVAL_MS, K_SHELF_HZ, K_SHELF_DB, K_HIGHPASS_HZ } = effects;
const { LOUDNESS_KEY, cachedLoudness, storeLoudness, resetLoudnessMemory, MAX_LEVEL_DB } = await import('./loudness');

/** The sample value whose block loudness is `lufs` (constant signal: RMS = value). */
const valueFor = (lufs: number) => Math.sqrt(Math.pow(10, (lufs + 0.691 - 3.01) / 10));
const db = (gain: number) => 20 * Math.log10(gain);
/** The song's own levelling (dB): the level gain plus the limiter's makeup it offsets. */
const songDb = () => db(levelGain().gain.value) + LIMITER_MAKEUP_DB;

let el: HTMLAudioElement;
let clock = 0;
let paused = false;
let volume = 1;

function fakeElement(): HTMLAudioElement {
  const a = document.createElement('audio');
  Object.defineProperty(a, 'paused', { get: () => paused });
  Object.defineProperty(a, 'ended', { get: () => false });
  Object.defineProperty(a, 'currentTime', { get: () => clock });
  Object.defineProperty(a, 'volume', { get: () => volume });
  return a;
}

/** Play for `blocks` meter ticks. */
function play(blocks: number): void {
  for (let i = 0; i < blocks; i += 1) {
    clock += METER_INTERVAL_MS / 1000;
    vi.advanceTimersByTime(METER_INTERVAL_MS);
  }
}

const live = (kind: string) => nodes.filter((n) => n.kind === kind && !n.disconnected);
// 1.19.2 — balance feeds the spatial stage, whose output gain feeds the level gain.
const levelGain = () => live('compressor').length ? nodes.find((n) => !n.disconnected && n.kind === 'gain' && n.edges.includes(live('compressor')[0]))! : live('panner')[0].edges[0];
const compressor = () => live('compressor')[0];
const meter = () => live('analyser').find((n) => n.fftSize === METER_FFT_SIZE)!;

beforeEach(() => {
  vi.useFakeTimers();
  nodes.length = 0;
  localStorage.clear();
  resetLoudnessMemory();
  clock = 0;
  paused = false;
  volume = 1;
  level = valueFor(-8);
  el = fakeElement();
  applyEffects({ normalize: true });
});

afterEach(() => {
  detachEffects();
  setProcessing(true);
  setVocals('full');
  applyEffects({ normalize: false });
  vi.useRealTimers();
});

describe('1.19.2 spatial audio wiring', () => {
  afterEach(() => applyEffects({ spatial: false }));

  it('sits between balance and loudness: two HRTF speakers and a room beside a dry path', () => {
    attachEffects(el, { trackId: 'a' });
    const input = live('panner')[0].edges[0];
    const [dry, splitter, room] = input.edges;
    expect(splitter.kind).toBe('splitter');
    expect(room.kind).toBe('convolver');
    const speakers = live('panner3d');
    expect(speakers).toHaveLength(2);
    for (const p of speakers) expect(p).toMatchObject({ panningModel: 'HRTF' });
    const output = dry.edges[0];
    expect(output.edges).toEqual([levelGain()]);
    // Off: only the dry path is heard.
    expect(dry.gain.value).toBe(1);
    expect(speakers[0].edges[0].gain.value).toBe(0);
  });

  it('switching it on hands the song to the speakers and the room; Sound effects off flattens it', () => {
    attachEffects(el, { trackId: 'a' });
    const input = live('panner')[0].edges[0];
    const [dry, , room] = input.edges;
    const wet = live('panner3d')[0].edges[0];
    applyEffects({ spatial: true });
    expect(dry.gain.value).toBe(0);
    expect(wet.gain.value).toBe(1);
    expect(room.edges[0].gain.value).toBeGreaterThan(0);
    setProcessing(false);
    expect(dry.gain.value).toBe(1);
    expect(wet.gain.value).toBe(0);
    setProcessing(true);
  });

  it('detach disconnects the spatial nodes', () => {
    attachEffects(el, { trackId: 'a' });
    const parts = [...live('panner3d'), ...live('convolver')];
    detachEffects();
    for (const n of parts) expect(n.disconnected).toBe(true);
  });
});

describe('loudness wiring', () => {
  it('panner → level gain → limiter, and a dead-end K-weighted meter after the vocals stage', () => {
    attachEffects(el, { trackId: 'a' });
    const gain = levelGain();
    expect(gain.kind).toBe('gain');
    expect(gain.edges).toEqual([compressor()]);
    const shelf = nodes.find((n) => n.kind === 'biquad' && n.type === 'highshelf' && n.frequency.value === K_SHELF_HZ)!;
    expect(shelf.gain.value).toBe(K_SHELF_DB);
    const highpass = shelf.edges[0];
    expect(highpass).toMatchObject({ type: 'highpass' });
    expect(highpass.frequency.value).toBe(K_HIGHPASS_HZ);
    expect(highpass.edges).toEqual([meter()]);
    expect(meter().edges).toEqual([]);
    // The tap hangs off the vocals output, whose first edge is still the EQ.
    const vocalsOut = nodes.find((n) => n.edges.includes(shelf))!;
    expect(vocalsOut.edges[0]).toMatchObject({ kind: 'biquad', type: 'lowshelf' });
  });

  it('the compressor is only a peak limiter, not a squash', () => {
    attachEffects(el, { trackId: 'a' });
    const c = compressor();
    expect(c.threshold.value).toBe(LIMITER.threshold);
    expect(LIMITER.threshold).toBeGreaterThanOrEqual(-2);
    expect(c.ratio.value).toBeGreaterThanOrEqual(10);
    expect(c.attack.value).toBeLessThanOrEqual(0.003);
  });

  it("the level gain takes the compressor's own makeup gain back off", () => {
    // Web Audio: makeup = (1 / curve(0 dBFS))^0.6; with a hard knee curve(0) = T(1 - 1/ratio) dB.
    const curveAt0 = LIMITER.threshold * (1 - 1 / LIMITER.ratio);
    expect(LIMITER_MAKEUP_DB).toBeCloseTo(-0.6 * curveAt0, 6);
    attachEffects(el, { trackId: 'a' });
    expect(db(levelGain().gain.value)).toBeCloseTo(-LIMITER_MAKEUP_DB, 6); // unknown song: net 0 dB
    // A +9 dB boost on a 0 dBFS peak: limited, plus makeup, still below full scale.
    const peakIn = MAX_LEVEL_DB;
    const limited = LIMITER.threshold + (peakIn - LIMITER_MAKEUP_DB - LIMITER.threshold) / LIMITER.ratio;
    expect(limited + LIMITER_MAKEUP_DB).toBeLessThan(0);
  });

  it('detach disconnects the level gain and the meter', () => {
    attachEffects(el, { trackId: 'a' });
    const parts = [levelGain(), meter()];
    detachEffects();
    for (const n of parts) expect(n.disconnected).toBe(true);
  });
});

describe('levelling a song', () => {
  it('measures a first-time song, glides to the target and caches it', () => {
    attachEffects(el, { trackId: 'a' });
    expect(songDb()).toBeCloseTo(0, 6); // nothing known yet: 0 dB
    play(3);
    expect(songDb()).toBeCloseTo(-6, 1); // -8 LUFS → -14
    expect(levelGain().gain.setTargetAtTime).toHaveBeenCalled();
    expect(cachedLoudness('a')).toBeNull();
    play(METER_BLOCKS - 3);
    expect(cachedLoudness('a')).toBeCloseTo(-8, 1);
    expect(JSON.parse(localStorage.getItem(LOUDNESS_KEY)!)[0][0]).toBe('a');
  });

  it('a replay gets its cached level at once and is not measured again', () => {
    storeLoudness('a', -20);
    attachEffects(el, { trackId: 'a' });
    expect(songDb()).toBeCloseTo(6, 1);
    const reads = vi.spyOn(meter(), 'getFloatTimeDomainData');
    play(METER_BLOCKS);
    expect(reads).not.toHaveBeenCalled();
  });

  it('a new song on the same element resets to its own level', () => {
    storeLoudness('b', -11);
    attachEffects(el, { trackId: 'a' });
    play(METER_BLOCKS);
    attachEffects(el, { trackId: 'b' });
    expect(songDb()).toBeCloseTo(-3, 1);
  });

  it('never boosts or cuts more than 9 dB', () => {
    level = valueFor(-40);
    attachEffects(el, { trackId: 'quiet' });
    play(METER_BLOCKS);
    expect(songDb()).toBeCloseTo(MAX_LEVEL_DB, 1);
  });

  it('takes the element volume back out of the measurement', () => {
    volume = 0.5;
    level = valueFor(-8) * 0.5;
    attachEffects(el, { trackId: 'a' });
    play(METER_BLOCKS);
    expect(cachedLoudness('a')).toBeCloseTo(-8, 1);
  });

  it('does not count paused time, silence or karaoke', () => {
    attachEffects(el, { trackId: 'a' });
    paused = true;
    play(METER_BLOCKS);
    paused = false;
    level = 0;
    play(3); // short of the tainted-source probe's 1.5 s, which would detach the chain
    level = valueFor(-8);
    setVocals('off');
    play(METER_BLOCKS);
    expect(cachedLoudness('a')).toBeNull();
    expect(songDb()).toBeCloseTo(0, 6);
  });

  it('off (or Sound effects off) is 0 dB with a transparent compressor and no metering', () => {
    storeLoudness('a', -20);
    applyEffects({ normalize: false });
    attachEffects(el, { trackId: 'a' });
    expect(levelGain().gain.value).toBe(1);
    expect(compressor().ratio.value).toBe(1);
    attachEffects(el, { trackId: 'b' });
    play(METER_BLOCKS);
    expect(cachedLoudness('b')).toBeNull();
    applyEffects({ normalize: true });
    attachEffects(el, { trackId: 'a' });
    expect(songDb()).toBeCloseTo(6, 1);
    setProcessing(false);
    expect(levelGain().gain.value).toBe(1);
  });
});
