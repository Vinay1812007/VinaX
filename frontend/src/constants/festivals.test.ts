import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FESTIVALS, activeFestival, activeFestivalTheme, nextFestival, resolveFestival, festivalClass } from './festivals';
import { FESTIVAL_THEMES } from './festivalThemes';
// @ts-expect-error — plain ESM helper shared with the generator script
import { buildCss, buildWindowJs, buildAdminJs, FW_RE, ramps, rgbToHsl, hexToRgb } from '../../scripts/festivals-gen-core.mjs';

const ROOT = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

describe('festival calendar data', () => {
  it('has unique ids, a theme for every festival, and sane windows', () => {
    const ids = FESTIVALS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of FESTIVALS) {
      expect(FESTIVAL_THEMES[f.id], `theme for ${f.id}`).toBeTruthy();
      expect(f.name.length).toBeGreaterThan(2);
      expect(f.colors.length).toBeGreaterThanOrEqual(3);
      for (const [mf, df, mt, dt] of f.windows) {
        expect(mf).toBeGreaterThanOrEqual(1); expect(mf).toBeLessThanOrEqual(12);
        expect(df).toBeGreaterThanOrEqual(1); expect(df).toBeLessThanOrEqual(31);
        expect(mt * 100 + dt).toBeGreaterThanOrEqual(mf * 100 + df);
      }
    }
    for (const id of Object.keys(FESTIVAL_THEMES)) expect(ids, `orphan theme ${id}`).toContain(id);
  });

  it('gives every festival a distinct look (accent hue or canvas hue differs from its neighbours)', () => {
    const sig = (id: string) => {
      const t = FESTIVAL_THEMES[id];
      const hue = Math.round(rgbToHsl(hexToRgb(t.accent))[0] / 10);
      return `${hue}|${Math.round((t.canvasHue ?? hue * 10) / 10)}|${t.motif}|${t.glowShape}`;
    };
    const seen = new Map<string, string>();
    for (const f of FESTIVALS) {
      const s = sig(f.id);
      expect(seen.get(s), `${f.id} looks like ${seen.get(s)}`).toBeUndefined();
      seen.set(s, f.id);
    }
  });

  it('keeps every light-mode accent step readable on white (AA)', () => {
    const lum = (rgb: number[]) => {
      const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    for (const f of FESTIVALS) {
      const { light } = ramps(FESTIVAL_THEMES[f.id].accent) as { light: Record<number, string> };
      for (const step of [300, 400, 500, 600]) {
        const rgb = light[step].split(' ').map(Number);
        const ratio = (1.05) / (lum(rgb) + 0.05);
        expect(ratio, `${f.id} ember-${step} on white`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('resolves the calendar', () => {
    expect(activeFestival(new Date(2026, 10, 8))?.id).toBe('diwali');
    expect(activeFestival(new Date(2026, 10, 5))).toBeNull();
    expect(activeFestivalTheme(new Date(2026, 10, 5))?.id).toBe('diwali'); // theme-ahead day
    expect(activeFestival(new Date(2026, 0, 1))?.id).toBe('newyear');
    expect(activeFestival(new Date(2026, 5, 2))?.id).toBe('telangana');
    expect(resolveFestival({ mode: 'off' }, new Date(2026, 10, 8))).toBeNull();
    expect(resolveFestival({ mode: 'force', id: 'navratri' }, new Date(2026, 5, 20))?.id).toBe('navratri');
    expect(nextFestival(new Date(2026, 10, 1))?.festival.id).toBe('diwali');
    expect(nextFestival(new Date(2026, 10, 1))?.inDays).toBe(5);
    expect(festivalClass('independence')).toBe('fest-ind');
    expect(festivalClass('holi')).toBe('fest-holi');
  });
});

describe('generated festival artefacts are in sync (run `npm run gen:festivals`)', () => {
  it('src/styles/festivals.css', () => {
    expect(read('src/styles/festivals.css')).toBe(buildCss(FESTIVALS, FESTIVAL_THEMES));
  });
  it('index.html pre-paint window table', () => {
    const m = FW_RE.exec(read('index.html'));
    expect(m?.[0]).toBe(buildWindowJs(FESTIVALS));
  });
  it('public/admin/festivals.js', () => {
    expect(read('public/admin/festivals.js')).toBe(buildAdminJs(FESTIVALS, FESTIVAL_THEMES));
  });
});
