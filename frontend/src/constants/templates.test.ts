/**
 * 11.0 — the app-style contract. Reads the REAL stylesheets (no fixtures):
 * every style has its blocks, keeps its colour blocks' weight, keeps its
 * text and accent tiers readable, and paints the same page canvas the
 * pre-paint script stamps. 1.15: one dark look — no light theme and no
 * accent picker to yield to.
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

/** Every colour block carries this on the html selector, for its weight in the cascade (styles/templates/base.css). */
const WEIGHT = ':root';
const rootDark = tokensOf(base, ':root');

/** The tokens a style resolves to, per theme (1.15.1: light and dark). */
function resolved(id: string): { dark: Record<string, RGB>; light: Record<string, RGB>; onDark: string; onLight: string } {
  const css = tplCss(id);
  const sel = `html[data-template='${id}']${WEIGHT}`;
  const selLight = `html.light[data-template='${id}']${WEIGHT}`;
  const dark = { ...rootDark, ...tokensOf(css, sel) };
  return {
    dark,
    light: { ...dark, ...tokensOf(css, selLight) },
    onDark: hexOf(css, sel, 'vx-on-accent') ?? '#000',
    onLight: hexOf(css, selLight, 'vx-on-accent') ?? hexOf(css, sel, 'vx-on-accent') ?? '#000',
  };
}

describe('app styles: the list', () => {
  it('has one style, and it is the default', () => {
    expect(TEMPLATE_OPTIONS).toHaveLength(1);
    expect(new Set(TEMPLATE_IDS).size).toBe(1);
    expect(new Set(TEMPLATE_OPTIONS.map((t) => t.label)).size).toBe(1);
    expect(TEMPLATE_IDS).toContain(DEFAULT_TEMPLATE);
    expect(Object.keys(TEMPLATE_CANVAS).sort()).toEqual([...TEMPLATE_IDS].sort());
  });

  it('falls back to the default for anything it does not know', () => {
    for (const bad of [undefined, null, '', 'marigold', 42, {}, 'AURA', 'constructor', '__proto__', 'toString', 'lumen', 'onyx', 'pulse']) expect(normalizeTemplate(bad)).toBe(DEFAULT_TEMPLATE);
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

  it('keeps the weight of its colour blocks', () => {
    // Any declaration of an ink / accent token, or a shell canvas paint, must sit in a block
    // that carries `:root`: without it the block loses to theme and page rules it beats today.
    const blocks = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    for (const [, sel, body] of blocks) {
      const setsColourToken = /--(ink|ember|tide)-\d+\s*:/.test(body);
      const paintsCanvas = /\.(vx-shell|vx-workspace)\s*$/.test(sel.trim()) && /background/.test(body);
      if (setsColourToken || paintsCanvas) expect(sel, `${id}: "${sel.trim()}" must carry ${WEIGHT}`).toContain(WEIGHT);
    }
  });

  it('stamps the same window canvas before first paint as its --ink-950, in both themes', () => {
    const t = resolved(id);
    expect(toHex(t.dark['ink-950'])).toBe(TEMPLATE_CANVAS[id].dark);
    expect(toHex(t.light['ink-950'])).toBe(TEMPLATE_CANVAS[id].light);
    expect(indexHtml).toContain(`${id}: { dark: '${TEMPLATE_CANVAS[id].dark}', light: '${TEMPLATE_CANVAS[id].light}' }`);
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

describe('1.15 — one look, light and dark', () => {
  it('has no black (AMOLED) theme and no accent blocks', () => {
    for (const css of [base, ...TEMPLATE_IDS.map(tplCss), read('../styles/templates/base.css')]) {
      expect(css).not.toMatch(/html\.amoled\b/);
      expect(css).not.toMatch(/\[data-accent=/);
    }
  });
  it.each(TEMPLATE_IDS.map((id) => [id]))('%s: the light block sets every ink and green tier', (id) => {
    const light = tokensOf(tplCss(id), `html.light[data-template='${id}']${WEIGHT}`);
    for (const k of ['ink-950', 'ink-900', 'ink-850', 'ink-800', 'ink-700', 'ink-600', 'ink-500', 'ink-400', 'ink-300', 'ink-200', 'ink-100', 'ember-500', 'ember-400', 'tide-400']) expect(light[k], k).toBeDefined();
  });
});

describe('app styles: the shared layer', () => {
  it('feeds every style\'s dials into the design system v2 tokens (Phase 7)', () => {
    const shared = read('../styles/templates/base.css');
    for (const pair of ['--radius-art: var(--tpl-r-art-sm);', '--radius-control: var(--tpl-r-control);', '--radius-tile: var(--tpl-r-tile);', '--radius-input: var(--tpl-r-input);']) expect(shared).toContain(pair);
    // The press depth only where motion is allowed (tokens.css zeroes it otherwise).
    expect(shared).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{\s*html\[data-template\]:not\(\.reduce-motion\) \{ --press-scale: var\(--tpl-press\); \}/);
    for (const id of TEMPLATE_IDS) expect(tplCss(id), `${id} states its control radius`).toMatch(/--tpl-r-control:\s*\S+;/);
  });

  const shared = read('../styles/templates/base.css');
  it('keeps high contrast above every style', () => {
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
