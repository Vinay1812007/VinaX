import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 1.21.2 — VinaX AI with High contrast on. The sidebar and the composer are
 * filled by a ::before layer; the look hides that layer and paints its own
 * fill, but only outside high contrast (`html:not(.hc)`). When the layer was
 * hidden for everyone, High contrast had no fill at all: on a phone the chats
 * drawer was see-through and the chat printed through the chat list.
 */
describe('VinaX AI keeps solid fills in high contrast', () => {
  const css = readFileSync(resolve(__dirname, '../styles/pages/vinaxai.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  it('hides the sidebar and composer fill layers only outside high contrast', () => {
    for (const part of ['side', 'composer']) {
      const hides = [...css.matchAll(new RegExp(`([^{}]*\\.vx-ai-${part}::before)\\s*\\{\\s*display:\\s*none;?\\s*\\}`, 'g'))].map((m) => m[1].trim());
      expect(hides.length, `${part}: the look hides its ::before somewhere`).toBeGreaterThan(0);
      for (const sel of hides) expect(sel, `${part}: "${sel}" must be limited to html:not(.hc)`).toContain('html:not(.hc)');
    }
  });

  it('the fill layers still have a colour of their own for high contrast to use', () => {
    expect(css).toMatch(/\.vx-ai-side::before\s*\{\s*background:\s*rgb\(var\(--ink-950\)\)/);
    expect(css).toMatch(/\.vx-ai-side\.is-drawer::before\s*\{\s*background:\s*rgb\(var\(--ink-850\)\)/);
  });
});
