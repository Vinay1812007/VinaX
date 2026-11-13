import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { FESTIVALS, festivalClass } from './festivals';
import { FESTIVAL_THEMES } from './festivalThemes';
import { FESTIVAL_VISUALS } from './festivalVisuals';
import { emblemSvg } from './festivalEmblems';
// @ts-expect-error — plain ESM helper shared with the generator script
import { buildTakeoverFiles, takeoverInks, takeoverAccentText, partner, ramps } from '../../scripts/festivals-gen-core.mjs';

/**
 * UI rebuild Phase 6 — the full festival takeover. Every festival's generated
 * palette must read: text on every surface, the accent as text, and the
 * partner colour in the gradient headings, in the dark and the light theme.
 */
const ROOT = join(__dirname, '..', '..');

type Trip = string;
const rgb = (t: Trip) => t.split(' ').map(Number) as [number, number, number];
const lum = ([r, g, b]: [number, number, number]) => {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a: Trip, b: Trip) => {
  const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

describe('festival takeover', () => {
  it('the generated files match the generator, one per festival, and nothing stale is left', () => {
    const files = buildTakeoverFiles(FESTIVALS, FESTIVAL_THEMES, FESTIVAL_VISUALS, emblemSvg) as Record<string, string>;
    expect(Object.keys(files)).toHaveLength(FESTIVALS.length);
    for (const [rel, css] of Object.entries(files)) {
      expect(existsSync(join(ROOT, rel)), `${rel} missing — run npm run gen:festivals`).toBe(true);
      expect(readFileSync(join(ROOT, rel), 'utf8'), `${rel} drifted — run npm run gen:festivals`).toBe(css);
    }
    const onDisk = readdirSync(join(ROOT, 'public/fest')).map((f) => `public/fest/${f}`).sort();
    expect(onDisk).toEqual(Object.keys(files).sort());
  });

  it('every festival file is scoped to its own class and carries the ornament', () => {
    const files = buildTakeoverFiles(FESTIVALS, FESTIVAL_THEMES, FESTIVAL_VISUALS, emblemSvg) as Record<string, string>;
    for (const f of FESTIVALS) {
      const css = files[`public/fest/${festivalClass(f.id)}.css`];
      expect(css).toContain(`html.vx-takeover.${festivalClass(f.id)} {`);
      expect(css).toContain(`html.vx-takeover.${festivalClass(f.id)}.light {`);
      expect(css).toMatch(/--fest-ornament: url\("data:image\/svg\+xml,/);
      for (let k = 100; k <= 900; k += 100) expect(css).toContain(`--ink-${k}:`);
    }
  });

  for (const theme of ['dark', 'light'] as const) {
    it(`${theme}: text clears AA on every surface, for every festival`, () => {
      const bad: string[] = [];
      for (const f of FESTIVALS) {
        const t = FESTIVAL_THEMES[f.id];
        const r = ramps(t.accent);
        const ink = takeoverInks(t.canvasHue ?? r.hue, t.canvasSat ?? 1)[theme];
        const tide = partner(t, r.hue)[theme];
        for (const surface of [900, 850, 800]) {
          // Text tiers: titles, body, meta, captions (--text-1..4 = ink-100/300/400/500).
          for (const text of [100, 300, 400, 500]) {
            const c = ratio(ink[text], ink[surface]);
            if (c < 4.5) bad.push(`${f.id} ink-${text} on ink-${surface}: ${c.toFixed(2)}`);
          }
          // The accent used as text (--accent-text = ember-400).
          const a = ratio(theme === 'dark' ? takeoverAccentText(t) : r.light[400], ink[surface]);
          if (a < 4.5) bad.push(`${f.id} ember-400 on ink-${surface}: ${a.toFixed(2)}`);
          // The partner colour in gradient headings (large text: 3:1).
          const p = ratio(tide[theme === 'dark' ? 400 : 500], ink[surface]);
          if (p < 3) bad.push(`${f.id} tide on ink-${surface}: ${p.toFixed(2)}`);
        }
      }
      expect(bad).toEqual([]);
    });
  }
});
