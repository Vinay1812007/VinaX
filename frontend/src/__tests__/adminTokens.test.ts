import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain ESM helper shared with the generator script
import { buildAdminTokens } from '../../scripts/admin-tokens-core.mjs';

/**
 * UI rebuild Phase 10 — the owner console shares the app's colour-free design
 * tokens through a generated file. If tokens.css (or the radius scale in
 * index.css) changes, `npm run gen:admin-tokens` must run, or this fails.
 */
const ROOT = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

describe('owner console design tokens', () => {
  const generated = buildAdminTokens(read('src/styles/tokens.css'), read('src/styles/index.css')) as string;

  it('public/admin/css/tokens.css matches the generator (run npm run gen:admin-tokens)', () => {
    expect(read('public/admin/css/tokens.css')).toBe(generated);
  });

  it('carries the shared shape, motion, depth and layers, but no app colours', () => {
    for (const name of ['--radius-pill', '--radius-md', '--radius-control', '--dur-quick', '--ease-spring', '--press-scale', '--elev-3', '--z-toast', '--space-4']) {
      expect(generated).toContain(`${name}:`);
    }
    expect(generated).not.toMatch(/--(ink|ember|tide|surface|text|accent)-/);
    expect(generated).not.toMatch(/var\(--(vx|ink|ember|tide|glass)/);
    // Reduced motion reaches the console too.
    expect(generated).toMatch(/html\.reduce-motion \{[\s\S]*--dur-quick: 0ms;/);
  });

  it('the console links it before its own stylesheet and reads it', () => {
    const html = read('public/admin/index.html');
    expect(html.indexOf('/admin/css/tokens.css')).toBeGreaterThan(-1);
    expect(html.indexOf('/admin/css/tokens.css')).toBeLessThan(html.indexOf('/admin/console.css'));
    const css = read('public/admin/console.css');
    expect(css).toContain('--r-md: var(--radius-md)');
    expect(css).not.toMatch(/border-radius: 99px/);
  });
});
