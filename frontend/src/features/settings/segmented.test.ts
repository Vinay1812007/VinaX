/**
 * 1.14.3 — every segmented choice in Settings (Basic/All, Theme, Display size,
 * Crossfade, Audio quality…) stopped taking clicks on desktop. The Lyrics page
 * styled its own buttons with the same class, `.vx-seg`, and gave them an
 * absolutely positioned `::after` hit pad. player.css loads on desktop as soon
 * as the Now playing panel shows, so that pad stretched over every Settings
 * group and swallowed the clicks. Phones rarely had player.css yet, so only
 * PCs broke.
 *
 * The rule pinned here: the Settings segmented classes are styled only by
 * settings.css (scoped under .vx-settings). No other stylesheet may select them.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const STYLES = join(__dirname, '../../styles');

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? cssFiles(p) : p.endsWith('.css') ? [p] : [];
  });
}

describe('the Settings segmented control', () => {
  it('is styled by settings.css alone', () => {
    const offenders = cssFiles(STYLES)
      .filter((f) => !f.endsWith(join('pages', 'settings.css')))
      .filter((f) => /\.vx-seg(?![\w-])|\.vx-seg-(item|thumb)\b/.test(readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')));
    expect(offenders).toEqual([]);
  });

  it('only lets the hit pad sit inside each button, and the thumb never takes clicks', () => {
    const css = readFileSync(join(STYLES, 'pages', 'settings.css'), 'utf8');
    expect(css).not.toMatch(/\.vx-seg::after/);
    expect(css).toMatch(/\.vx-seg-thumb\s*\{[^}]*pointer-events:\s*none/);
  });

  it('in rows (the app languages on a phone), a hit pad stops at half the 2px row gap', () => {
    const css = readFileSync(join(STYLES, 'pages', 'settings.css'), 'utf8');
    expect(css).toMatch(/\.vx-seg\s*\{[^}]*gap:\s*2px/);
    expect(css).toMatch(/\.vx-seg\.is-grid \.vx-seg-item::after\s*\{\s*inset:\s*-1px 0;?\s*\}/);
  });
});
