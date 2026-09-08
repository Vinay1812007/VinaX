// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// No real AudioContext in jsdom — the pure bits must not need one, and the
// graph builder must degrade to "not attached" rather than throw.
vi.stubGlobal('AudioContext', undefined);

const effects = await import('./effects');
const {
  EQ_BANDS,
  EQ_PRESETS,
  EQ_PRESET_LABELS,
  EQ_MAX_DB,
  SILENCE_RMS,
  PROBE_SILENT_SAMPLES,
  clampGain,
  normalizeGains,
  clampBalance,
  shouldBypass,
  rmsOf,
  attachEffects,
  isAttached,
  useEffectsStatus,
} = effects;

describe('EQ_PRESETS (v5.19.0)', () => {
  const expected = ['flat', 'bass', 'vocal', 'treble', 'loud', 'podcast'];

  it('has the six named presets, each with a label', () => {
    expect(Object.keys(EQ_PRESETS).sort()).toEqual([...expected].sort());
    for (const id of expected) expect(typeof EQ_PRESET_LABELS[id]).toBe('string');
  });
  it('every preset has one gain per band, all within ±12 dB', () => {
    for (const gains of Object.values(EQ_PRESETS)) {
      expect(gains).toHaveLength(EQ_BANDS.length);
      for (const g of gains) {
        expect(Number.isFinite(g)).toBe(true);
        expect(Math.abs(g)).toBeLessThanOrEqual(EQ_MAX_DB);
      }
    }
  });
  it('flat is all zeros', () => {
    expect(EQ_PRESETS.flat).toEqual([0, 0, 0, 0, 0]);
  });
});

describe('gain clamping', () => {
  it('clamps to ±EQ_MAX_DB and zeroes non-finite values', () => {
    expect(clampGain(40)).toBe(EQ_MAX_DB);
    expect(clampGain(-40)).toBe(-EQ_MAX_DB);
    expect(clampGain(3.5)).toBe(3.5);
    expect(clampGain(NaN)).toBe(0);
    expect(clampGain(Infinity)).toBe(0);
  });
  it('normalizeGains always yields five clamped values', () => {
    expect(normalizeGains(undefined)).toEqual([0, 0, 0, 0, 0]);
    expect(normalizeGains([99])).toEqual([12, 0, 0, 0, 0]);
    expect(normalizeGains([1, 2, 3, 4, 5, 6, 7])).toEqual([1, 2, 3, 4, 5]);
  });
  it('clampBalance keeps -1..1', () => {
    expect(clampBalance(2)).toBe(1);
    expect(clampBalance(-2)).toBe(-1);
    expect(clampBalance(0.25)).toBe(0.25);
    expect(clampBalance(NaN)).toBe(0);
  });
});

describe('shouldBypass (silence probe decision)', () => {
  const silent = 0;
  const loud = 0.2;

  it('never bypasses before a full window of samples exists', () => {
    expect(shouldBypass([silent, silent, silent])).toBe(false);
    expect(shouldBypass([])).toBe(false);
  });
  it('bypasses once the last window is entirely silent', () => {
    expect(shouldBypass(Array(PROBE_SILENT_SAMPLES).fill(silent))).toBe(true);
  });
  it('a single audible sample inside the window vetoes the bypass', () => {
    const s = Array(PROBE_SILENT_SAMPLES).fill(silent);
    s[PROBE_SILENT_SAMPLES - 2] = loud;
    expect(shouldBypass(s)).toBe(false);
  });
  it('only the trailing window counts — earlier audio does not rescue a dead chain', () => {
    const s = [loud, loud, ...Array(PROBE_SILENT_SAMPLES).fill(silent)];
    expect(shouldBypass(s)).toBe(true);
  });
  it('a quiet intro shorter than the window never trips it', () => {
    const s = [...Array(PROBE_SILENT_SAMPLES - 1).fill(silent), loud];
    expect(shouldBypass(s)).toBe(false);
  });
  it('treats readings at or above the threshold as audible', () => {
    const s = Array(PROBE_SILENT_SAMPLES).fill(SILENCE_RMS);
    expect(shouldBypass(s)).toBe(false);
  });
  it('rmsOf reads zero for digital silence and non-zero for a tone', () => {
    expect(rmsOf(new Float32Array(256))).toBe(0);
    const tone = new Float32Array(256).map((_, i) => Math.sin(i / 4) * 0.5);
    expect(rmsOf(tone)).toBeGreaterThan(SILENCE_RMS);
  });
});

describe('attachEffects without Web Audio', () => {
  beforeEach(() => useEffectsStatus.setState({ active: false, bypassed: false }));

  it('returns false, attaches nothing and leaves status inactive', () => {
    const el = document.createElement('audio');
    expect(attachEffects(el)).toBe(false);
    expect(isAttached(el)).toBe(false);
    expect(useEffectsStatus.getState()).toEqual({ active: false, bypassed: false });
  });
});
