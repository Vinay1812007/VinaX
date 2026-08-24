/**
 * Theme-contrast gate (delta audit P0-4). Parses the REAL token stylesheet —
 * no fixture drift — and asserts WCAG ratios for every text tier on every
 * surface it actually sits on, in BOTH themes. If someone re-pitches a ramp
 * and breaks readability, this fails before a human ever squints at it.
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
// The light block inherits anything it doesn't override from :root.
const light = { ...dark, ...tokensOf('html.light') };

/** [token, surfaces it must stay readable on, minimum ratio] */
const TEXT_TIERS: Array<[string, string[], number]> = [
  // Primary + secondary copy: AA at minimum, and these should fly past it.
  ['ink-100', ['ink-900', 'ink-800'], 7],
  ['ink-200', ['ink-900', 'ink-800'], 7],
  ['ink-300', ['ink-900', 'ink-800'], 4.5],
  // The muted-meta tier — the single most used text color in the app.
  ['ink-400', ['ink-900', 'ink-800'], 4.5],
  // Accent text tiers (reasons, links, stats — meaningful content).
  ['ember-400', ['ink-900', 'ink-800'], 4.5],
  ['tide-400', ['ink-900', 'ink-800'], 4.5],
];

/** Non-text UI tiers (rings, icons with hover states): WCAG 1.4.11 → 3:1. */
const UI_TIERS: Array<[string, string[], number]> = [
  ['ember-500', ['ink-900'], 3],
  ['ink-500', ['ink-900'], 3],
];

describe.each([
  ['dark', dark],
  ['light', light],
])('%s theme contrast', (_name, t) => {
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

  it('keeps the ink ramp monotonic (100 highest-contrast → 600 lowest)', () => {
    const canvas = t['ink-900'];
    const tiers = ['ink-100', 'ink-200', 'ink-300', 'ink-400', 'ink-500', 'ink-600'];
    const ratios = tiers.map((k) => ratio(t[k], canvas));
    for (let i = 1; i < ratios.length; i++) {
      expect(ratios[i], `${tiers[i]} should sit below ${tiers[i - 1]}`).toBeLessThanOrEqual(ratios[i - 1]);
    }
  });
});

// --- Accent ramps (roadmap O.4 — the revived picker) -----------------------
// Every named accent must keep its text tiers AA in BOTH themes; the light
// blocks exist precisely because the dark hues fail on the pale canvas.
const ACCENT_IDS = [...css.matchAll(/^html\[data-accent='([\w-]+)'\]/gm)].map((m) => m[1]);

describe('accent ramps stay AA in both themes', () => {
  it('found the accent blocks at all (guards against selector drift)', () => {
    expect(ACCENT_IDS.length).toBeGreaterThanOrEqual(8);
  });

  it.each(ACCENT_IDS)("accent '%s'", (id) => {
    const dk = { ...dark, ...tokensOf(`html[data-accent='${id}']`) };
    const lt = { ...light, ...tokensOf(`html.light[data-accent='${id}']`) };
    for (const t of [dk, lt]) {
      for (const token of ['ember-400', 'tide-400']) {
        for (const surface of ['ink-900', 'ink-800']) {
          expect(ratio(t[token], t[surface]), `${id}: ${token} on ${surface}`).toBeGreaterThanOrEqual(4.5);
        }
      }
      // Non-text ring tier (WCAG 1.4.11).
      expect(ratio(t['ember-500'], t['ink-900']), `${id}: ember-500 ring`).toBeGreaterThanOrEqual(3);
    }
  });

  it('every dark accent block has a light twin (the original O.4 blocker)', () => {
    for (const id of ACCENT_IDS) {
      expect(() => tokensOf(`html.light[data-accent='${id}']`), `missing light ramp for '${id}'`).not.toThrow();
    }
  });
});

it('every ink tier referenced by Tailwind exists in both themes', () => {
  // text-ink-500 once referenced a token that was never defined — Tailwind
  // silently fell through to its default gray palette, escaping the theme
  // system entirely. Lock the config's ink scale to the stylesheet.
  const config = readFileSync(resolve(__dirname, '../../tailwind.config.ts'), 'utf8');
  const referenced = [...config.matchAll(/--ink-(\d+)/g)].map((m) => `ink-${m[1]}`);
  expect(referenced.length).toBeGreaterThan(5);
  for (const token of referenced) {
    expect(dark[token], `${token} missing from :root`).toBeDefined();
    expect(light[token], `${token} missing from html.light (inherits :root only if intended)`).toBeDefined();
  }
});
