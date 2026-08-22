import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('SEO configuration', () => {
  it('robots.txt disallows low-value routes and points to the sitemap', () => {
    const r = readFileSync('public/robots.txt', 'utf8');
    expect(r).toContain('Disallow: /search');
    expect(r).toContain('Disallow: /library');
    expect(r).toMatch(/Sitemap:\s*https:\/\/www\.sirimillavinay\.online\/sitemap\.xml/);
  });
  it('sitemap includes the trust pages', () => {
    // The sitemap is generated live by a Pages Function now; the static
    // routes it serves live in worker/functions/sitemap-static.xml.ts.
    const s = readFileSync('worker/functions/sitemap-static.xml.ts', 'utf8');
    for (const p of ['/privacy', '/terms', '/contact']) expect(s).toContain(p);
  });
  it('index.html exposes the prerender SEO slot and base meta', () => {
    const h = readFileSync('index.html', 'utf8');
    expect(h).toContain('id="seo-slot"');
    expect(h).toContain('name="description"');
    expect(h).toContain('application/ld+json');
  });
  it('homepage brand JSON-LD carries Organization + WebSite + SearchAction', () => {
    const h = readFileSync('index.html', 'utf8');
    expect(h).toContain('"@type":"Organization"');
    expect(h).toContain('"@type":"WebSite"');
    expect(h).toContain('"@type":"SearchAction"');
    expect(h).toContain('"alternateName"');
    expect(h).toMatch(/"name":"VinaX"/);
  });
  it('new discovery pages (/top-songs, /trending, /most-searched) are prerendered with unique SEO head', () => {
    const pre = readFileSync('scripts/prerender.mjs', 'utf8');
    for (const p of ['/top-songs', '/trending', '/most-searched']) {
      expect(pre, `prerender missing ${p}`).toContain(`p: '${p}'`);
    }
    // Each carries a unique title, description, h1 and a CollectionPage JSON-LD.
    expect(pre).toContain('Top Songs on VinaX');
    expect(pre).toContain('Trending Songs on VinaX');
    expect(pre).toContain('Most Searched Songs on VinaX');
  });
  it('new discovery pages are real registered routes', () => {
    const r = readFileSync('src/router/index.tsx', 'utf8');
    for (const p of ['top-songs', 'trending', 'most-searched']) {
      expect(r, `router missing ${p}`).toContain(`path: '${p}'`);
    }
  });
  it('canonical origin is the www form everywhere the client sets it', () => {
    // The sitemap, headers and Cloudflare host all use https://www.sirimillavinay.online
    // — any client code that stamps a canonical or absolute URL must match, or
    // Google Search Console starts flagging duplicate content (v2.6.0 hardening).
    const files = [
      'src/utils/schema.ts',
      'src/utils/share.ts',
      'src/hooks/usePageMeta.ts',
      'src/layouts/AppLayout.tsx',
      'src/utils/songCard.ts',
      'index.html',
      'scripts/prerender.mjs',
      'worker/functions/_lib/render.ts',
    ];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      // No bare (apex) origin should appear as a hard-coded string.
      expect(src, `${f} still contains apex sirimillavinay.online`).not.toMatch(
        /['"`]https:\/\/sirimillavinay\.online/,
      );
    }
  });
});
