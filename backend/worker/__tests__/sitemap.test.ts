import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { onRequestGet as sitemapIndex } from '../functions/sitemap.xml';
import { onRequestGet as staticSitemap } from '../functions/sitemap-static.xml';

const ORIGIN = 'https://www.sirimillavinay.online';
const locsOf = (xml: string): string[] => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

afterEach(() => vi.restoreAllMocks());

describe('sitemap index', () => {
  it('is valid XML, lists every child map as a www-absolute URL, 30-min edge cache', async () => {
    // Supabase unconfigured → the index degrades to exactly the legacy maps.
    const res = await sitemapIndex({ env: {} });
    expect(res.headers.get('content-type')).toContain('application/xml');
    const cache = res.headers.get('cache-control') ?? '';
    expect(cache).toContain('max-age=1800');
    expect(cache).toContain('s-maxage=1800');
    const xml = await res.text();
    expect(xml.startsWith('<?xml')).toBe(true);
    expect(xml).toContain('<sitemapindex');
    for (const child of [
      'sitemap-static.xml',
      'sitemap-hubs.xml',
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

  it('adds paginated corpus maps when the SEO corpus has rows (4.15.0)', async () => {
    // sbCount does a HEAD with Prefer: count=exact and reads content-range.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) => {
        const u = String(url);
        // 23k songs → 3 pages; everything else empty.
        const total = u.includes('type=eq.song') ? 23000 : 0;
        return new Response(null, { status: 200, headers: { 'content-range': `0-0/${total}` } });
      }),
    );
    const res = await sitemapIndex({ env: { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' } });
    const xml = await res.text();
    // 23k songs at 1000/page (Supabase max-rows cap, 4.16.3) → 23 pages.
    for (const n of [1, 12, 23]) expect(xml).toContain(`${ORIGIN}/sitemaps/songs-${n}.xml`);
    expect(xml).not.toContain('/sitemaps/songs-24.xml');
    expect(xml).not.toContain('/sitemaps/albums-1.xml');
    // Legacy children survive alongside the corpus maps.
    expect(xml).toContain(`${ORIGIN}/sitemap-songs.xml`);
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
      const src = readFileSync(`worker/functions/${f}.xml.ts`, 'utf8');
      expect(src).toContain("const ORIGIN = 'https://www.sirimillavinay.online'");
      expect(src).toContain('max-age=1800, s-maxage=1800');
      // Detail URLs are built as `${ORIGIN}/<type>/<slug>-<safeId>` — NO trailing
      // slash since 4.16.3: sitemap URLs must byte-match the entity canonicals,
      // or Google files them as "Alternative page with proper canonical tag".
      expect(src).toMatch(/-\$\{(?:safe)?[Ii]d\}`\)/);
      expect(src).not.toMatch(/-\$\{(?:safe)?[Ii]d\}\//);
      // And guard: the sanitisation step must be present.
      expect(src).toContain("replace(/[^\\w-]/g, '')");
    });
  }
  it('song map guards the 50k-URL sitemap limit', () => {
    expect(readFileSync('worker/functions/sitemap-songs.xml.ts', 'utf8')).toContain('slice(0, 50000)');
  });
});
