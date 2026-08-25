/**
 * Paginated corpus sitemaps — /sitemaps/<songs|albums|artists|playlists>-<n>.xml
 *
 * Serves 10k-URL pages straight from the vinax_seo_urls corpus (fed by the
 * seo-crawl walker + entity renders + live-search sitemaps), so the total URL
 * count the /sitemap.xml index can advertise is unbounded — this is what
 * takes the site from "a few thousand discoverable pages" to JioSaavn-scale.
 *
 * NOTE the path shape: this file is functions/sitemaps/[map].ts — a param
 * segment, NOT a new dotted function filename (new dotted names like
 * `foo.xml.ts` fail the whole Cloudflare Pages deploy; see ops rule from the
 * 4.14.x ads.txt outage). The legacy /sitemap-*.xml functions predate that
 * rule and stay as-is.
 */
import { dbSelect, type DbEnv } from '../_lib/db';
import { SEO_PAGE_SIZE, SEO_TYPES, slugify } from '../_lib/seo';

const ORIGIN = 'https://www.sirimillavinay.online';

interface UrlRow {
  entity_id: string;
  slug: string;
  title: string | null;
  lastmod: string | null;
}

function xmlEscapePath(s: string): string {
  // slugs/ids are already allow-listed at write time; enforce again on read
  // (defense in depth, audit M-SRV-7) so nothing can break XML wellformedness.
  return s.replace(/[^\w-]/g, '');
}

export const onRequestGet = async (context: {
  request: Request;
  env: DbEnv;
  params: { map: string };
}): Promise<Response> => {
  const m = /^([a-z]+)-(\d{1,4})\.xml$/.exec(String(context.params.map ?? ''));
  const type = m ? SEO_TYPES[m[1]] : undefined;
  const page = m ? Number(m[2]) : 0;
  if (!type || page < 1) return new Response('not found', { status: 404 });

  const offset = (page - 1) * SEO_PAGE_SIZE;
  const rows = await dbSelect<UrlRow>(
    context.env,
    'vinax_seo_urls',
    `type=eq.${type}&select=entity_id,slug,title,lastmod&order=added_at.asc,key.asc&limit=${SEO_PAGE_SIZE}&offset=${offset}`,
  );
  if (!rows.length && page > 1) return new Response('not found', { status: 404 });

  const body =
    '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
    rows
      .map((r) => {
        const id = xmlEscapePath(r.entity_id);
        // Recompute from the stored TITLE (entity-stripped slugify) so the
        // sitemap slug always byte-matches the canonical the page declares —
        // rows harvested before 4.17.6 carry stale '-quot-' style slugs.
        const slug = xmlEscapePath(r.title ? slugify(r.title) : r.slug) || 'x';
        if (!id) return '';
        const lastmod = (r.lastmod ?? '').slice(0, 10) || new Date().toISOString().slice(0, 10);
        // NO trailing slash — must byte-match the canonical the entity page
        // declares (/type/slug-id), or Google files every sitemap URL under
        // "Alternative page with proper canonical tag" instead of indexing it.
        return `<url><loc>${ORIGIN}/${type}/${slug}-${id}</loc><lastmod>${lastmod}</lastmod><changefreq>monthly</changefreq><priority>0.6</priority></url>`;
      })
      .join('') +
    '</urlset>';
  return new Response(body, {
    headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=1800, s-maxage=21600' },
  });
};
