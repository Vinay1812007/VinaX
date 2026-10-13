/**
 * 11.9 — GET /api/ai/headlines → { updatedAt, topics: [{ id, label, items: [{ title, url, site }] }] }
 * or { topics: [] } when there is nothing to show (switched off, not set up,
 * or older than a day). Reads the row the scheduled job stores
 * (_lib/headlines.ts); never searches. The same for every listener.
 */
import { currentHeadlines } from '../../_lib/headlines';
import { methodNotAllowed } from '../../_lib/ratelimit';
import type { SerperEnv } from '../../_lib/serper';

export const onRequestGet = async (context: { env: SerperEnv }): Promise<Response> => {
  const doc = await currentHeadlines(context.env).catch(() => null);
  return new Response(JSON.stringify(doc ?? { topics: [] }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=600' },
  });
};

export const onRequestPost = async (): Promise<Response> => methodNotAllowed();
