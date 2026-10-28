/**
 * Build-time SEO files (scripts/prerender-seo.mjs): the hubs and sitemaps,
 * and where they are written.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — a plain .mjs build script, no types
import { HUB_PATHS, STATIC_SITEMAPS, hubFileFor } from '../../scripts/prerender-seo.mjs';

describe('V2 1.0 — hubs and sitemaps are static files, not Worker requests', () => {
  it('builds all 72 mood × language hubs as flat files', () => {
    expect(HUB_PATHS).toHaveLength(72);
    expect(hubFileFor('/telugu-romantic-songs')).toBe(join('dist', 'telugu-romantic-songs.html'));
    expect(hubFileFor('/telugu-songs')).toBeNull();
    expect(hubFileFor('/../etc-romantic-songs')).toBeNull();
  });

  it('writes the sitemap index and the maps it lists', () => {
    expect(STATIC_SITEMAPS.map(([f]: [string, string]) => f)).toEqual(['sitemap.xml', 'sitemap-static.xml', 'sitemap-hubs.xml']);
  });

  it('keeps the hubs and sitemaps off the Worker routes', () => {
    const toml = readFileSync(resolve(__dirname, '../../../backend/worker/wrangler.toml'), 'utf8');
    const patterns = [...toml.matchAll(/pattern = "([^"]+)"/g)].map((m) => m[1]);
    expect(patterns.some((p) => /-songs\*?$/.test(p))).toBe(false);
    expect(patterns.some((p) => p.includes('/sitemap'))).toBe(false);
    expect(patterns).toContain('www.vinaxmusic.online/api/*');
  });
});
