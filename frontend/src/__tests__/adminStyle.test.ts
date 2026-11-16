import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Owner console style guard (pro admin rebuild, 2026-11-16). Every colour
 * lives in public/admin/css/theme.css, so dark and light can't drift apart
 * and no page sheet hard-codes the old marigold or glass colours. The
 * generated css/tokens.css (shape, motion, depth) is the only other exception.
 */
const ADMIN = join(__dirname, '..', '..', 'public', 'admin');
const read = (rel: string) => readFileSync(join(ADMIN, rel), 'utf8');
const sheets = ['console.css', ...readdirSync(join(ADMIN, 'css')).filter((f) => f.endsWith('.css')).map((f) => 'css/' + f)];
const EXEMPT = new Set(['css/theme.css', 'css/tokens.css']);
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('owner console styles', () => {
  it('keeps colour literals in css/theme.css only', () => {
    const bad: string[] = [];
    for (const f of sheets) {
      if (EXEMPT.has(f)) continue;
      const css = stripComments(read(f));
      for (const m of css.matchAll(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|lab)\(/g)) bad.push(`${f}: ${m[0]}`);
    }
    expect(bad).toEqual([]);
  });

  it('has no glass: no backdrop blur and no glass sheet', () => {
    for (const f of sheets) expect(stripComments(read(f)), f).not.toMatch(/backdrop-filter|--glass-|--accent-grad/);
    expect(sheets).not.toContain('css/glass.css');
    expect(read('index.html')).not.toMatch(/glass\.css|class="aurora"/);
  });

  it('has no hand-made pill radius (use 50% for circles, --radius-pill for switches)', () => {
    for (const f of sheets) expect(stripComments(read(f)), f).not.toMatch(/border-radius:\s*[^;]*\b99+px/);
  });

  it('defines every theme token for both dark and light', () => {
    const css = stripComments(read('css/theme.css'));
    const block = (sel: RegExp) => {
      const m = css.match(sel);
      expect(m, String(sel)).not.toBeNull();
      return new Set([...(m as RegExpMatchArray)[1].matchAll(/(--[\w-]+)\s*:/g)].map((x) => x[1]));
    };
    const dark = block(/:root\s*\{([\s\S]*?)\n\}/);
    const light = block(/html\.light\s*\{([\s\S]*?)\n\}/);
    expect([...dark].filter((t) => !light.has(t))).toEqual([]);
    expect([...light].filter((t) => !dark.has(t))).toEqual([]);
    for (const t of ['--bg', '--surface', '--text', '--text-3', '--accent', '--accent-fill', '--on-accent', '--ok', '--bad', '--c1', '--c6', '--shadow-float', '--scrim']) expect(dark.has(t), t).toBe(true);
  });

  it('loads theme.css right after the shared tokens and before console.css', () => {
    const html = read('index.html');
    const at = (href: string) => html.indexOf(`href="/admin/${href}"`);
    expect(at('css/tokens.css')).toBeGreaterThan(0);
    expect(at('css/theme.css')).toBeGreaterThan(at('css/tokens.css'));
    expect(at('console.css')).toBeGreaterThan(at('css/theme.css'));
  });

  it('uses only var() colours on the page sheets for every colour property', () => {
    // A named colour (red, white, black…) would also skip the theme.
    const named = /\b(?:color|background|border(?:-[a-z]+)?|fill|stroke|outline)\s*:[^;]*\b(?:white|black|red|green|blue|orange|gray|grey)\b/;
    for (const f of sheets) if (!EXEMPT.has(f)) expect(stripComments(read(f)), f).not.toMatch(named);
  });
});
