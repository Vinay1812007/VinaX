// @vitest-environment jsdom
/**
 * Karaoke vocals stage of the effects chain: how it is wired into the graph
 * and how Full / Low / Off set its gains. jsdom has no Web Audio, so a small
 * fake AudioContext records every node and connection.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeParam {
  value: number;
  setTargetAtTime: ReturnType<typeof vi.fn>;
  cancelScheduledValues: ReturnType<typeof vi.fn>;
}
interface FakeNode {
  kind: string;
  edges: Array<{ to: FakeNode; output?: number; input?: number }>;
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
  connect: (to: FakeNode, output?: number, input?: number) => FakeNode;
  disconnect: () => void;
  getFloatTimeDomainData: () => void;
  getByteFrequencyData: () => void;
}

const nodes: FakeNode[] = [];

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
    connect(to: FakeNode, output?: number, input?: number) {
      n.edges.push(input === undefined ? { to, output } : { to, output, input });
      return to;
    },
    disconnect() {
      n.disconnected = true;
      n.edges = [];
    },
    getFloatTimeDomainData: () => undefined,
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
  createDynamicsCompressor = () => node('compressor');
  createAnalyser = () => node('analyser');
  resume = () => Promise.resolve();
}

vi.stubGlobal('AudioContext', FakeAudioContext);

const { attachEffects, detachEffects, setVocals, getVocals, setProcessing, vocalMix, hasWebAudio, VOCAL_BASS_HZ, VOCAL_SIDE_GAIN, VOCAL_MODES, EQ_BANDS } =
  await import('./effects');

/** The vocal stage's nodes, found by walking from the source. */
function stage() {
  const source = nodes.find((n) => n.kind === 'source' && !n.disconnected)!;
  const input = source.edges[0].to;
  const targets = input.edges.map((e) => e.to);
  const splitter = targets.find((n) => n.kind === 'splitter')!;
  const low = targets.find((n) => n.kind === 'biquad')!;
  const dry = targets.find((n) => n.kind === 'gain')!;
  const left = splitter.edges.find((e) => e.output === 0)!.to;
  const right = splitter.edges.find((e) => e.output === 1)!.to;
  const side = left.edges[0].to;
  const toLeft = side.edges[0].to;
  const toRight = side.edges[1].to;
  const merger = toLeft.edges[0].to;
  const bass = low.edges[0].to;
  const output = dry.edges[0].to;
  return { source, input, splitter, low, dry, left, right, side, toLeft, toRight, merger, bass, output };
}

/**
 * What the stage sends to the left and right outputs for one sample above the
 * bass cut-off (where the low-passed copy adds nothing), from the live gains.
 */
function play(L: number, R: number): [number, number] {
  const s = stage();
  const sideSig = s.left.gain.value * L + s.right.gain.value * R;
  return [s.dry.gain.value * L + s.toLeft.gain.value * sideSig, s.dry.gain.value * R + s.toRight.gain.value * sideSig];
}

let el: HTMLAudioElement;

beforeEach(() => {
  nodes.length = 0;
  el = document.createElement('audio');
});

afterEach(() => {
  detachEffects();
  setVocals('full');
  setProcessing(true);
});

describe('vocal mix', () => {
  it('offers Full, Low and Off', () => {
    expect(VOCAL_MODES.map((m) => m.id)).toEqual(['full', 'low', 'off']);
  });

  it('Full is the song untouched; Off keeps none of it dry', () => {
    expect(vocalMix('full')).toEqual({ dry: 1, sideL: 0, sideR: 0, bass: 0 });
    expect(vocalMix('off')).toEqual({ dry: 0, sideL: 1, sideR: 1, bass: 1 });
  });

  it('a centred voice (L = R) is left at the dry level: Full 0 dB, Low about 9 dB down, Off gone', () => {
    // Out = dry·x + gain·(x − x) + bass·lowpass(x): above the bass cut-off only the dry part is left.
    const centred = (mode: 'full' | 'low' | 'off') => vocalMix(mode).dry;
    expect(centred('full')).toBe(1);
    expect(20 * Math.log10(centred('low'))).toBeCloseTo(-9.1, 1);
    expect(centred('off')).toBe(0);
  });

  it('Low is a blend: the dry song and the cancelled one add back to the whole', () => {
    const m = vocalMix('low');
    expect(m.dry + m.sideL).toBeCloseTo(1);
    expect(m.sideL).toBe(m.bass);
    // Anti-phase on the right, so the blend does not lean to one side.
    expect(m.sideR).toBe(-m.sideL);
  });

  it('knows when Web Audio exists', () => {
    expect(hasWebAudio()).toBe(true);
  });
});

