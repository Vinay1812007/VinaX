/**
 * 13.2 — pins two fixes that no screenshot test would catch on a desktop:
 *
 * 1. The app's text is in the style's face, never the device's. index.html
 *    once gave #root a system-font stack (for the boot splash); the whole app
 *    mounts in #root, so everything without its own font-family inherited
 *    the DEVICE font — on Android phones with a theme font, VinaX rendered in
 *    the listener's novelty font. The face belongs on <body>.
 * 2. A flat style's opaque materials actually win in the light theme. The
 *    light glass rule in base.css is `html.light[data-template]:not([class*='fest-'])`
 *    — specificity (0,3,1) — and a plain `html.light[data-template='pulse']`
 *    (0,2,1) lost to it, shipping see-through bars with no blur.
 *
 * Plus the type contract: each style names its own display face, every
 * self-hosted face has its file and its licence, and no style lets a system
 * stack lead (the device font would win on Android).
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string): string => readFileSync(p, 'utf8');
const STYLES = ['aura', 'pulse', 'sangam', 'nocturne', 'marquee', 'vibe'] as const;

describe('the app text is in the style face, never the device font', () => {
  it('#root sets no font-family; body carries the boot face', () => {
    const html = read('index.html');
    const rootRule = /#root\s*\{([^}]*)\}/.exec(html)?.[1] ?? '';
    expect(rootRule).not.toMatch(/font-family/);
    expect(html).toMatch(/\bbody\s*\{[^}]*font-family:\s*'Manrope'/);
  });

  it('no style leads its body or display stack with a system font', () => {
    for (const id of STYLES) {
      const css = read(`src/styles/templates/${id}.css`);
      for (const m of css.matchAll(/--(?:tpl-font-body|vx-font-display):\s*([^;]+);/g)) {
        const first = m[1].split(',')[0].trim();
        expect(first, `${id}: ${m[0]}`).not.toMatch(/^(system-ui|-apple-system|sans-serif|BlinkMacSystemFont)$/);
      }
    }
  });
});

describe('display faces', () => {
  const FACES: Record<string, { file: string; licence: string }> = {
    Archivo: { file: 'archivo-var.woff2', licence: 'archivo-OFL.txt' },
    Eczar: { file: 'eczar-var.woff2', licence: 'eczar-OFL.txt' },
    'Big Shoulders Display': { file: 'big-shoulders-var.woff2', licence: 'big-shoulders-OFL.txt' },
    'Baloo 2': { file: 'baloo2-var.woff2', licence: 'baloo2-OFL.txt' },
  };

  it('every self-hosted face is declared, shipped and licensed (SIL OFL)', () => {
    const base = read('src/styles/templates/base.css');
    for (const [family, { file, licence }] of Object.entries(FACES)) {
      expect(base, family).toContain(`font-family: '${family}'`);
      expect(base, family).toContain(`/fonts/${file}`);
      expect(existsSync(`public/fonts/${file}`), file).toBe(true);
      expect(read(`public/fonts/${licence}`)).toMatch(/SIL OPEN FONT LICENSE/);
    }
  });

  it('each style speaks in its own display face', () => {
    const want: Record<string, string> = { pulse: 'Archivo', sangam: 'Eczar', nocturne: 'Bricolage Grotesque', marquee: 'Big Shoulders Display', vibe: 'Baloo 2', aura: 'Manrope' };
    for (const [id, face] of Object.entries(want)) {
      const css = read(`src/styles/templates/${id}.css`);
      expect(/--vx-font-display:\s*'([^']+)'/.exec(css)?.[1], id).toBe(face);
    }
  });

  it('the picker sets every style name in that style face', () => {
    const css = read('src/styles/pages/settings.css');
    for (const id of STYLES) expect(css, id).toMatch(new RegExp(`\\.vx-tpl-card\\[data-tpl='${id}'\\] \\.vx-tpl-name \\{[^}]*font-family`));
  });
});

describe('flat styles stay opaque in the light theme', () => {
  it('Pulse and Marquee match the light glass rule specificity for all four materials', () => {
    for (const id of ['pulse', 'marquee']) {
      const css = read(`src/styles/templates/${id}.css`);
      // The selector also opens the style's colour block: find the one that sets the materials.
      const blocks = [...css.matchAll(new RegExp(`html\\.light\\[data-template='${id}'\\]:not\\(\\[class\\*='fest-'\\]\\)\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[1]);
      const block = blocks.find((b) => b.includes('--vx-mat-')) ?? '';
      for (const mat of ['thin', 'regular', 'chrome', 'thick']) expect(block, `${id} --vx-mat-${mat}`).toMatch(new RegExp(`--vx-mat-${mat}:\\s*rgb\\(var\\(--ink-950\\)\\);`));
    }
  });

  it('the glass styles give the mini player and tab bar a readable floor', () => {
    const base = read('src/styles/templates/base.css');
    expect(base).toMatch(/:is\(\.np-mini, \.vx-dock\)\s*\{\s*--vx-mat-chrome: rgb\(var\(--ink-950\) \/ clamp\(0\.9,/);
    expect(base).toMatch(/html\.light:is\([^)]*\) :is\(\.np-mini, \.vx-dock\)\s*\{\s*--vx-mat-chrome: rgb\(var\(--ink-950\) \/ clamp\(0\.93,/);
  });
});
