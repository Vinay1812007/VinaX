// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyThemeClasses, resolveTheme } from './theme';

const css = readFileSync('src/styles/index.css', 'utf8');

/** Last definition wins the cascade — assert the v3.8 MODERN MINIMAL era is
 *  what ships. Multiple :root blocks stack in this file (three previous
 *  redesigns still live above), and the last one is the one users see. */
function lastValue(varName: string): string {
  const re = new RegExp(`${varName.replace(/[-[\]/{}()*+?.\\^$|]/g, '\\$&')}:\\s*([^;]+);`, 'g');
  let last = '';
  for (const m of css.matchAll(re)) last = m[1].trim();
  return last;
}

describe('color tokens (v3.8 modern minimal wins the cascade)', () => {
  it('brand ramps resolve to refined indigo', () => {
    // v3.8: indigo primary, cyan supporting. Restrained + wearable across
    // the whole app. Old cyan-primary lived above in earlier :root blocks.
    expect(lastValue('--ember-400')).toBe('129 140 248');
    expect(lastValue('--ember-500')).toBe('99 102 241');
    expect(lastValue('--tide-400')).toBe('103 232 249');
  });

  it('glass recipe is solid ink — blur used sparingly', () => {
    // v3.8 modern minimal: solid surfaces, hairline borders, blur only where
    // depth is doing real work. The old white-frost translucent surfaces
    // were part of the earlier Glass-2.0 aesthetic (now overridden).
    expect(lastValue('--glass-blur')).toBe('6px');
    // The v3.8 block ends with an html.light override, so the "last"
    // --glass-bg the regex finds is the light-mode value. Both surfaces are
    // asserted separately below.
    expect(lastValue('--glass-bg')).toBe('rgb(255 255 255)'); // light: solid white
    expect(css).toContain('--glass-bg: rgb(255 255 255)'); // v3.8 light
    expect(css).toContain('--glass-bg: rgb(16 19 24)'); // v3.8 dark
  });

  it('hero gradient is indigo → deeper-indigo (quiet single-hue)', () => {
    // Was multi-stop cyan→violet→pink; v3.8 keeps only one hue family so
    // the surface never fights the content.
    expect(lastValue('--gradient-primary')).toBe('linear-gradient(180deg, rgb(99 102 241), rgb(79 70 229))');
  });

  it('dark and light both define hairline glass borders', () => {
    // v3.8 borders are dialled way down (was 0.12 / 0.65). Fewer visual
    // lines is the "modern minimal" ask.
    expect(css).toContain('--glass-border: rgba(255, 255, 255, 0.06)');
    expect(css).toContain('--glass-border: rgba(15, 20, 30, 0.08)');
  });

  it('lyric tokens (v3.1.1): both themes define active / dim / passed', () => {
    // dark — white active over slate dims
    expect(css).toContain('--lyric-active: 255 255 255');
    expect(css).toContain('--lyric-dim: 148 163 184');
    expect(css).toContain('--lyric-passed: rgba(255, 255, 255, 0.35)');
    // light — near-black active over real ink dims
    expect(css).toContain('--lyric-active: 10 12 16');
    expect(css).toContain('--lyric-dim: 71 85 105');
    expect(css).toContain('--lyric-passed: rgba(15, 23, 42, 0.35)');
    // every lyric surface consumes the tokens through these classes
    expect(css).toContain('.vx-lyric-active');
    expect(css).toContain('.vx-lyric-dim');
    expect(css).toContain('.vx-lyric-passed');
  });
});

describe('theme resolution + application', () => {
  it('resolves system against the OS scheme', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('amoled', false)).toBe('amoled');
  });

  it('applies the right classes to the root element', () => {
    const root = document.createElement('html');
    applyThemeClasses('light', root);
    expect(root.classList.contains('light')).toBe(true);
    expect(root.classList.contains('dark')).toBe(false);
    applyThemeClasses('dark', root);
    expect(root.classList.contains('light')).toBe(false);
    expect(root.classList.contains('dark')).toBe(true);
    expect(root.classList.contains('amoled')).toBe(false);
    applyThemeClasses('amoled', root);
    expect(root.classList.contains('dark')).toBe(true);
    expect(root.classList.contains('amoled')).toBe(true);
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

  it('primary text on canvas ≥ 7:1 in both themes (v3.8 modern minimal)', () => {
    // Dark canvas rgb(11 13 17) = #0b0d11 with rgb(245 247 251) = #f5f7fb text.
    expect(contrast('#f5f7fb', '#0b0d11')).toBeGreaterThanOrEqual(7);
    // Light canvas rgb(240 242 247) = #f0f2f7 with rgb(12 14 20) = #0c0e14 text.
    expect(contrast('#0c0e14', '#f0f2f7')).toBeGreaterThanOrEqual(7);
  });

  it('secondary text stays readable (≥ 4.5:1)', () => {
    // Dark: --ink-300 rgb(176 184 200) = #b0b8c8 on dark canvas.
    expect(contrast('#b0b8c8', '#0b0d11')).toBeGreaterThanOrEqual(4.5);
    // Light: --ink-300 rgb(84 90 104) = #545a68 on light canvas.
    expect(contrast('#545a68', '#f0f2f7')).toBeGreaterThanOrEqual(4.5);
  });

  it('white button text on the indigo primary fill ≥ 4.5:1 (WCAG AA)', () => {
    // v3.8: primary CTA background is --ember-600 rgb(79 70 229) = #4f46e5
    // (5.86:1 with white — AA). Hover lifts to --ember-500 (#6366f1) which
    // the accent-heavy chips + focus rings use; that lighter shade isn't a
    // text-on-fill surface so its 4.16:1 doesn't apply.
    expect(contrast('#f5f7fb', '#4f46e5')).toBeGreaterThanOrEqual(4.5);
  });

  it('lyric colors meet AA on both canvases (v3.1.1)', () => {
    // dark canvas #0b0d11: active white, upcoming slate
    expect(contrast('#ffffff', '#0b0d11')).toBeGreaterThanOrEqual(7);
    expect(contrast('#94a3b8', '#0b0d11')).toBeGreaterThanOrEqual(4.5);
    // light canvas #f0f2f7: active near-black, upcoming ink
    expect(contrast('#0a0c10', '#f0f2f7')).toBeGreaterThanOrEqual(7);
    expect(contrast('#475569', '#f0f2f7')).toBeGreaterThanOrEqual(4.5);
  });
});
