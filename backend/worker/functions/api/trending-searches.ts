/** Community top searches — the chips under the search bar.
 *
 *  Search terms are not recorded (usage events carry no query text), so there
 *  is nothing to rank: the list is always empty, the shape installed apps
 *  expect (they then show no chips). */

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
};

export const onRequestOptions = async (): Promise<Response> =>
  new Response(null, { status: 204, headers: CORS });

export const onRequestGet = async (): Promise<Response> =>
  new Response(JSON.stringify({ queries: [] }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=600', ...CORS },
  });
