/**
 * V2 1.0.1 — the console's SEO tab (/api/admin/seo): what it reads from a
 * page, a sitemap and robots.txt, and the live run against a fake site.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { auditHtml, onRequestGet, readRobots, readSitemap } from '../functions/api/admin/seo';

const ORIGIN = 'https://www.vinaxmusic.online';
const good = `<!doctype html><html><head><title>Telugu Romantic Songs — Stream Free | VinaX</title>
<meta name="description" content="The best Telugu romantic songs — love songs and duets. Stream free on VinaX, no login, tuned to you."/>
<link rel="canonical" href="${ORIGIN}/telugu-romantic-songs"/><meta property="og:image" content="x"/>
<script type="application/ld+json">[{"@context":"https://schema.org","@type":"CollectionPage"},{"@type":"BreadcrumbList"}]</script></head>
<body><div id="root"><main id="seo-content"><h1>Telugu Romantic Songs</h1><p>${'word '.repeat(80)}</p></main></div></body></html>`;

describe('auditHtml', () => {
  it('reads a good page and finds nothing wrong', () => {
    const a = auditHtml('/telugu-romantic-songs', 200, good, ORIGIN);
    expect(a.issues).toEqual([]);
    expect(a.h1).toBe('Telugu Romantic Songs');
    expect(a.jsonLd).toEqual(['CollectionPage', 'BreadcrumbList']);
    expect(a.words).toBeGreaterThan(60);
  });

  it('names what is wrong: the app shell where a page should be', () => {
    const shell = `<html><head><title>VinaX — Free Music Streaming for India</title><link rel="canonical" href="${ORIGIN}/"/></head><body><div id="root"></div></body></html>`;
    const a = auditHtml('/song/x-1', 200, shell, ORIGIN);
    expect(a.issues).toEqual(expect.arrayContaining(['no meta description', 'canonical points to /', 'no H1', 'no structured data']));
    expect(auditHtml('/x', 404, '', ORIGIN).issues[0]).toBe('answers 404');
  });
});

describe('sitemaps and robots', () => {
  it('counts URLs and the newest lastmod', () => {
    expect(readSitemap('<urlset><url><loc> https://a/1 </loc><lastmod>2026-10-01</lastmod></url><url><loc>https://a/2</loc><lastmod>2026-10-25</lastmod></url></urlset>')).toEqual({ locs: ['https://a/1', 'https://a/2'], lastmod: '2026-10-25' });
  });
  it('reads the sitemap line and the blocked crawlers', () => {
    const r = readRobots('User-agent: GPTBot\nUser-agent: CCBot\nDisallow: /\n\nUser-agent: *\nAllow: /\nDisallow: /admin/\n\nSitemap: https://www.vinaxmusic.online/sitemap.xml\n');
    expect(r).toEqual({ sitemaps: ['https://www.vinaxmusic.online/sitemap.xml'], blockedAgents: ['GPTBot', 'CCBot'], disallowAll: false });
    expect(readRobots('User-agent: *\nDisallow: /').disallowAll).toBe(true);
  });
});

describe('GET /api/admin/seo', () => {
  afterEach(() => vi.unstubAllGlobals());
  const env = { ADMIN_LOGIN_PASSWORD: 'test-secret' };
  const req = (q = '') => new Request(`https://admin.vinaxmusic.online/api/admin/seo${q}`, { headers: { 'x-admin-token': 'test-secret', 'cf-connecting-ip': '198.51.100.40' } });

  it('needs the admin token', async () => {
    const res = await onRequestGet({ request: new Request('https://admin.vinaxmusic.online/api/admin/seo', { headers: { 'cf-connecting-ip': '198.51.100.41' } }), env });
    expect(res.status).toBe(401);
  });

  it('reads robots, every sitemap and a page sample from the live site', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      const path = new URL(u).pathname;
      seen.push(new URL(u).origin + path);
      if (path === '/robots.txt') return new Response(`User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/sitemap.xml`);
      if (path === '/sitemap.xml') return new Response(`<sitemapindex><sitemap><loc>${ORIGIN}/sitemap-hubs.xml</loc><lastmod>2026-10-25</lastmod></sitemap><sitemap><loc>${ORIGIN}/entity-pages.xml</loc></sitemap></sitemapindex>`);
      if (path === '/sitemap-hubs.xml') return new Response(`<urlset><url><loc>${ORIGIN}/telugu-romantic-songs</loc></url><url><loc>${ORIGIN}/hindi-romantic-songs</loc></url></urlset>`);
      if (path === '/entity-pages.xml') return new Response(`<urlset><url><loc>${ORIGIN}/song/a-1</loc></url><url><loc>${ORIGIN}/artist/b-2</loc></url></urlset>`);
      return new Response(good.replace(/\/telugu-romantic-songs"/, `${path}"`));
    }));
    const res = await onRequestGet({ request: req(), env });
    expect(res.status).toBe(200);
    const d = (await res.json()) as { indexable: number; maps: Array<{ urls: number }>; pages: Array<{ path: string }>; robots: { sitemaps: string[] } };
    expect(d.indexable).toBe(4);
    expect(d.maps.map((m) => m.urls)).toEqual([2, 2]);
    expect(d.pages.map((p) => p.path)).toEqual(expect.arrayContaining(['/', '/telugu-romantic-songs', '/song/a-1', '/artist/b-2']));
    expect(d.robots.sitemaps).toEqual([`${ORIGIN}/sitemap.xml`]);
    // It reads the public site (www), never the console host.
    expect(seen.every((u) => u.startsWith(ORIGIN))).toBe(true);
  });

  it('audits one path on request, and refuses anything that is not a path', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(good)));
    const d = (await (await onRequestGet({ request: req('?path=/telugu-romantic-songs'), env })).json()) as { page: { issues: string[] } };
    expect(d.page.issues).toEqual([]);
    expect((await onRequestGet({ request: req('?path=https://evil.example/'), env })).status).toBe(400);
    expect((await onRequestGet({ request: req('?path=/../x'), env })).status).toBe(400);
  });
});
