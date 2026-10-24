/**
 * 11.9 — GET /api/ai/headlines → { topics: [] }
 *
 * The "Trending now" strip once read headlines a scheduled job stored. No job
 * writes headlines in 14.0, so the answer is the "nothing to show" shape the
 * app already handles (it hides the strip).
 */
import { methodNotAllowed } from '../../_lib/ratelimit';

export const onRequestGet = async (): Promise<Response> =>
  new Response(JSON.stringify({ topics: [] }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=600' },
  });

export const onRequestPost = async (): Promise<Response> => methodNotAllowed();
