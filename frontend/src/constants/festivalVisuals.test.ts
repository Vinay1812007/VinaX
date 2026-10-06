import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FESTIVALS } from './festivals';
import { FESTIVAL_THEMES } from './festivalThemes';
import { FESTIVAL_VISUALS, PARTICLE_CAP, festivalVisual, particleCount } from './festivalVisuals';
import { EMBLEMS, emblemSvg, type EmblemId } from './festivalEmblems';
// @ts-expect-error — plain ESM helper shared with the generator script
import { ramps, canvas, emblemColours } from '../../scripts/festivals-gen-core.mjs';

const REMOTE = /(?:https?:)?\/\/[a-z0-9-]+\.[a-z]/i;
const lum = (rgb: number[]) => {
  const [r, g, b] = rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: number[], b: number[]) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const trip = (s: string) => s.split(' ').map(Number);

describe('festival visual system', () => {
  it('gives every festival a theme, a drawn emblem, a blurb and a songs query', () => {
    expect(Object.keys(FESTIVAL_VISUALS).sort()).toEqual(FESTIVALS.map((f) => f.id).sort());
    for (const f of FESTIVALS) {
      const v = festivalVisual(f.id);
      expect(FESTIVAL_THEMES[f.id], f.id).toBeTruthy();
      expect(EMBLEMS[v.emblem], `${f.id} emblem`).toBeTruthy();
      expect(v.blurb.length, `${f.id} blurb`).toBeGreaterThan(15);
      expect(v.blurb.length, `${f.id} blurb`).toBeLessThanOrEqual(90);
      expect(v.query.trim().length, `${f.id} query`).toBeGreaterThan(3);
    }
  });

  it('uses every emblem in the library and draws each with the five shared classes only', () => {
    const used = new Set(Object.values(FESTIVAL_VISUALS).map((v) => v.emblem));
    for (const id of Object.keys(EMBLEMS) as EmblemId[]) {
      expect(used.has(id), `${id} is unused`).toBe(true);
      const classes = new Set(Array.from(EMBLEMS[id].matchAll(/class="([^"]+)"/g), (m) => m[1]));
      for (const c of classes) expect(['a', 'b', 'c', 's', 't']).toContain(c);
      expect(EMBLEMS[id]).not.toMatch(/<image|<script|href|url\(/);
      expect(emblemSvg(id, ['#111111', '#222222', '#333333'])).toContain('viewBox="0 0 64 64"');
    }
  });

  it('keeps no remote URL in festival data or in the generated CSS', () => {
    const root = join(__dirname, '..', '..');
    const data = JSON.stringify({ FESTIVALS, FESTIVAL_THEMES, FESTIVAL_VISUALS, EMBLEMS });
    expect(data).not.toMatch(REMOTE);
    expect(readFileSync(join(root, 'src/styles/festivals.css'), 'utf8')).not.toMatch(REMOTE);
    expect(readFileSync(join(root, 'public/admin/festivals.js'), 'utf8').replace(/%3A/gi, ':').replace(/%2F/gi, '/').replace(/http:\/\/www\.w3\.org\/2000\/svg/g, '')).not.toMatch(REMOTE);
    expect(readFileSync(join(root, 'src/components/FestiveSplash.tsx'), 'utf8')).not.toMatch(REMOTE);
  });

  it('keeps every light-theme accent step at 4.5:1 or better on its own light canvas', () => {
    for (const f of FESTIVALS) {
      const t = FESTIVAL_THEMES[f.id];
      const r = ramps(t.accent);
      const paper = trip(canvas(t.canvasHue ?? r.hue, t.canvasSat ?? 1).light[900]);
      for (const step of [300, 400, 500, 600]) {
        expect(contrast(trip(r.light[step]), paper), `${f.id} ${step}`).toBeGreaterThanOrEqual(4.5);
      }
      // Emblem colours 2 and 3 stay visible on the light canvas too.
      for (const c of emblemColours(t).light) expect(contrast(trip(c), [255, 255, 255]), `${f.id} emblem`).toBeGreaterThanOrEqual(1.9);
    }
  });

  it('caps particles at 14 on phones and 24 on desktop, whatever the data says', () => {
    expect(PARTICLE_CAP).toEqual({ phone: 14, desktop: 24 });
    for (const f of FESTIVALS) {
      expect(particleCount(f.backdrop?.density, 390)).toBeLessThanOrEqual(14);
      expect(particleCount(f.backdrop?.density, 1440)).toBeLessThanOrEqual(24);
    }
    expect(particleCount(500, 390)).toBe(14);
    expect(particleCount(500, 1440)).toBe(24);
    expect(particleCount(undefined, 1440)).toBe(12);
    expect(particleCount(-3, 1440)).toBe(0);
  });
});
