/**
 * Adjustable frosted glass (4.12.0). Pins the alpha mapping's contract: level 0
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
    expect(css).toMatch(/--glass-bg: rgb\(27 20 31 \/ var\(--glass-alpha\)\)/);
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

/**
 * 10.1 — the frosted material scale. Text sits on the chrome (tab bar
 * labels, the top bar title), on the thick tier (menus, sheets) and on the
 * snackbar. Each fill is FLOORED, so whatever the Glass dial says and
 * whatever scrolls underneath — a white cover in the dark theme, a black one
 * in the light theme — the text keeps WCAG AA (4.5:1).
 */
describe('frosted materials keep text legible over any backdrop', () => {
  const index = readFileSync(resolve(__dirname, '../styles/index.css'), 'utf8');
  const shell = readFileSync(resolve(__dirname, '../styles/shell.css'), 'utf8');

  const lin = (v: number): number => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const lum = ([r, g, b]: number[]): number => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const ratio = (a: number[], b: number[]): number => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  /** The fill composited over a backdrop at the fill's floor alpha. */
  const over = (fill: number[], alpha: number, backdrop: number[]): number[] => fill.map((c, i) => c * alpha + backdrop[i] * (1 - alpha));
  const WHITE = [255, 255, 255];
  const BLACK = [0, 0, 0];

  it('the four tiers exist, follow both dials and are floored where text sits', () => {
    for (const t of ['thin', 'regular', 'chrome', 'thick']) {
      expect(index).toContain(`--vx-mat-${t}:`);
      expect(index).toMatch(new RegExp(`--vx-mat-${t}-blur: calc\\(\\d+px \\+ var\\(--glass-blur-boost\\)`));
      expect(index).toContain(`.vx-mat-${t}`);
    }
    expect(index).toContain('--vx-mat-thin: rgb(var(--ink-950) / calc(var(--glass-alpha)');
    expect(index).toContain('--vx-mat-chrome: rgb(var(--ink-950) / clamp(0.8, calc(var(--glass-alpha) + 0.06), 0.97))');
    expect(index).toContain('--vx-mat-thick: rgb(var(--ink-850) / clamp(0.86, calc(var(--glass-alpha) + 0.12), 0.98))');
    expect(index).toContain('--vx-mat-chrome: rgb(255 253 250 / clamp(0.8, calc(var(--glass-alpha) + 0.06), 0.97))');
    expect(index).toContain('--vx-mat-thick: rgb(255 253 250 / clamp(0.86, calc(var(--glass-alpha) + 0.12), 0.98))');
    expect(shell).toContain('--mat-fill: rgb(var(--ink-800) / clamp(0.86, calc(var(--glass-alpha) + 0.12), 0.98))');
    expect(shell).toContain('--mat-fill: rgb(var(--ink-950) / clamp(0.92, calc(var(--glass-alpha) + 0.16), 0.98))');
  });

  it('dark: muted text on the chrome, body text on menus and snackbars clear AA over a white cover', () => {
    const ink950 = [13, 9, 15];
    const ink850 = [27, 20, 31];
    const ink800 = [37, 28, 42];
    const ink400 = [182, 171, 184];
    const ink100 = [251, 245, 236];
    const ember400 = [255, 192, 102];
    expect(ratio(ink400, over(ink950, 0.8, WHITE))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(ink400, over(ink850, 0.86, WHITE))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(ink100, over(ink800, 0.86, WHITE))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(ember400, over(ink800, 0.86, WHITE))).toBeGreaterThanOrEqual(4.5);
  });

  it('light: the same text tiers clear AA on white glass over a black cover', () => {
    const glass = [255, 253, 250];
    const ink400 = [94, 79, 88];
    const ink100 = [24, 14, 22];
    const ember400 = [156, 68, 4];
    expect(ratio(ink400, over(glass, 0.8, BLACK))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(ink400, over(glass, 0.86, BLACK))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(ink100, over(glass, 0.92, BLACK))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(ember400, over(glass, 0.92, BLACK))).toBeGreaterThanOrEqual(4.5);
  });

  it('AMOLED stays solid, and both translucency fallbacks cover the materials', () => {
    expect(index).toMatch(/html\.amoled\s*\{[^}]*--vx-mat-chrome:\s*rgb\(0 0 0\)/);
    const supportsNot = index.slice(index.indexOf('@supports not ((backdrop-filter'));
    expect(supportsNot.slice(0, supportsNot.indexOf('}\n}'))).toContain('.vx-mat-chrome');
    const reduced = index.slice(index.indexOf('@media (prefers-reduced-transparency: reduce)'));
    expect(reduced.slice(0, reduced.indexOf('}\n}'))).toContain('.vx-mat-thick');
  });
});
