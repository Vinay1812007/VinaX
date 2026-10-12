import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FESTIVALS } from './festivals';
import { FESTIVAL_THEMES } from './festivalThemes';
import { FESTIVAL_VISUALS, PARTICLE_CAP, ambientPlan, festivalVisual, particleCount, type FestivalSignature } from './festivalVisuals';
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

  it('spends one motion budget on the particles AND the set piece together', () => {
    // The caps are a promise about how much is moving on screen at once, so
    // the day's set piece comes out of the same allowance rather than being
    // added on top of a already-full quota of particles.
    for (const f of FESTIVALS) {
      const sig = festivalVisual(f.id).signature;
      for (const [width, cap] of [[390, PARTICLE_CAP.phone], [1440, PARTICLE_CAP.desktop]] as const) {
        const plan = ambientPlan(f.backdrop?.density, sig, width);
        expect(plan.particles, `${f.id} particles @${width}`).toBeGreaterThanOrEqual(0);
        expect(plan.pieces, `${f.id} pieces @${width}`).toBeGreaterThanOrEqual(0);
        expect(plan.particles + plan.pieces, `${f.id} total @${width}`).toBeLessThanOrEqual(cap);
      }
    }
  });

  it('leaves a festival without a set piece its full share of particles', () => {
    expect(ambientPlan(500, 'none', 1440)).toEqual({ particles: 24, pieces: 0 });
    expect(ambientPlan(500, 'none', 390)).toEqual({ particles: 14, pieces: 0 });
  });

  it('steps the particles back by exactly what the set piece takes', () => {
    // A starry night is mostly stars: the twinkle budget is the largest, and
    // the drifting particles give way to it rather than crowding it.
    expect(ambientPlan(500, 'twinkle', 1440)).toEqual({ particles: 8, pieces: 16 });
    expect(ambientPlan(500, 'diyas', 1440)).toEqual({ particles: 17, pieces: 7 });
    expect(ambientPlan(500, 'fireworks', 390)).toEqual({ particles: 11, pieces: 3 });
  });

  it('draws every set piece it names, and names only set pieces it draws', () => {
    const css = readFileSync(join(__dirname, '..', '..', 'src/styles/festivals.css'), 'utf8');
    const CLASS: Record<Exclude<FestivalSignature, 'none'>, string> = {
      fireworks: '.fest-fw', diyas: '.fest-diya', bloom: '.fest-bloom', twinkle: '.fest-twinkle', lanterns: '.fest-lamp',
    };
    const used = new Set(Object.values(FESTIVAL_VISUALS).map((v) => v.signature));
    for (const [sig, cls] of Object.entries(CLASS)) {
      expect(css, `${sig} has no CSS`).toContain(`${cls} {`);
      expect(used.has(sig as FestivalSignature), `${sig} is never used by a festival`).toBe(true);
    }
    // Every festival's signature is one the renderer and the CSS both know.
    for (const f of FESTIVALS) {
      const sig = festivalVisual(f.id).signature;
      expect(sig === 'none' || sig in CLASS, `${f.id} signature ${sig}`).toBe(true);
    }
  });

  it('draws no band across the top of the app, in the page or on the greeting card', () => {
    // 11.6.0, owner report: the 3px ribbon read as a stray browser line above
    // the content. Both the page-wide band and the card's top edge are gone,
    // and with nothing left reading it the variable is no longer emitted.
    const css = readFileSync(join(__dirname, '..', '..', 'src/styles/festivals.css'), 'utf8');
    expect(css).not.toContain('--fest-ribbon');
    expect(css).not.toContain("body::after");
    // The card's wash replaces a hard rule: it is a gradient, not a 3px edge.
    const card = css.match(/\.fest-card::before \{[^}]*\}/)?.[0] ?? '';
    expect(card).toContain('radial-gradient');
    expect(card).not.toMatch(/height: 3px/);
    // The ribbon COLOURS stay — they still pick the emblem and particle
    // colours, and the owner console still shows them as the day's swatch.
    expect(Object.values(FESTIVAL_THEMES).every((t) => t.ribbon.length >= 2)).toBe(true);
    expect(readFileSync(join(__dirname, '..', '..', 'public/admin/festivals.js'), 'utf8')).toContain('"ribbon":"linear-gradient');
  });
});
