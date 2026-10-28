import { describe, it, expect, vi, afterEach } from 'vitest';
import { onRequestGet as sitemapIndex } from '../functions/sitemap.xml';
import { onRequestGet as staticSitemap } from '../functions/sitemap-static.xml';

const ORIGIN = 'https://www.vinaxmusic.online';
const locsOf = (xml: string): string[] => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

afterEach(() => vi.restoreAllMocks());

describe('sitemap index', () => {
  it('13.6.0: lists only maps whose URLs answer with their own text; www-absolute; 30-min edge cache', async () => {
    const res = await sitemapIndex();
    expect(res.headers.get('content-type')).toContain('application/xml');
    const cache = res.headers.get('cache-control') ?? '';
    expect(cache).toContain('max-age=1800');
    expect(cache).toContain('s-maxage=1800');
    const xml = await res.text();
    expect(xml.startsWith('<?xml')).toBe(true);
    expect(xml).toContain('<sitemapindex');
    expect(locsOf(xml)).toEqual([`${ORIGIN}/sitemap-static.xml`, `${ORIGIN}/sitemap-hubs.xml`]);
    // The entity routes serve the app shell (home's text + canonical) since
    // they left the Worker: their live-search and corpus maps advertised copies of home.
    for (const gone of ['entity-pages.xml', 'sitemap-albums.xml', 'sitemap-movies.xml', 'sitemap-artists.xml', 'sitemap-songs.xml', 'sitemaps/']) {
      expect(xml).not.toContain(`${ORIGIN}/${gone}`);
    }
  });

  it('makes no Supabase or catalog request (one Worker invocation, nothing behind it)', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    await sitemapIndex();
    expect(f).not.toHaveBeenCalled();
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
