/**
 * 11.0 — the app-style contract. Reads the REAL stylesheets (no fixtures):
 * every style has its blocks, stands down for a festival skin, yields to a
 * chosen accent, keeps its text and accent tiers readable in both themes,
 * and paints the same page canvas the pre-paint script stamps.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TEMPLATE, TEMPLATE_CANVAS, TEMPLATE_IDS, TEMPLATE_OPTIONS, normalizeTemplate, templateOption } from './templates';

const read = (p: string): string => readFileSync(resolve(__dirname, p), 'utf8');
const base = read('../styles/index.css');
const tplCss = (id: string): string => read(`../styles/templates/${id}.css`);
const indexHtml = read('../../index.html');

type RGB = [number, number, number];

/** `--name: R G B;` triplets of the first block whose selector is exactly `selector`. */
function tokensOf(css: string, selector: string): Record<string, RGB> {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) return {};
  const body = css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  const out: Record<string, RGB> = {};
  for (const m of body.matchAll(/--([\w-]+):\s*(\d+)\s+(\d+)\s+(\d+)\s*;/g)) out[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])];
  return out;
}
const hexOf = (css: string, selector: string, name: string): string | null => {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) return null;
  return new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,6})`).exec(css.slice(at, css.indexOf('}', at)))?.[1] ?? null;
};
const hexToRgb = (hex: string): RGB => {
  const h = hex.replace('#', '');
  const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16)) as RGB;
};
const toHex = ([r, g, b]: RGB): string => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
function luminance([r, g, b]: RGB): number {
  const ch = (v: number): number => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}
function ratio(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Split a selector list on the commas that are not inside (…). */
function splitSelectors(group: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of group) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out.filter(Boolean);
}

const NOT_FEST = ":not([class*='fest-'])";
const DEFAULT_ACCENT = ":is(:not([data-accent]), [data-accent='crimson'])";
const rootDark = tokensOf(base, ':root');
const rootLight = { ...rootDark, ...tokensOf(base, 'html.light') };

/** The tokens a style resolves to with the default accent, per theme. */
function resolved(id: string): { dark: Record<string, RGB>; light: Record<string, RGB>; onDark: string; onLight: string } {
  const css = tplCss(id);
  const sel = `html[data-template='${id}']${NOT_FEST}`;
  const selLight = `html.light[data-template='${id}']${NOT_FEST}`;
  const dark = { ...rootDark, ...tokensOf(css, sel), ...tokensOf(css, `${sel}${DEFAULT_ACCENT}`) };
  const light = { ...rootLight, ...tokensOf(css, sel), ...tokensOf(css, selLight), ...tokensOf(css, `${sel}${DEFAULT_ACCENT}`), ...tokensOf(css, `${selLight}${DEFAULT_ACCENT}`) };
  return {
    dark,
    light,
    onDark: hexOf(css, `${sel}${DEFAULT_ACCENT}`, 'vx-on-accent') ?? '#1a0e06',
    onLight: hexOf(css, `${selLight}${DEFAULT_ACCENT}`, 'vx-on-accent') ?? '#fff',
  };
}

describe('app styles: the list', () => {
  it('has six styles with unique ids and names, the default among them', () => {
    expect(TEMPLATE_OPTIONS).toHaveLength(6);
    expect(new Set(TEMPLATE_IDS).size).toBe(6);
    expect(new Set(TEMPLATE_OPTIONS.map((t) => t.label)).size).toBe(6);
    expect(TEMPLATE_IDS).toContain(DEFAULT_TEMPLATE);
    expect(Object.keys(TEMPLATE_CANVAS).sort()).toEqual([...TEMPLATE_IDS].sort());
  });

  it('falls back to the default for anything it does not know', () => {
    for (const bad of [undefined, null, '', 'marigold', 42, {}, 'AURA', 'constructor', '__proto__', 'toString']) expect(normalizeTemplate(bad)).toBe(DEFAULT_TEMPLATE);
    for (const id of TEMPLATE_IDS) expect(normalizeTemplate(id)).toBe(id);
    expect(templateOption('nope').id).toBe(DEFAULT_TEMPLATE);
  });

  it('names no other product', () => {
    const copy = TEMPLATE_OPTIONS.map((t) => `${t.label} ${t.tagline} ${t.traits}`).join(' ').toLowerCase();
    for (const brand of ['spotify', 'saavn', 'apple', 'amazon', 'youtube', 'resso', 'gaana', 'wynk']) expect(copy).not.toContain(brand);
  });
});

describe.each(TEMPLATE_IDS.map((id) => [id]))('app style %s: stylesheet contract', (id) => {
  const css = tplCss(id);

  it('is imported by the template index and only styles its own selector', () => {
    expect(read('../styles/templates/index.css')).toContain(`@import './${id}.css';`);
    // Every rule starts from html[data-template='<id>'] (possibly html.light…).
    const blocks = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    expect(blocks.length).toBeGreaterThan(10);
    for (const [, group] of blocks) {
      for (const one of splitSelectors(group)) {
        expect(one, `${id}: stray selector "${one}"`).toMatch(new RegExp(`^html(\\.light)?\\[data-template='${id}'\\]`));
      }
    }
  });

  it('gives up its colours while a festival skin is on', () => {
    // Any declaration of an ink / accent token, or a shell canvas paint, must sit in a :not(fest) block.
    const blocks = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    for (const [, sel, body] of blocks) {
      const setsColourToken = /--(ink|ember|tide)-\d+\s*:/.test(body);
      const paintsCanvas = /\.(vx-shell|vx-workspace)\s*$/.test(sel.trim()) && /background/.test(body);
      if (setsColourToken || paintsCanvas) expect(sel, `${id}: "${sel.trim()}" must stand down for festivals`).toContain(NOT_FEST);
    }
  });

  it('sets its accent only while the listener has not chosen one', () => {
    const blocks = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    for (const [, sel, body] of blocks) {
      if (/--(ember|tide)-\d+\s*:/.test(body)) expect(sel, `${id}: "${sel.trim()}" would override a chosen accent`).toContain(DEFAULT_ACCENT);
    }
  });

  it('stamps the same canvas before first paint as its --ink-900', () => {
    const t = resolved(id);
    expect(toHex(t.dark['ink-900'])).toBe(TEMPLATE_CANVAS[id][0]);
    expect(toHex(t.light['ink-900'])).toBe(TEMPLATE_CANVAS[id][1]);
    expect(indexHtml).toContain(`${id}: ['${TEMPLATE_CANVAS[id][0]}', '${TEMPLATE_CANVAS[id][1]}']`);
  });

  it.each([['dark'], ['light']] as const)('keeps text and accent tiers readable (%s)', (theme) => {
    const t = resolved(id);
    const tok = t[theme];
    const on = hexToRgb(theme === 'dark' ? t.onDark : t.onLight);
    const check = (fg: string, bgs: string[], min: number): void => {
      for (const bg of bgs) expect(ratio(tok[fg], tok[bg]), `${id} ${theme}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(min);
    };
    check('ink-100', ['ink-900', 'ink-800'], 7);
    check('ink-200', ['ink-900', 'ink-800'], 7);
    check('ink-300', ['ink-900', 'ink-800'], 4.5);
    check('ink-400', ['ink-900', 'ink-800'], 4.5);
    check('ink-500', ['ink-900', 'ink-800'], 4.5);
    check('ember-400', ['ink-900', 'ink-800'], 4.5);
    check('tide-400', ['ink-900', 'ink-800'], 4.5);
    // Rings, icons and progress: the 3:1 UI ratio.
    check('ember-500', ['ink-900'], 3);
    // The label on a solid accent button.
    expect(ratio(on, tok['ember-500']), `${id} ${theme}: label on accent`).toBeGreaterThanOrEqual(4.5);
    // The ramp stays ordered so "one tier up" always means "more contrast".
    const lum = ['ink-950', 'ink-900', 'ink-850', 'ink-800', 'ink-700'].map((k) => luminance(tok[k]));
    const sorted = [...lum].sort((a, b) => (theme === 'dark' ? a - b : b - a));
    expect(lum).toEqual(sorted);
  });
});

