/**
 * Console rebuild — GET /api/robots → text/plain robots.txt built from the `robots`
 * setting (_lib/robots.ts). Public and cached; the website build copies it
 * into the static robots.txt (frontend/scripts/robots-from-api.mjs). Without
 * a database it answers the built-in policy.
 */
import { robotsTxt } from '../_lib/robots';
import { setting } from '../_lib/settings';
import type { DbEnv } from '../_lib/db';

export const onRequestGet = async (ctx: { request: Request; env: DbEnv }): Promise<Response> => {
  const raw = await setting(ctx.env, 'robots').catch(() => null);
  return new Response(robotsTxt(raw), {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=300', 'access-control-allow-origin': '*' },
  });
};
