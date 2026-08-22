import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { onRequestGet as sitemapIndex } from '../../functions/sitemap.xml';
import { onRequestGet as staticSitemap } from '../../functions/sitemap-static.xml';

const ORIGIN = 'https://www.sirimillavinay.online';
const locsOf = (xml: string): string[] => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

describe('sitemap index', () => {
  it('is valid XML, lists every child map as a www-absolute URL, 30-min edge cache', async () => {
    const res = await sitemapIndex();
    expect(res.headers.get('content-type')).toContain('application/xml');
    const cache = res.headers.get('cache-control') ?? '';
    expect(cache).toContain('max-age=1800');
    expect(cache).toContain('s-maxage=1800');
    const xml = await res.text();
    expect(xml.startsWith('<?xml')).toBe(true);
    expect(xml).toContain('<sitemapindex');
    for (const child of [
      'sitemap-static.xml',
      'sitemap-songs.xml',
      'sitemap-albums.xml',
      'sitemap-movies.xml',
      'sitemap-artists.xml',
    ]) {
      expect(xml).toContain(`${ORIGIN}/${child}`);
    }
    const locs = locsOf(xml);
    expect(locs.length).toBeGreaterThanOrEqual(5);
    for (const loc of locs) {
      expect(loc.startsWith(`${ORIGIN}/`), loc).toBe(true);
      expect(() => new URL(loc)).not.toThrow();
    }
  });
});

describe('static sitemap', () => {
  it('emits valid www-absolute, trailing-slash URLs incl. the new SEO pages, 30-min cache', async () => {
    const res = await staticSitemap();
    expect((res.headers.get('cache-control') ?? '').includes('max-age=1800')).toBe(true);
    const xml = await res.text();
    expect(xml.startsWith('<?xml')).toBe(true);
    const locs = locsOf(xml);
    expect(locs.length).toBeGreaterThan(15);
    for (const loc of locs) {
      expect(loc.startsWith(`${ORIGIN}/`), loc).toBe(true);
      expect(loc.endsWith('/'), `must end with a trailing slash: ${loc}`).toBe(true);
      expect(() => new URL(loc)).not.toThrow();
    }
    // Home is the bare www origin; the new SEO landing pages and trust pages resolve.
    expect(locs).toContain(`${ORIGIN}/`);
    for (const p of ['/top-songs/', '/trending/', '/most-searched/', '/charts/', '/privacy/', '/hindi-songs/']) {
      expect(locs, `missing ${p}`).toContain(`${ORIGIN}${p}`);
    }
    // Never emit an oversized sitemap (50k-URL spec limit).
    expect(locs.length).toBeLessThanOrEqual(50000);
  });
});

describe('dynamic child sitemaps (source contract)', () => {
  for (const f of ['sitemap-songs', 'sitemap-albums', 'sitemap-artists', 'sitemap-movies']) {
    it(`${f}: www origin, trailing-slash <loc> template, 30-min edge cache`, () => {
      const src = readFileSync(`functions/${f}.xml.ts`, 'utf8');
      expect(src).toContain("const ORIGIN = 'https://www.sirimillavinay.online'");
      expect(src).toContain('max-age=1800, s-maxage=1800');
      // Detail URLs are built as `${ORIGIN}/<type>/<slug>-<safeId>/` — trailing slash.
      // After audit finding M-SRV-7 the raw id is sanitised via `safeId` before interpolation.
      expect(src).toMatch(/-\$\{(?:safe)?[Ii]d\}\//);
      // And guard: the sanitisation step must be present.
      expect(src).toContain("replace(/[^\\w-]/g, '')");
    });
  }
  it('song map guards the 50k-URL sitemap limit', () => {
    expect(readFileSync('functions/sitemap-songs.xml.ts', 'utf8')).toContain('slice(0, 50000)');
  });
});
