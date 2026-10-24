/**
 * GET /api/site-mode → { mode: 'live' | 'maintenance', note? }
 *
 * The app checks this every half hour (every minute in maintenance). The
 * owner's `site-mode` setting, or an active `maintenance-window`, puts the
 * site into maintenance; anything else is live. Cached a minute.
 */
import type { DbEnv } from '../_lib/db';
import { publicSiteMode } from '../_lib/clientConfig';
import { settingsMap } from '../_lib/settings';

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
};

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: CORS });

export const onRequestGet = async (ctx?: { env?: DbEnv }): Promise<Response> => {
  const { values } = await settingsMap(ctx?.env ?? {});
  return new Response(JSON.stringify(publicSiteMode(values)), {
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60', ...CORS },
  });
};
