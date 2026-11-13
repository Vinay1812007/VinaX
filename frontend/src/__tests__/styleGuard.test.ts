import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * UI rebuild Phase 11 — the style guard. New CSS reads the design tokens
 * (styles/tokens.css: colours, radii, durations, curves); this keeps the
 * raw values from creeping back:
 *   - no raw pill radius (999px / 9999px) anywhere: use var(--radius-pill);
 *   - the design system's own files (tokens.css, ui.css) stay token-only;
 *   - every other stylesheet may only LOSE raw hex colours and raw ms
 *     durations: its count can never rise above the baseline below.
 * Lower a baseline when you remove raw values; never raise it — add a token.
 * Artwork-like colours (the Live orb's rainbow, demo covers, masks) are the
 * legitimate remainder.
 */
const STYLES = join(__dirname, '..', 'styles');
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p) : p.endsWith('.css') ? [p] : [];
});
const code = (p: string) => readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const hex = (s: string) => (s.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).length;
const ms = (s: string) => (s.match(/\b\d{2,4}ms\b/g) ?? []).length;

/** [raw hex colours, raw ms durations] per stylesheet, measured 2026-11-13. */
const BASELINE: Record<string, [number, number]> = {
  'dussehra-scene.css': [37, 0],
  'features.css': [0, 2],
  'festivals.css': [15, 0],
  'index.css': [13, 9],
  'overlays.css': [5, 8],
  'pages/browse.css': [4, 1],
  'pages/design.css': [19, 1],
  'pages/festivals.css': [4, 1],
  'pages/home.css': [2, 1],
  'pages/language-picker.css': [0, 1],
  'pages/library.css': [3, 2],
  'pages/player.css': [17, 6],
  'pages/radio.css': [2, 1],
  'pages/secondary.css': [11, 2],
  'pages/settings.css': [16, 0],
  'pages/together.css': [5, 2],
  'pages/tracklist.css': [3, 7],
  'pages/vinaxai.css': [27, 25],
  'public.css': [2, 0],
  'shell.css': [5, 3],
  'signin.css': [5, 0],
  'templates/base.css': [2, 1],
  'templates/harbour.css': [2, 3],
  'templates/lumen.css': [2, 1],
  'templates/monsoon.css': [2, 1],
  'templates/onyx.css': [2, 3],
  'templates/verdant.css': [2, 4],
  'templates/verse.css': [2, 1],
  'tokens.css': [6, 6],
  'ui.css': [4, 1]
};
/** Sign-in and the public pages belong to UI rebuild Phase 9, which moves them onto the tokens. */
const PILL_PENDING = new Set(['signin.css', 'public.css', 'auth.css']);

describe('style guard', () => {
  const all = files(STYLES).map((p) => [relative(STYLES, p), code(p)] as const);

  it('found the stylesheets', () => expect(all.length).toBeGreaterThan(20));

  it('no raw pill radius: use var(--radius-pill)', () => {
    const bad = all.filter(([f, s]) => !PILL_PENDING.has(f) && /border-radius:\s*9{3,4}px/.test(s)).map(([f]) => f);
    expect(bad).toEqual([]);
  });

  it('the design system files stay token-only', () => {
    const ui = all.find(([f]) => f === 'ui.css')![1];
    expect(ms(ui), 'ui.css: use --dur-*').toBe(0);
    expect(ui.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [], 'ui.css: only white (thumbs, danger labels)').toEqual((ui.match(/#fff\b/g) ?? []));
  });

  it('no stylesheet gains raw colours or durations', () => {
    const over: string[] = [];
    for (const [f, s] of all) {
      const [h, m] = BASELINE[f] ?? [0, 0];
      if (hex(s) > h) over.push(`${f}: ${hex(s)} raw colours (baseline ${h}) — use a token`);
      if (ms(s) > m) over.push(`${f}: ${ms(s)} raw durations (baseline ${m}) — use --dur-*`);
    }
    expect(over).toEqual([]);
  });
});