describe('app styles × accents', () => {
  // A chosen accent replaces a style's own: its text tiers must still read on
  // that style's canvas and raised surface, in both themes.
  const accents = [...base.matchAll(/^html\[data-accent='([\w-]+)'\]/gm)].map((m) => m[1]);
  it('found the accent blocks', () => expect(accents.length).toBeGreaterThanOrEqual(10));
  it.each(TEMPLATE_IDS.flatMap((id) => accents.map((a) => [id, a] as const)))('%s with the %s accent', (id, accent) => {
    const t = resolved(id);
    const dk = { ...t.dark, ...tokensOf(base, `html[data-accent='${accent}']`) };
    const lt = { ...t.light, ...tokensOf(base, `html.light[data-accent='${accent}']`) };
    for (const [theme, tok] of [['dark', dk], ['light', lt]] as const) {
      for (const fg of ['ember-400', 'tide-400']) {
        for (const bg of ['ink-900', 'ink-800']) expect(ratio(tok[fg], tok[bg]), `${id} ${theme} ${accent}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
      expect(ratio(tok['ember-500'], tok['ink-900']), `${id} ${theme} ${accent}: ring`).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('app styles: light glass keeps text legible', () => {
  // 11.0 — in the light theme every bar is frost (base.css floors: chrome
  // 0.62, thick 0.72 of the style's white). Whatever scrolls under it — a
  // black cover at worst — the text on it must clear AA. (0.8 is the lowest
  // white that keeps muted text at 4.5:1 over black; thinner frost fails.)
  const shared = read('../styles/templates/base.css');
  it('declares the floors', () => {
    expect(shared).toContain('--vx-mat-chrome: rgb(var(--ink-950) / clamp(0.8, calc(var(--glass-alpha) + 0.02), 0.94));');
    expect(shared).toContain('--vx-mat-thick: rgb(var(--ink-950) / clamp(0.86, calc(var(--glass-alpha) + 0.08), 0.96));');
  });
  const over = (fill: RGB, alpha: number, backdrop: RGB): RGB => fill.map((c, i) => c * alpha + backdrop[i] * (1 - alpha)) as RGB;
  it.each(TEMPLATE_IDS.map((id) => [id]))('%s: muted text on the chrome and body text on sheets, over a black cover', (id) => {
    const t = resolved(id).light;
    const black: RGB = [0, 0, 0];
    expect(ratio(t['ink-400'], over(t['ink-950'], 0.8, black)), `${id} ink-400 on chrome`).toBeGreaterThanOrEqual(4.5);
    expect(ratio(t['ink-100'], over(t['ink-950'], 0.86, black)), `${id} ink-100 on thick`).toBeGreaterThanOrEqual(7);
    expect(ratio(t['ink-400'], over(t['ink-950'], 0.86, black)), `${id} ink-400 on thick`).toBeGreaterThanOrEqual(4.5);
    expect(ratio(t['ember-400'], over(t['ink-950'], 0.86, black)), `${id} accent text on thick`).toBeGreaterThanOrEqual(4.5);
  });
});

describe('app styles: the shared layer', () => {
  const shared = read('../styles/templates/base.css');
  it('keeps AMOLED black and high contrast above every style', () => {
    expect(shared).toContain('html.amoled[data-template]:not(#_) {');
    expect(shared).toMatch(/html\.amoled\[data-template\]:not\(#_\) \{[^}]*--ink-950: 0 0 0;/);
    expect(shared).toContain('html.hc[data-template]:not(#_) {');
  });
  it('answers reduced motion for the page entrance', () => {
    expect(shared).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*html\[data-template\] \.animate-fade-up \{ animation: none !important; \}/);
  });
  it('the pre-paint script defaults to the same style as the app', () => {
    expect(indexHtml).toContain(`TC.hasOwnProperty(st.template) ? st.template : '${DEFAULT_TEMPLATE}'`);
    expect(indexHtml).toContain(`setAttribute('data-template', '${DEFAULT_TEMPLATE}')`);
  });
});
