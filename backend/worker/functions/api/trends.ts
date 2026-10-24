/**
 * GET /api/trends → { generatedAt, sources: [], items: [] }
 *
 * Verified trends were chart and editorial entries a scheduled pipeline
 * fetched, matched to catalogue songs and stored. The pipeline is gone and the
 * 14.0 schema keeps no trend tables, so there is never a source or an item: the answer is the "not connected" shape the Charts page already
 * handles (it shows the catalogue charts only). Public, no listener data,
 * cached five minutes.
 */

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
};

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: CORS });

export const onRequestGet = async (): Promise<Response> =>
  new Response(JSON.stringify({ generatedAt: new Date().toISOString(), sources: [], items: [] }), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=60, s-maxage=300', ...CORS },
  });
