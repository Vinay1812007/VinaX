/**
 * Console rebuild — the website build copies robots.txt from the console's bot
 * choices (scripts/robots-from-api.mjs) only when the answer is clearly a
 * robots file; anything else keeps the committed public/robots.txt.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain ESM build script without types
import { looksLikeRobots } from '../../scripts/robots-from-api.mjs';

describe('robots-from-api', () => {
  it('accepts a real robots file and the committed one', () => {
    expect(looksLikeRobots(readFileSync(join(__dirname, '..', '..', 'public', 'robots.txt'), 'utf8'))).toBe(true);
  });
  it('refuses an HTML page, an error and an empty answer', () => {
    expect(looksLikeRobots('<!doctype html><html>User-agent: *\nSitemap: https://x</html>')).toBe(false);
    expect(looksLikeRobots('{"error":"db_unavailable"}')).toBe(false);
    expect(looksLikeRobots('')).toBe(false);
    expect(looksLikeRobots(null)).toBe(false);
  });
});
