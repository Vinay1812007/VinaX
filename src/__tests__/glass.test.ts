/**
 * Adjustable iOS glass (4.12.0). Pins the alpha mapping's contract: level 0
 * is EXACTLY the classic solid look (alpha 1 — long-time users see zero
 * change until they touch the slider... except the new default), level 100
 * never goes fully transparent (text always keeps a frost to sit on), and
 * the pre-paint script in index.html carries the same math.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BLUR_DEFAULT, GLASS_DEFAULT, blurBoost, glassAlpha } from '../utils/theme';

describe('glassAlpha', () => {
  it('level 0 = solid (the pre-4.12 look), monotonically more transparent up to 100', () => {
    expect(glassAlpha(0)).toBe(1);
    expect(glassAlpha(100)).toBe(0.45);
    let prev = glassAlpha(0);
    for (let l = 5; l <= 100; l += 5) {
      const a = glassAlpha(l);
      expect(a).toBeLessThan(prev);
      prev = a;
    }
  });

  it('never reaches full transparency and clamps junk input', () => {
    expect(glassAlpha(100)).toBeGreaterThanOrEqual(0.45);
    expect(glassAlpha(1000)).toBe(0.45);
    expect(glassAlpha(-50)).toBe(1);
    expect(Number.isNaN(glassAlpha(NaN))).toBe(false);
  });

  it('the shipped default is a mid-level frost', () => {
    expect(GLASS_DEFAULT).toBe(40);
    expect(glassAlpha(GLASS_DEFAULT)).toBeCloseTo(0.78, 2);
  });

  it('index.html pre-paint mirrors the same formula (no first-paint flash)', () => {
    const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');
    expect(html).toContain('1 - 0.55 * (gl / 100)');
    expect(html).toContain('--glass-alpha');
  });

  it('the stylesheet derives blur/saturation from independent dials (4.13)', () => {
    const css = readFileSync(resolve(__dirname, '../styles/index.css'), 'utf8');
    expect(css).toContain('--glass-alpha: 0.78');
    expect(css).toMatch(/--glass-bg: rgb\(16 19 24 \/ var\(--glass-alpha\)\)/);
    expect(css).toMatch(/--glass-bg: rgb\(255 255 255 \/ var\(--glass-alpha\)\)/);
    // 4.13 split: blur is its own dial (--glass-blur-boost 0..1) — sharp
    // glass and hazy solids are now BOTH reachable, which the single alpha
    // dial couldn't express.
    expect(css).toContain('--glass-blur-boost:');
    expect(css).toMatch(/--glass-blur: calc\(6px \+ var\(--glass-blur-boost\) \* 34px\)/);
  });
});

describe('blurBoost — the independent 4.13 blur dial', () => {
  it('0 → base blur only, 100 → maximum haze, clamps junk', () => {
    expect(blurBoost(0)).toBe(0);
    expect(blurBoost(100)).toBe(1);
    expect(blurBoost(50)).toBeCloseTo(0.5, 2);
    expect(blurBoost(1000)).toBe(1);
    expect(blurBoost(-50)).toBe(0);
    expect(Number.isNaN(blurBoost(NaN))).toBe(false);
  });
  it('shipped default is a moderate haze', () => {
    expect(BLUR_DEFAULT).toBe(40);
    expect(blurBoost(BLUR_DEFAULT)).toBeCloseTo(0.4, 2);
  });
});
