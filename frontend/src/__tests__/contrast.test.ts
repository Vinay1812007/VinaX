/**
 * Theme-contrast gate (delta audit P0-4). Parses the REAL token stylesheet —
 * no fixture drift — and asserts WCAG ratios for every text tier on every
 * surface it actually sits on. 1.15: one dark look (black and green), so
 * there is one set of tokens to check. If someone re-pitches a ramp and
 * breaks readability, this fails before a human ever squints at it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../styles/index.css'), 'utf8');

type RGB = [number, number, number];

/** Extract `--name: R G B;` triplets from one selector block. */
function tokensOf(selector: string): Record<string, RGB> {
  const re = new RegExp(`${selector.replace(/[.[\]]/g, '\\$&')}\\s*\\{([^}]*)\\}`);
  const body = re.exec(css)?.[1];
  if (!body) throw new Error(`selector not found: ${selector}`);
  const out: Record<string, RGB> = {};
  for (const m of body.matchAll(/--([\w-]+):\s*(\d+)\s+(\d+)\s+(\d+)\s*;/g)) {
    out[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])];
  }
  return out;
}

function luminance([r, g, b]: RGB): number {
  const ch = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

function ratio(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const dark = tokensOf(':root');

/** [token, surfaces it must stay readable on, minimum ratio] */
const TEXT_TIERS: Array<[string, string[], number]> = [
  // Primary + secondary copy: AA at minimum, and these should fly past it.
  ['ink-100', ['ink-900', 'ink-800'], 7],
  ['ink-200', ['ink-900', 'ink-800'], 7],
  ['ink-300', ['ink-900', 'ink-800'], 4.5],
  // The muted-meta tier — the single most used text color in the app.
  ['ink-400', ['ink-900', 'ink-800'], 4.5],
  // ink-500 is NOT a decoration tier: text-ink-500 carries captions, counts
  // and hints across the app, so it is held to text AA on the canvas and on
  // cards (it used to be gated at the 3:1 UI ratio).
  ['ink-500', ['ink-900', 'ink-800'], 4.5],
  // Accent text tiers (reasons, links, stats — meaningful content).
  ['ember-400', ['ink-900', 'ink-800'], 4.5],
  ['tide-400', ['ink-900', 'ink-800'], 4.5],
];

/** Non-text UI tiers (rings, icons with hover states): WCAG 1.4.11 → 3:1. */
const UI_TIERS: Array<[string, string[], number]> = [
  ['ember-500', ['ink-900'], 3],
];

describe.each([['dark', dark]])('%s look contrast', (_name, t) => {
  it.each(TEXT_TIERS)('text %s on [%s] ≥ %s:1', (token, surfaces, min) => {
    for (const surface of surfaces) {
      expect(ratio(t[token], t[surface]), `${token} on ${surface}`).toBeGreaterThanOrEqual(min);
    }
  });

  it.each(UI_TIERS)('ui %s on [%s] ≥ %s:1', (token, surfaces, min) => {
    for (const surface of surfaces) {
      expect(ratio(t[token], t[surface]), `${token} on ${surface}`).toBeGreaterThanOrEqual(min);
    }
  });

  it('black labels read on the green (play buttons, the chosen chip)', () => {
    expect(ratio([0, 0, 0], t['ember-500'])).toBeGreaterThanOrEqual(4.5);
    expect(ratio([0, 0, 0], t['ember-400'])).toBeGreaterThanOrEqual(4.5);
  });

  it('green text reads on the black window too', () => {
    expect(ratio(t['ember-500'], t['ink-950'])).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the ink ramp monotonic (100 highest-contrast → 600 lowest)', () => {
    const canvas = t['ink-900'];
    const tiers = ['ink-100', 'ink-200', 'ink-300', 'ink-400', 'ink-500', 'ink-600'];
    const ratios = tiers.map((k) => ratio(t[k], canvas));
    for (let i = 1; i < ratios.length; i++) {
      expect(ratios[i], `${tiers[i]} should sit below ${tiers[i - 1]}`).toBeLessThanOrEqual(ratios[i - 1]);
    }
  });
});

it('1.15 — one look: no black theme or accent blocks are left in the token sheet', () => {
  expect(css).not.toMatch(/^html\.amoled\b/m);
  expect(css).not.toMatch(/^html\[data-accent=/m);
  // 1.15.1 — the light block re-pitches only non-ramp tokens; the ramps are the look's (templates.test.ts).
  expect(tokensOf('html.light')['ink-900']).toBeUndefined();
});

it('every ink tier referenced by Tailwind exists', () => {
  // text-ink-500 once referenced a token that was never defined — Tailwind
  // silently fell through to its default gray palette, escaping the theme
  // system entirely. Lock the config's ink scale to the stylesheet.
  const config = readFileSync(resolve(__dirname, '../../tailwind.config.ts'), 'utf8');
  const referenced = [...config.matchAll(/--ink-(\d+)/g)].map((m) => `ink-${m[1]}`);
  expect(referenced.length).toBeGreaterThan(5);
  for (const token of referenced) {
    expect(dark[token], `${token} missing from :root`).toBeDefined();
  }
});