describe('vocal stage wiring', () => {
  it('sits first, between the source and the EQ, with dry, side and bass paths', () => {
    expect(attachEffects(el)).toBe(true);
    const s = stage();
    expect(s.source.edges.map((e) => e.to)).toEqual([s.input]);
    // The entry forces stereo so a mono source arrives as L = R.
    expect(s.input).toMatchObject({ channelCountMode: 'explicit', channelCount: 2, channelInterpretation: 'speakers' });
    expect(s.input.edges.map((e) => e.to.kind).sort()).toEqual(['biquad', 'gain', 'splitter']);
    expect(s.splitter.edges).toEqual([
      { to: s.left, output: 0 },
      { to: s.right, output: 1 },
    ]);
    // +L and −R sum to the one-channel side signal, which goes to each output through its own gain.
    expect(s.right.edges.map((e) => e.to)).toEqual([s.side]);
    expect(s.side).toMatchObject({ channelCountMode: 'explicit', channelCount: 1 });
    expect(s.side.edges.map((e) => e.to)).toEqual([s.toLeft, s.toRight]);
    expect(s.toLeft.edges).toEqual([{ to: s.merger, output: 0, input: 0 }]);
    expect(s.toRight.edges).toEqual([{ to: s.merger, output: 0, input: 1 }]);
    expect(s.left.gain.value).toBeCloseTo(VOCAL_SIDE_GAIN);
    expect(s.right.gain.value).toBeCloseTo(-VOCAL_SIDE_GAIN);
    // Every path meets at one stereo output.
    for (const n of [s.dry, s.merger, s.bass]) expect(n.edges.map((e) => e.to)).toEqual([s.output]);
    expect(s.output).toMatchObject({ channelCountMode: 'explicit', channelCount: 2 });
    // The bass copy is one channel (L + R down-mixed), low-passed.
    expect(s.low).toMatchObject({ type: 'lowpass', channelCountMode: 'explicit', channelCount: 1 });
    expect(s.low.frequency.value).toBe(VOCAL_BASS_HZ);
    expect(VOCAL_BASS_HZ).toBeGreaterThanOrEqual(150);
    expect(VOCAL_BASS_HZ).toBeLessThanOrEqual(200);
    // Then the EQ's first band (the low shelf), and on through the chain.
    const next = s.output.edges[0].to;
    expect(next.kind).toBe('biquad');
    expect(next.type).toBe('lowshelf');
    // The EQ bands, the bass copy and the loudness meter's two K-weighting filters.
    expect(nodes.filter((n) => n.kind === 'biquad')).toHaveLength(EQ_BANDS.length + 1 + 2);
  });

  it('attaches at Full: the stage is transparent', () => {
    attachEffects(el);
    const s = stage();
    expect(s.dry.gain.value).toBe(1);
    expect(s.toLeft.gain.value).toBe(0);
    expect(s.toRight.gain.value).toBe(0);
    expect(s.bass.gain.value).toBe(0);
    expect(play(0.5, -0.2)).toEqual([0.5, -0.2]);
  });

  it('detaching disconnects every vocal node', () => {
    attachEffects(el);
    const s = stage();
    detachEffects();
    for (const n of [s.input, s.dry, s.splitter, s.left, s.right, s.side, s.toLeft, s.toRight, s.merger, s.low, s.bass, s.output]) expect(n.disconnected).toBe(true);
  });
});

describe('vocal mode switching', () => {
  it('Off cancels the centre: L − R in both outputs, the bass copy in, nothing dry', () => {
    attachEffects(el);
    setVocals('off');
    const s = stage();
    expect(getVocals()).toBe('off');
    expect(s.dry.gain.value).toBe(0);
    expect(s.toLeft.gain.value).toBe(1);
    expect(s.toRight.gain.value).toBe(1);
    expect(s.bass.gain.value).toBe(1);
    expect(play(0.6, 0.6)).toEqual([0, 0]); // a centred voice is gone
    // Hard-left and hard-right parts stay, the same level in both speakers (a mono speaker keeps them).
    const [l1, r1] = play(1, 0);
    expect(l1).toBeCloseTo(VOCAL_SIDE_GAIN);
    expect(r1).toBeCloseTo(VOCAL_SIDE_GAIN);
    expect(Math.abs(play(0, 1)[0])).toBeCloseTo(VOCAL_SIDE_GAIN);
  });

  it('Low lowers a centred voice and keeps the sides balanced', () => {
    attachEffects(el);
    setVocals('low');
    const [cl, cr] = play(1, 1);
    expect(cl).toBeCloseTo(0.35);
    expect(cr).toBeCloseTo(0.35);
    // A part panned hard left comes out as the mirror image of one panned hard right.
    const [ll, lr] = play(1, 0);
    const [rl, rr] = play(0, 1);
    expect(ll).toBeCloseTo(rr);
    expect(lr).toBeCloseTo(rl);
    expect(ll).toBeGreaterThan(cl);
  });

  it('a live change glides instead of jumping (no click)', () => {
    attachEffects(el);
    const s = stage();
    setVocals('low');
    expect(s.dry.gain.setTargetAtTime).toHaveBeenCalledWith(0.35, 0, expect.any(Number));
    expect(s.dry.gain.cancelScheduledValues).toHaveBeenCalled();
    expect(s.toLeft.gain.setTargetAtTime).toHaveBeenCalledWith(0.65, 0, expect.any(Number));
    expect(s.toLeft.gain.value).toBeCloseTo(0.65);
    expect(s.toRight.gain.value).toBeCloseTo(-0.65);
  });

  it('a mode chosen before the chain attaches applies on attach', () => {
    setVocals('off');
    attachEffects(el);
    const s = stage();
    expect(s.dry.gain.value).toBe(0);
    expect(s.bass.gain.value).toBe(1);
  });

  it('back to Full restores the song exactly', () => {
    attachEffects(el);
    setVocals('off');
    setVocals('full');
    const s = stage();
    expect(s.dry.gain.value).toBe(1);
    expect(s.toLeft.gain.value).toBeCloseTo(0);
    expect(s.toRight.gain.value).toBeCloseTo(0);
    expect(s.bass.gain.value).toBe(0);
    expect(play(0.3, 0.9)).toEqual([0.3, 0.9]);
  });

  it('a flat chain (Sound effects off) still lowers the vocals', () => {
    setProcessing(false);
    attachEffects(el);
    setVocals('off');
    expect(stage().dry.gain.value).toBe(0);
  });

  it('ignores an unknown mode (falls back to Full)', () => {
    attachEffects(el);
    setVocals('off');
    setVocals('loud' as never);
    expect(getVocals()).toBe('full');
    expect(stage().dry.gain.value).toBe(1);
  });
});
