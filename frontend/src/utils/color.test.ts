import { describe, expect, it } from 'vitest';
import { vibrantFromPixels } from './color';

/** Pixels from [r, g, b, count] runs. */
const px = (...runs: [number, number, number, number][]) => {
  const out: number[] = [];
  for (const [r, g, b, n] of runs) for (let i = 0; i < n; i++) out.push(r, g, b, 255);
  return new Uint8ClampedArray(out);
};
const rgb = (s: string | null) => s!.split(' ').map(Number);

describe('vibrantFromPixels — the song colour (--art)', () => {
  it('a blue sea on yellow sand is blue, not the grey their average makes', () => {
    const [r, g, b] = rgb(vibrantFromPixels(px([70, 130, 200, 300], [220, 190, 120, 200])));
    expect(b).toBeGreaterThan(r + 60);
    expect(b).toBeGreaterThan(g);
  });

  it('the strongest colour wins over a larger dull one', () => {
    const [r, g, b] = rgb(vibrantFromPixels(px([230, 40, 60, 120], [120, 110, 100, 400])));
    expect(r).toBeGreaterThan(g + 100);
    expect(r).toBeGreaterThan(b + 100);
  });

  it('black, white and grey artwork has no colour', () => {
    expect(vibrantFromPixels(px([0, 0, 0, 300], [250, 250, 250, 100], [120, 118, 116, 100]))).toBeNull();
  });

  it('a dark colour is lifted to a UI-safe brightness', () => {
    const [r, g, b] = rgb(vibrantFromPixels(px([10, 20, 90, 200])));
    expect(0.2126 * r + 0.7152 * g + 0.0722 * b).toBeGreaterThanOrEqual(80);
  });
});
