// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyThemeClasses, normalizeTemplate } from './theme';

const css = readFileSync('src/styles/index.css', 'utf8');

/** Last definition wins the cascade — assert the v3.8 MODERN MINIMAL era is
 *  what ships. Multiple :root blocks stack in this file (three previous
 *  redesigns still live above), and the last one is the one users see. */
function lastValue(varName: string): string {
  // Only :root blocks count — accent skins (html[data-accent=…]) and the
  // light/AMOLED themes legitimately re-pitch the same tokens for THEIR
  // canvas; the default cascade is whatever the last :root says.
  const roots = [...css.matchAll(/:root\s*\{([^}]*)\}/g)].map((m) => m[1]);
  const re = new RegExp(`${varName.replace(/[-[\]/{}()*+?.\\^$|]/g, '\\$&')}:\\s*([^;]+);`, 'g');
  let last = '';
  for (const block of roots) for (const m of block.matchAll(re)) last = m[1].trim();
  return last;
}

describe('color tokens (1.15 black and green)', () => {
  it('brand ramps: green over a black window with #121212 panels', () => {
    // 1.15 — ember is the green (play, the playing row, switches, the chosen
    // state); tide is the same green family; the window is true black.
    expect(lastValue('--ember-400')).toBe('63 228 121');
    expect(lastValue('--ember-500')).toBe('30 215 96');
    expect(lastValue('--tide-500')).toBe('30 215 96');
    expect(lastValue('--ink-950')).toBe('0 0 0');
    expect(lastValue('--ink-900')).toBe('18 18 18');
    expect(lastValue('--ink-300')).toBe('179 179 179');
    expect(lastValue('--ink-100')).toBe('255 255 255');
    expect(lastValue('--surface-sidebar')).toBe('rgb(var(--ink-950))');
  });

  it('one radius scale: 10px controls, 14px cards, 20px panels (9.0)', () => {
    expect(lastValue('--vx-radius-control')).toBe('10px');
    expect(lastValue('--vx-radius-card')).toBe('14px');
    expect(lastValue('--vx-radius-panel')).toBe('20px');
  });

  it('glass recipe is ADJUSTABLE — separate alpha and blur dials (4.13)', () => {
    // 4.13 split the single alpha dial from 4.12 into TWO: --glass-alpha
    // controls translucency, --glass-blur-boost (0..1) controls blur haze
    // independently. This lets users pick "sharp glass" OR "hazy solid" —
    // moods the single dial couldn't express. The reduced-transparency
    // fallback still forces --surface-solid. (1.15: the one look itself is
    // solid — templates/vinax.css.)
    expect(css).toContain('--glass-bg: rgb(27 20 31 / var(--glass-alpha))');
    expect(css).toContain('--glass-blur-boost:');
    expect(css).toContain('--glass-blur: calc(6px + var(--glass-blur-boost) * 34px)');
    expect(css).toContain('prefers-reduced-transparency');
  });

  it('hero gradient follows the selected accent', () => {
    // One hue family only, so the surface never fights the content.
    expect(lastValue('--gradient-primary')).toBe('linear-gradient(180deg, rgb(var(--ember-400)), rgb(var(--ember-500)))');
  });

  it('defines hairline glass borders', () => {
    // v3.8 borders are dialled way down (was 0.12 / 0.65). Fewer visual
    // lines is the "modern minimal" ask.
    expect(css).toContain('--glass-border: rgba(255, 255, 255, 0.06)');
  });

  it('lyric tokens (v3.1.1): active / dim / passed', () => {
    expect(css).toContain('--lyric-active: 255 255 255');
    expect(css).toContain('--lyric-dim: 148 163 184');
    expect(css).toContain('--lyric-passed: rgba(255, 255, 255, 0.35)');
    // every lyric surface consumes the tokens through these classes
    expect(css).toContain('.vx-lyric-active');
    expect(css).toContain('.vx-lyric-dim');
    expect(css).toContain('.vx-lyric-passed');
  });
});

describe('the one look, applied', () => {
  it('stamps the app style and its canvas, whatever style a caller names', () => {
    const root = document.createElement('html');
    applyThemeClasses(root, 'vinax');
    expect(root.dataset.template).toBe('vinax');
    expect(root.style.background).toBe('rgb(18, 18, 18)');
    // No style passed (an older call site): whatever is on <html> stays.
    applyThemeClasses(root);
    expect(root.dataset.template).toBe('vinax');
    // Nonsense falls back to the one look.
    applyThemeClasses(root, 'nonsense');
    expect(root.dataset.template).toBe('vinax');
    expect(root.style.background).toBe('rgb(18, 18, 18)');
  });

  it('2.0 — every style id an earlier release stored opens in the one look', () => {
    for (const old of ['lumen', 'verdant', 'monsoon', 'harbour', 'verse', 'onyx', 'aura', 'pulse', 'sangam', 'nocturne', 'vibe', 'marquee']) expect(normalizeTemplate(old)).toBe('vinax');
    const root = document.createElement('html');
    applyThemeClasses(root, 'marquee');
    expect(root.dataset.template).toBe('vinax');
    expect(root.style.background).toBe('rgb(18, 18, 18)');
  });

  it('1.15 — always dark: a light or black class an older build left behind is removed', () => {
    const root = document.createElement('html');
    root.classList.add('light', 'amoled');
    applyThemeClasses(root);
    expect(root.classList.contains('light')).toBe(false);
    expect(root.classList.contains('amoled')).toBe(false);
    expect(root.classList.contains('dark')).toBe(true);
  });
});

describe('contrast (WCAG AA on the documented pairs)', () => {
  function lum(hex: string): number {
    const c = hex.replace('#', '');
    const [r, g, b] = [0, 2, 4].map((i) => {
      const v = parseInt(c.slice(i, i + 2), 16) / 255;
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function contrast(a: string, b: string): number {
    const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (l1 + 0.05) / (l2 + 0.05);
  }

  it('primary text on the canvas ≥ 7:1 (1.15)', () => {
    // --ink-900 #121212 with --ink-100 white.
    expect(contrast('#ffffff', '#121212')).toBeGreaterThanOrEqual(7);
  });

  it('secondary text stays readable (≥ 4.5:1)', () => {
    // --ink-300 #b3b3b3 on #121212 and on a #1f1f1f card.
    expect(contrast('#b3b3b3', '#121212')).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#b3b3b3', '#1f1f1f')).toBeGreaterThanOrEqual(4.5);
  });

  it('black labels on the green fill ≥ 4.5:1 (WCAG AA)', () => {
    // --vx-on-accent #000 on --ember-500 rgb(30 215 96) = #1ed760.
    expect(contrast('#000000', '#1ed760')).toBeGreaterThanOrEqual(4.5);
  });

  it('lyric colors meet AA on the canvas (v3.1.1)', () => {
    expect(contrast('#ffffff', '#121212')).toBeGreaterThanOrEqual(7);
    expect(contrast('#94a3b8', '#121212')).toBeGreaterThanOrEqual(4.5);
  });
});
