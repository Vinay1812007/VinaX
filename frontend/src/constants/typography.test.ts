/**
 * 13.2 — pins two fixes that no screenshot test would catch on a desktop:
 *
 * 1. The app's text is in the style's face, never the device's. index.html
 *    once gave #root a system-font stack (for the boot splash); the whole app
 *    mounts in #root, so everything without its own font-family inherited
 *    the DEVICE font — on Android phones with a theme font, VinaX rendered in
 *    the listener's novelty font. The face belongs on <body>.
 * 2. (1.15: there is no light theme any more; the one look is solid.)
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
    expect(html).toMatch(/\bbody\s*\{[^}]*font-family:\s*'Figtree'/);
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
  // 1.15 — one face, Figtree (the owner console still ships Bricolage and Manrope itself).
  const FACES: Record<string, { file: string; licence: string | null }> = {
    Figtree: { file: 'figtree-var.woff2', licence: 'figtree-OFL.txt' },
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

  it('the look speaks in Figtree, titles and body alike', () => {
    for (const id of STYLES) {
      const css = read(`src/styles/templates/${id}.css`);
      expect(/--vx-font-display:\s*'([^']+)'/.exec(css)?.[1], id).toBe('Figtree');
    }
    expect(read('src/styles/templates/base.css')).toMatch(/--tpl-font-body:\s*'Figtree'/);
  });

  it('no retired face is still declared in the app', () => {
    const css = read('src/styles/templates/base.css') + read('src/styles/index.css');
    for (const gone of ['Inter', 'Archivo', 'Baloo 2', 'Bricolage Grotesque', 'Manrope']) expect(css, gone).not.toContain(`font-family: '${gone}'`);
  });
});
