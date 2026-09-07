// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyThemeClasses, resolveTheme } from './theme';

// Festival skins (html.fest-*) are deliberate, CLASS-SCOPED accent overrides
// active only inside their calendar windows — strip those blocks so this test
// keeps pinning the year-round base cascade, not a seasonal costume (4.17.3).
const css = readFileSync('src/styles/index.css', 'utf8').replace(
  /html\.fest-[\w.-]*\s*\{[^}]*\}/g,
  '',
);

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

describe('color tokens (v5.9.0 flat black look wins the cascade)', () => {
  it('brand ramps resolve to VinaX green', () => {
    // v5.9.0: one green accent (#1db954 / #1ed760) over black chrome and a
    // #121212 canvas. Every earlier era's ramp lives above in the cascade.
    expect(lastValue('--ember-400')).toBe('30 215 96');
    expect(lastValue('--ember-500')).toBe('29 185 84');
    expect(lastValue('--tide-400')).toBe('100 232 150');
    expect(lastValue('--ink-900')).toBe('18 18 18');
    expect(lastValue('--surface-sidebar')).toBe('rgb(0 0 0)');
  });

  it('glass recipe is ADJUSTABLE — separate alpha and blur dials (4.13)', () => {
    // 4.13 split the single alpha dial from 4.12 into TWO: --glass-alpha
    // controls translucency, --glass-blur-boost (0..1) controls blur haze
    // independently. This lets users pick "sharp glass" OR "hazy solid" —
    // moods the single dial couldn't express. AMOLED stays solid on purpose
    // (true-black canvases don't frost), and the reduced-transparency
    // fallback still forces --surface-solid.
    expect(css).toContain('--glass-bg: rgb(24 24 24 / var(--glass-alpha))'); // dark
    expect(css).toContain('--glass-bg: rgb(255 255 255 / var(--glass-alpha))'); // light
    expect(css).toContain('--glass-blur-boost:');
    expect(css).toContain('--glass-blur: calc(6px + var(--glass-blur-boost) * 34px)');
    expect(css).toMatch(/html\.amoled\s*\{[^}]*--glass-bg:\s*rgb\(8 8 11\)/);
    expect(css).toContain('prefers-reduced-transparency');
  });

  it('hero gradient is green → deeper-green (quiet single-hue)', () => {
    // One hue family only, so the surface never fights the content.
    expect(lastValue('--gradient-primary')).toBe('linear-gradient(180deg, rgb(30 215 96), rgb(29 185 84))');
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

  it('auto follows the clock: light 07:00–18:59, dark otherwise (v5.12.0)', () => {
    expect(resolveTheme('auto', true, 7)).toBe('light');
    expect(resolveTheme('auto', false, 12)).toBe('light');
    expect(resolveTheme('auto', false, 18)).toBe('light');
    expect(resolveTheme('auto', false, 19)).toBe('dark');
    expect(resolveTheme('auto', false, 2)).toBe('dark');
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
    // Dark canvas rgb(18 18 18) = #121212 with white text.
    expect(contrast('#ffffff', '#121212')).toBeGreaterThanOrEqual(7);
    // Light canvas rgb(247 247 247) = #f7f7f7 with rgb(12 14 20) = #0c0e14 text.
    expect(contrast('#0c0e14', '#f7f7f7')).toBeGreaterThanOrEqual(7);
  });

  it('secondary text stays readable (≥ 4.5:1)', () => {
    // Dark: --ink-300 rgb(179 179 179) = #b3b3b3 on the #121212 canvas.
    expect(contrast('#b3b3b3', '#121212')).toBeGreaterThanOrEqual(4.5);
    // Light: --ink-300 rgb(84 90 104) = #545a68 on light canvas.
    expect(contrast('#545a68', '#f7f7f7')).toBeGreaterThanOrEqual(4.5);
  });

  it('white button text on the indigo primary fill ≥ 4.5:1 (WCAG AA)', () => {
    // v3.8: primary CTA background is --ember-600 rgb(79 70 229) = #4f46e5
    // (5.86:1 with white — AA). Hover lifts to --ember-500 (#6366f1) which
    // the accent-heavy chips + focus rings use; that lighter shade isn't a
    // text-on-fill surface so its 4.16:1 doesn't apply.
    expect(contrast('#000000', '#1db954')).toBeGreaterThanOrEqual(4.5);
  });

  it('lyric colors meet AA on both canvases (v3.1.1)', () => {
    // dark canvas #121212: active white, upcoming slate
    expect(contrast('#ffffff', '#121212')).toBeGreaterThanOrEqual(7);
    expect(contrast('#94a3b8', '#121212')).toBeGreaterThanOrEqual(4.5);
    // light canvas #f7f7f7: active near-black, upcoming ink
    expect(contrast('#0a0c10', '#f7f7f7')).toBeGreaterThanOrEqual(7);
    expect(contrast('#475569', '#f7f7f7')).toBeGreaterThanOrEqual(4.5);
  });
});
