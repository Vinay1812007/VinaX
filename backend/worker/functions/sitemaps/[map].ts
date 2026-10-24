/**
 * Paginated corpus sitemaps — /sitemaps/<songs|albums|artists|playlists>-<n>.xml
 *
 * These pages once listed a crawled URL corpus. No crawler runs in 14.0 and
 * the schema keeps no corpus, so page 1 of a known type is an empty, valid
 * urlset and any other page is a 404. The sitemap
 * index stopped advertising these maps in 13.6.0; the route still answers for
 * anyone who kept a link.
 *
 * NOTE the path shape: this file is functions/sitemaps/[map].ts — a param
 * segment, NOT a new dotted function filename (new dotted names like
 * `foo.xml.ts` fail the whole Cloudflare Pages deploy).
 */
const TYPES = new Set(['songs', 'albums', 'artists', 'playlists']);

export const onRequestGet = async (context: { params: { map: string } }): Promise<Response> => {
  const m = /^([a-z]+)-(\d{1,4})\.xml$/.exec(String(context.params.map ?? ''));
  if (!m || !TYPES.has(m[1]) || Number(m[2]) !== 1) return new Response('not found', { status: 404 });
  return new Response('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>', {
    headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=1800, s-maxage=21600' },
  });
};
