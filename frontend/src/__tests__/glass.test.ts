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

  it('the four tiers exist, follow both dials and are floored where text sits', () => {
    for (const t of ['thin', 'regular', 'chrome', 'thick']) {
      expect(index).toContain(`--vx-mat-${t}:`);
      expect(index).toMatch(new RegExp(`--vx-mat-${t}-blur: calc\\(\\d+px \\+ var\\(--glass-blur-boost\\)`));
      expect(index).toContain(`.vx-mat-${t}`);
    }
    expect(index).toContain('--vx-mat-thin: rgb(var(--ink-950) / calc(var(--glass-alpha)');
    expect(index).toContain('--vx-mat-chrome: rgb(var(--ink-950) / clamp(0.8, calc(var(--glass-alpha) + 0.06), 0.97))');
    expect(index).toContain('--vx-mat-thick: rgb(var(--ink-850) / clamp(0.86, calc(var(--glass-alpha) + 0.12), 0.98))');
    // 1.15 — the snackbar is a solid blue notice, whatever the dial says.
    expect(shell).toContain('--mat-fill: rgb(32 107 196);');
  });

  it('1.15 — the snackbar\'s white text clears AA on its blue', () => {
    expect(ratio(WHITE, [32, 107, 196])).toBeGreaterThanOrEqual(4.5);
  });

  it('1.15.1 — the look is glass that follows the dial, solid at Solid, and floored where text sits', () => {
    const look = readFileSync(resolve(__dirname, '../styles/templates/vinax.css'), 'utf8');
    // Panels: 1 at --glass-alpha 1 (Solid), never below 50%.
    expect(look).toContain('--vx-panel-fill: rgb(var(--ink-900) / clamp(0.5, calc(1 - (1 - var(--glass-alpha)) * 1.6), 1));');
    // Bars and overlays that carry text keep the base floors (chrome 80%, thick 86%).
    expect(look).toContain('--vx-mat-chrome: rgb(var(--ink-950) / clamp(0.8, calc(var(--glass-alpha) + 0.04), 1));');
    expect(look).toContain('--vx-mat-thick: rgb(var(--ink-700) / clamp(0.86, calc(var(--glass-alpha) + 0.12), 1));');
    // The colour mesh behind the glass is gone at Solid.
    expect(look).toContain('--vx-mesh-art: calc((1 - var(--glass-alpha)) * 2.4);');
    // No more "glass off" switch in the look.
    expect(look).not.toMatch(/backdrop-filter:\s*none/);
  });

  it('1.15.1 — panel text clears AA at the deepest glass, over the brightest mesh', () => {
    // Dark: white text on #121212 at 50% over a fully saturated mid-tone mesh (worst case ~ #808080).
    const mid = [128, 128, 128];
    expect(ratio(WHITE, over([18, 18, 18], 0.5, mid))).toBeGreaterThanOrEqual(4.5);
    // Light: #121212 text on #f8f8f8 at 50% over the same mesh.
    expect(ratio([18, 18, 18], over([248, 248, 248], 0.5, mid))).toBeGreaterThanOrEqual(4.5);
  });

  it('1.21 — light "meadow glass": panel text clears AA on the clearest liquid glass over the darkest meadow', () => {
    const light = readFileSync(resolve(__dirname, '../styles/templates/vinax-light.css'), 'utf8');
    const look = readFileSync(resolve(__dirname, '../styles/templates/vinax.css'), 'utf8');
    // The glass is floored at 26% white and solid at Solid.
    expect(light).toContain('--vx-panel-fill: rgb(255 255 255 / clamp(0.26, calc(1 - (1 - var(--glass-alpha)) * 3.4), 1));');
    // Every rule is light-only, so dark mode cannot change with it.
    const selectors = light.replace(/\/\*[\s\S]*?\*\//g, '').match(/^[^@{}\n][^{}]*\{/gm) ?? [];
    for (const sel of selectors.filter((s) => !/^\s*(from|to)\b/.test(s))) expect(sel).toContain('html.light');
    const inks = (name: string): number[] => {
      const block = look.slice(look.indexOf("html.light[data-template='vinax']:root {"));
      return block.match(new RegExp(`--${name}: (\\d+) (\\d+) (\\d+);`))!.slice(1).map(Number);
    };
    // The darkest green in public/bg/meadow.svg that a panel can sit on.
    const meadow = [106, 156, 70];
    for (const ink of ['ink-100', 'ink-300', 'ink-400']) {
      expect(ratio(inks(ink), over(WHITE, 0.26, meadow)), ink).toBeGreaterThanOrEqual(4.5);
    }
    const svg = readFileSync(resolve(__dirname, '../../public/bg/meadow.svg'), 'utf8');
    const fills = [...svg.matchAll(/(?:fill|stop-color)="#([0-9a-f]{6})"/g)].map((m) => [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)));
    for (const f of fills) expect(lum(f), `meadow colour ${f} is darker than the tested floor`).toBeGreaterThanOrEqual(lum(meadow) - 1e-9);

    // The meadow is always coloured: the logo's orange into pink at 90% when
    // nothing plays, the song's colour (--art) at 85% while one does, in the
    // "color" blend (W3C compositing: the colour's hue and saturation, the
    // meadow's luminosity). Every hue, vivid or muted, at either strength,
    // keeps the text AA.
    expect(light).toContain("[style*='--art:'] { --vx-song-a: rgb(var(--art) / 0.85); --vx-song-b: rgb(var(--art) / 0.85); }");
    expect(light).toContain('--vx-song-a: rgb(255 164 46 / 0.9);');
    expect(light).toContain('--vx-song-b: rgb(255 99 132 / 0.9);');
    expect(light).toContain('background-blend-mode: color, normal;');
    const L = ([r, g, b]: number[]) => 0.3 * r + 0.59 * g + 0.11 * b;
    const setLum = (c: number[], l: number): number[] => {
      const d = l - L(c);
      const x = c.map((v) => v + d);
      const lx = L(x), n = Math.min(...x), m = Math.max(...x);
      if (n < 0) return x.map((v) => lx + ((v - lx) * lx) / (lx - n));
      if (m > 1) return x.map((v) => lx + ((v - lx) * (1 - lx)) / (m - lx));
      return x;
    };
    const hsl = (h: number, s: number, l: number): number[] => {
      const k = (n: number) => (n + h / 30) % 12;
      const a = s * Math.min(l, 1 - l);
      return [0, 8, 4].map((n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)));
    };
    const back = meadow.map((v) => v / 255);
    for (let h = 0; h < 360; h += 10) {
      for (const s of [1, 0.6, 0.3]) {
        const blended = setLum(hsl(h, s, 0.5), L(back)).map((v) => v * 255);
        for (const strength of [0.85, 0.9, 1]) {
          const tinted = over(blended, strength, meadow);
          for (const ink of ['ink-100', 'ink-300', 'ink-400']) {
            expect(ratio(inks(ink), over(WHITE, 0.26, tinted)), `${ink} on hue ${h} sat ${s} at ${strength}`).toBeGreaterThanOrEqual(4.5);
          }
        }
      }
    }
    // The bars, the mini player and sheets float over the page, where a black
    // cover can scroll under them: their floors hold AA on black.
    expect(light).toContain('--vx-mat-chrome: rgb(var(--ink-950) / clamp(0.66,');
    expect(light).toContain('--vx-mat-thick: rgb(var(--ink-950) / clamp(0.74,');
    for (const ink of ['ink-100', 'ink-300', 'ink-400']) {
      expect(ratio(inks(ink), over(WHITE, 0.66, [0, 0, 0])), `${ink} on the chrome over black`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('dark: muted text on the chrome, body text on menus and snackbars clear AA over a white cover', () => {
    // 1.15 — the black-and-green inks (index.css :root).
    const ink950 = [0, 0, 0];
    const ink850 = [26, 26, 26];
    const ink800 = [31, 31, 31];
    const ink400 = [167, 167, 167];
    const ink100 = [255, 255, 255];
    const ember400 = [63, 228, 121];
    expect(ratio(ink400, over(ink950, 0.8, WHITE))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(ink400, over(ink850, 0.86, WHITE))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(ink100, over(ink800, 0.86, WHITE))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(ember400, over(ink800, 0.86, WHITE))).toBeGreaterThanOrEqual(4.5);
  });

  it('both translucency fallbacks cover the materials', () => {
    const supportsNot = index.slice(index.indexOf('@supports not ((backdrop-filter'));
    expect(supportsNot.slice(0, supportsNot.indexOf('}\n}'))).toContain('.vx-mat-chrome');
    const reduced = index.slice(index.indexOf('@media (prefers-reduced-transparency: reduce)'));
    expect(reduced.slice(0, reduced.indexOf('}\n}'))).toContain('.vx-mat-thick');
  });
});
