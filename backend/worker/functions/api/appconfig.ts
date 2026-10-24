/**
 * Public, cached app config — what the owner published, sanitised.
 *
 *   GET /api/appconfig?key=client    → the boot bundle (greeting, FAQ, layout, …)
 *   GET /api/appconfig?key=banners   → { banners: [...] }   inside their dates, at most 10
 *   GET /api/appconfig?key=festival  → { festival: { mode, id } | null }
 *   GET /api/appconfig?key=flags     → { flags: { name: boolean } }
 *
 * Values come from the `settings` table (memoised a minute in the Worker) and
 * pass through the sanitisers in _lib/clientConfig.ts, so a bad value can
 * never break a listener's app. Without a database every key answers the
 * app's built-in defaults.
 */
import type { DbEnv } from '../_lib/db';
import { activeBanners, publicClientConfig, publicFestival, publicFlags } from '../_lib/clientConfig';
import { settingsMap } from '../_lib/settings';

const json = (o: unknown, sMaxAge = 300): Response =>
  new Response(JSON.stringify(o), {
    headers: {
      'content-type': 'application/json',
      'cache-control': `public, max-age=60, s-maxage=${sMaxAge}`,
      'access-control-allow-origin': '*',
    },
  });

export const onRequestGet = async (context: { request: Request; env?: DbEnv }): Promise<Response> => {
  const key = new URL(context.request.url).searchParams.get('key') ?? '';
  if (!['client', 'banners', 'festival', 'flags'].includes(key)) {
    return new Response(JSON.stringify({ error: 'unknown_key' }), { status: 400, headers: { 'content-type': 'application/json' } });
  }
  const { values } = await settingsMap(context.env ?? {});
  if (key === 'client') return json(publicClientConfig(values), 60);
  if (key === 'banners') return json({ banners: activeBanners(values.banners) });
  if (key === 'festival') return json({ festival: publicFestival(values.festival) }, 60);
  return json({ flags: publicFlags(values.flags) }, 60);
};

/** The sanitisers, re-exported for callers that reach them through this route. */
export { activeBanners, publicFlags, type Banner } from '../_lib/clientConfig';
