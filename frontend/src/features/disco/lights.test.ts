import { describe, it, expect } from 'vitest';
import { DiscoRenderer, FLASH_GAP_MS, hueOfTriplet, mixHue, paletteHues, type LightOptions } from './lights';

/** A canvas context that accepts every call and draws nothing. */
function fakeCtx(): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => undefined };
  return new Proxy({} as Record<string | symbol, unknown>, {
    get: (t, k) => (k in t ? t[k] : k === 'createLinearGradient' || k === 'createRadialGradient' ? () => gradient : () => undefined),
    set: (t, k, v) => {
      t[k] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

const opts = (o: Partial<LightOptions> = {}): LightOptions => ({ style: 'party', hues: [0, 120, 240], brightness: 1, speed: 1, flash: true, calm: false, ...o });
const hit = { beat: true, strength: 2, level: 1, sparkle: 1 };
const quiet = { beat: false, strength: 0, level: 0.2, sparkle: 0.1 };

/** A hard beat every `gap` ms for `ms`, 60 frames a second. */
function run(r: DiscoRenderer, o: LightOptions, gap: number, ms: number): void {
  const ctx = fakeCtx();
  let next = 0;
  for (let t = 0; t < ms; t += 1000 / 60) {
    const beat = t >= next;
    if (beat) next += gap;
    r.frame(ctx, 400, 800, 1000 / 60, beat ? hit : quiet, o);
  }
}

describe('colours', () => {
  it('reads the hue of an "R G B" triplet', () => {
    expect(hueOfTriplet('255 0 0')).toBe(0);
    expect(hueOfTriplet('0 255 0')).toBe(120);
    expect(hueOfTriplet('0 0 255')).toBe(240);
    expect(hueOfTriplet('128 128 128')).toBeNull();
    expect(hueOfTriplet('nonsense')).toBeNull();
    expect(hueOfTriplet(null)).toBeNull();
  });
  it('song colours build around the cover, with its opposite', () => {
    expect(paletteHues('artwork', '0 0 255')).toEqual([240, 275, 60, 205]);
    expect(paletteHues('artwork', null).length).toBeGreaterThan(1);
    expect(paletteHues('neon').length).toBeGreaterThan(1);
  });
  it('mixes hues the short way round', () => {
    expect(mixHue(350, 10, 0.5)).toBeCloseTo(0, 5);
    expect(mixHue(10, 350, 1)).toBeCloseTo(350, 5);
  });
});

describe('flash safety', () => {
  it('never flashes more than three times a second, however fast the beat', () => {
    const r = new DiscoRenderer(() => 0.5);
    run(r, opts(), 100, 3000);
    expect(r.flashCount).toBeLessThanOrEqual(Math.ceil(3000 / FLASH_GAP_MS));
    expect(r.flashCount).toBeLessThanOrEqual(9);
  });
  it('does not flash when the switch is off', () => {
    const r = new DiscoRenderer(() => 0.5);
    run(r, opts({ flash: false }), 500, 3000);
    expect(r.flashCount).toBe(0);
  });
  it('does not flash under reduced motion', () => {
    const r = new DiscoRenderer(() => 0.5);
    run(r, opts({ calm: true }), 500, 3000);
    expect(r.flashCount).toBe(0);
  });
  it('flashes on hard beats when allowed', () => {
    const r = new DiscoRenderer(() => 0.5);
    run(r, opts(), 500, 3000);
    expect(r.flashCount).toBeGreaterThanOrEqual(5);
  });
  it('draws every style without throwing', () => {
    for (const style of ['party', 'spotlights', 'lasers', 'wash'] as const) {
      expect(() => run(new DiscoRenderer(), opts({ style }), 400, 1000)).not.toThrow();
    }
  });
});
