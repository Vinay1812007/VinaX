/**
 * 13.2 — pins two fixes that no screenshot test would catch on a desktop:
 *
 * 1. The app's text is in the style's face, never the device's. index.html
 *    once gave #root a system-font stack (for the boot splash); the whole app
 *    mounts in #root, so everything without its own font-family inherited
 *    the DEVICE font — on Android phones with a theme font, VinaX rendered in
 *    the listener's novelty font. The face belongs on <body>.
 * 2. A flat style's opaque materials actually win in the light theme. The
 *    light glass rule in base.css is `html.light[data-template]:root`
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
const STYLES = ['vinax'] as const;

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
  const FACES: Record<string, { file: string; licence: string | null }> = {
    'Bricolage Grotesque': { file: 'bricolage-var.woff2', licence: 'bricolage-OFL.txt' },
    Manrope: { file: 'manrope-var.woff2', licence: null },
  };

  it('every self-hosted face is declared and shipped, and the display face is licensed (SIL OFL)', () => {
    const base = read('src/styles/index.css');
    for (const [family, { file, licence }] of Object.entries(FACES)) {
      expect(base, family).toContain(`font-family: '${family}'`);
      expect(base, family).toContain(`/fonts/${file}`);
      expect(existsSync(`public/fonts/${file}`), file).toBe(true);
      if (licence) expect(read(`public/fonts/${licence}`)).toMatch(/SIL OPEN FONT LICENSE/);
    }
  });

  it('the look speaks in Bricolage Grotesque', () => {
    for (const id of STYLES) {
      const css = read(`src/styles/templates/${id}.css`);
      expect(/--vx-font-display:\s*'([^']+)'/.exec(css)?.[1], id).toBe('Bricolage Grotesque');
    }
  });

  it('no retired face is still declared', () => {
    const css = read('src/styles/templates/base.css') + read('src/styles/index.css');
    for (const gone of ['Inter', 'Figtree', 'Archivo', 'Baloo 2']) expect(css, gone).not.toContain(`font-family: '${gone}'`);
  });
});

describe('the solid look stays opaque in the light theme', () => {
  it('matches the light glass rule specificity for all four materials', () => {
    for (const id of STYLES) {
      const css = read(`src/styles/templates/${id}.css`);
      // The selector also opens the style's colour block: find the one that sets the materials.
      const blocks = [...css.matchAll(new RegExp(`html\\.light\\[data-template='${id}'\\]:root\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[1]);
      const block = blocks.find((b) => b.includes('--vx-mat-')) ?? '';
      for (const mat of ['thin', 'regular', 'chrome', 'thick']) expect(block, `${id} --vx-mat-${mat}`).toMatch(new RegExp(`--vx-mat-${mat}:\\s*rgb\\(var\\(--ink-950\\)\\);`));
    }
  });
});
