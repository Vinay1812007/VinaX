/**
 * VinaX backend — standalone Cloudflare Worker.
 *
 * Serves every dynamic route that used to run as Cloudflare Pages Functions
 * (modules under ./functions are unchanged). Bound to the production domain
 * via the routes in wrangler.toml; the static frontend stays on Cloudflare
 * Pages, which is also the fallthrough origin for anything unmatched.
 *
 * The adapter reproduces the Pages Functions contract:
 * { request, env, params, next, waitUntil, data } plus an env.ASSETS.fetch
 * shim that fetches the Pages deployment named by ASSETS_HOST (redirects
 * followed, so /index.html normalization on Pages still yields the shell).
 */

import { onRequest as hostMiddleware } from './functions/_middleware';
import * as m_album_id from './functions/album/[id]';
import * as m_api_admin_activity from './functions/api/admin/activity';
import * as m_api_admin_ai from './functions/api/admin/ai';
import * as m_api_admin_ailab from './functions/api/admin/ailab';
import * as m_api_admin_appconfig from './functions/api/admin/appconfig';
import * as m_api_admin_audit from './functions/api/admin/audit';
import * as m_api_admin_catalog_search from './functions/api/admin/catalog-search';
import * as m_api_admin_content from './functions/api/admin/content';
import * as m_api_admin_dataquality from './functions/api/admin/dataquality';
import * as m_api_admin_digest from './functions/api/admin/digest';
import * as m_api_admin_engagement from './functions/api/admin/engagement';
import * as m_api_admin_enginetest from './functions/api/admin/enginetest';
import * as m_api_admin_experiments from './functions/api/admin/experiments';
import * as m_api_admin_feedback from './functions/api/admin/feedback';
import * as m_api_admin_growth from './functions/api/admin/growth';
import * as m_api_admin_health from './functions/api/admin/health';
import * as m_api_admin_insights from './functions/api/admin/insights';
import * as m_api_admin_live from './functions/api/admin/live';
import * as m_api_admin_location from './functions/api/admin/location';
import * as m_api_admin_maintenance from './functions/api/admin/maintenance';
import * as m_api_admin_music from './functions/api/admin/music';
import * as m_api_admin_notifylog from './functions/api/admin/notifylog';
import * as m_api_admin_overview from './functions/api/admin/overview';
import * as m_api_admin_push from './functions/api/admin/push';
import * as m_api_admin_realtime from './functions/api/admin/realtime';
import * as m_api_admin_retention from './functions/api/admin/retention';
import * as m_api_admin_rooms from './functions/api/admin/rooms';
import * as m_api_admin_search_analytics from './functions/api/admin/search-analytics';
import * as m_api_admin_technical from './functions/api/admin/technical';
import * as m_api_admin_user from './functions/api/admin/user';
import * as m_api_admin_users from './functions/api/admin/users';
import * as m_api_announcements from './functions/api/announcements';
import * as m_api_apk from './functions/api/apk';
import * as m_api_appconfig from './functions/api/appconfig';
import * as m_api_assistant from './functions/api/assistant';
import * as m_api_blocklist from './functions/api/blocklist';
import * as m_api_cron_ai_daily_push from './functions/api/cron/ai-daily-push';
import * as m_api_cron_seo_crawl from './functions/api/cron/seo-crawl';
import * as m_api_cron_song_push from './functions/api/cron/song-push';
import * as m_api_cron_weekly_digest from './functions/api/cron/weekly-digest';
import * as m_api_dj from './functions/api/dj';
import * as m_api_events from './functions/api/events';
import * as m_api_experiments from './functions/api/experiments';
import * as m_api_feedback from './functions/api/feedback';
import * as m_api_geo from './functions/api/geo';
import * as m_api_handoff from './functions/api/handoff';
import * as m_api_home from './functions/api/home';
import * as m_api_image from './functions/api/image';
import * as m_api_lyrics_tools from './functions/api/lyrics-tools';
import * as m_api_playlist from './functions/api/playlist';
import * as m_api_push_fcm_register from './functions/api/push/fcm-register';
import * as m_api_push_subscribe from './functions/api/push/subscribe';
import * as m_api_push_unsubscribe from './functions/api/push/unsubscribe';
import * as m_api_push_vapid from './functions/api/push/vapid';
import * as m_api_room from './functions/api/room';
import * as m_api_site_mode from './functions/api/site-mode';
import * as m_api_trending_searches from './functions/api/trending-searches';
import * as m_api_tts from './functions/api/tts';
import * as m_api_version from './functions/api/version';
import * as m_api_vinaxai from './functions/api/vinaxai';
import * as m_apk from './functions/apk';
import * as m_artist_id from './functions/artist/[id]';
import * as m_img from './functions/img';
import * as m_playlist_id from './functions/playlist/[id]';
import * as m_sitemap_albums_xml from './functions/sitemap-albums.xml';
import * as m_sitemap_artists_xml from './functions/sitemap-artists.xml';
import * as m_sitemap_hubs_xml from './functions/sitemap-hubs.xml';
import * as m_sitemap_movies_xml from './functions/sitemap-movies.xml';
import * as m_sitemap_songs_xml from './functions/sitemap-songs.xml';
import * as m_sitemap_static_xml from './functions/sitemap-static.xml';
import * as m_sitemap_xml from './functions/sitemap.xml';
import * as m_song_id from './functions/song/[id]';
import * as m_hub from './functions/[hub]';
import * as m_api_cat_path from './functions/api/cat/[[path]]';
import * as m_sitemaps_map from './functions/sitemaps/[map]';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Handler = (context: any) => Response | Promise<Response>;

interface Mod {
  onRequest?: Handler;
  onRequestGet?: Handler;
  onRequestPost?: Handler;
  onRequestOptions?: Handler;
}

/** Minimal shape of the Workers runtime execution context (no dep needed). */
interface ExecCtx {
  waitUntil(promise: Promise<unknown>): void;
}

interface Env {
  /**
   * Host of the Cloudflare Pages deployment serving the static frontend
   * (e.g. "vinax.pages.dev"). The ASSETS shim and next() fetch from here so
   * the Worker never re-enters its own routes.
   */
  ASSETS_HOST?: string;
  [key: string]: unknown;
}

const EXACT: Record<string, Mod> = {
  '/api/admin/activity': m_api_admin_activity,
  '/api/admin/ai': m_api_admin_ai,
  '/api/admin/ailab': m_api_admin_ailab,
  '/api/admin/appconfig': m_api_admin_appconfig,
  '/api/admin/audit': m_api_admin_audit,
  '/api/admin/catalog-search': m_api_admin_catalog_search,
  '/api/admin/content': m_api_admin_content,
  '/api/admin/dataquality': m_api_admin_dataquality,
  '/api/admin/digest': m_api_admin_digest,
  '/api/admin/engagement': m_api_admin_engagement,
  '/api/admin/enginetest': m_api_admin_enginetest,
  '/api/admin/experiments': m_api_admin_experiments,
  '/api/admin/feedback': m_api_admin_feedback,
  '/api/admin/growth': m_api_admin_growth,
  '/api/admin/health': m_api_admin_health,
  '/api/admin/insights': m_api_admin_insights,
  '/api/admin/live': m_api_admin_live,
  '/api/admin/location': m_api_admin_location,
  '/api/admin/maintenance': m_api_admin_maintenance,
  '/api/admin/music': m_api_admin_music,
  '/api/admin/notifylog': m_api_admin_notifylog,
  '/api/admin/overview': m_api_admin_overview,
  '/api/admin/push': m_api_admin_push,
  '/api/admin/realtime': m_api_admin_realtime,
  '/api/admin/retention': m_api_admin_retention,
  '/api/admin/rooms': m_api_admin_rooms,
  '/api/admin/search-analytics': m_api_admin_search_analytics,
  '/api/admin/technical': m_api_admin_technical,
  '/api/admin/user': m_api_admin_user,
  '/api/admin/users': m_api_admin_users,
  '/api/announcements': m_api_announcements,
  '/api/apk': m_api_apk,
  '/api/appconfig': m_api_appconfig,
  '/api/assistant': m_api_assistant,
  '/api/blocklist': m_api_blocklist,
  '/api/cron/ai-daily-push': m_api_cron_ai_daily_push,
  '/api/cron/seo-crawl': m_api_cron_seo_crawl,
  '/api/cron/song-push': m_api_cron_song_push,
  '/api/cron/weekly-digest': m_api_cron_weekly_digest,
  '/api/dj': m_api_dj,
  '/api/events': m_api_events,
  '/api/experiments': m_api_experiments,
  '/api/feedback': m_api_feedback,
  '/api/geo': m_api_geo,
  '/api/handoff': m_api_handoff,
  '/api/home': m_api_home,
  '/api/image': m_api_image,
  '/api/lyrics-tools': m_api_lyrics_tools,
  '/api/playlist': m_api_playlist,
  '/api/push/fcm-register': m_api_push_fcm_register,
  '/api/push/subscribe': m_api_push_subscribe,
  '/api/push/unsubscribe': m_api_push_unsubscribe,
  '/api/push/vapid': m_api_push_vapid,
  '/api/room': m_api_room,
  '/api/site-mode': m_api_site_mode,
  '/api/trending-searches': m_api_trending_searches,
  '/api/tts': m_api_tts,
  '/api/version': m_api_version,
  '/api/vinaxai': m_api_vinaxai,
  '/apk': m_apk,
  '/img': m_img,
  '/sitemap-albums.xml': m_sitemap_albums_xml,
  '/sitemap-artists.xml': m_sitemap_artists_xml,
  '/sitemap-hubs.xml': m_sitemap_hubs_xml,
  '/sitemap-movies.xml': m_sitemap_movies_xml,
  '/sitemap-songs.xml': m_sitemap_songs_xml,
  '/sitemap-static.xml': m_sitemap_static_xml,
  '/sitemap.xml': m_sitemap_xml,
};

const DYNAMIC: Array<{ re: RegExp; mod: Mod; key: string }> = [
  { re: /^\/album\/([^/]+)\/?$/, mod: m_album_id, key: 'id' },
  { re: /^\/artist\/([^/]+)\/?$/, mod: m_artist_id, key: 'id' },
  { re: /^\/playlist\/([^/]+)\/?$/, mod: m_playlist_id, key: 'id' },
  { re: /^\/song\/([^/]+)\/?$/, mod: m_song_id, key: 'id' },
  { re: /^\/sitemaps\/([^/]+)\/?$/, mod: m_sitemaps_map, key: 'map' },
];

/** Rewrite a URL's origin to the Pages deployment (when configured). */
const toAssetsUrl = (env: Env, input: Request | string | URL): URL => {
  const url = new URL(
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
  );
  if (env.ASSETS_HOST) {
    url.protocol = 'https:';
    url.host = env.ASSETS_HOST;
  }
  return url;
};

/**
 * Shim for the Pages env.ASSETS binding: fetch static files from the Pages
 * deployment. Follows redirects (Pages 308s /index.html to /) so callers
 * always receive the real shell body, and preserves method/headers when
 * given a Request.
 */
const assetsFetch =
  (env: Env) =>
  (input: Request | string | URL): Promise<Response> => {
    const url = toAssetsUrl(env, input);
    if (input instanceof Request) return fetch(new Request(url.toString(), input));
    return fetch(url.toString(), { redirect: 'follow' });
  };

const pickHandler = (mod: Mod, method: string): Handler | undefined => {
  const m = method === 'HEAD' ? 'GET' : method;
  const specific =
    m === 'GET'
      ? mod.onRequestGet
      : m === 'POST'
        ? mod.onRequestPost
        : m === 'OPTIONS'
          ? mod.onRequestOptions
          : undefined;
  return specific ?? mod.onRequest;
};

const route = async (request: Request, env: Env, ctx: ExecCtx): Promise<Response> => {
  const path = new URL(request.url).pathname;
  const passthrough = (): Promise<Response> => assetsFetch(env)(request);

  let mod: Mod | undefined = EXACT[path];
  let params: Record<string, unknown> = {};
  if (!mod && path.length > 1 && path.endsWith('/')) mod = EXACT[path.slice(0, -1)];
  if (!mod) {
    for (const d of DYNAMIC) {
      const m = d.re.exec(path);
      if (m) {
        mod = d.mod;
        params = { [d.key]: decodeURIComponent(m[1]) };
        break;
      }
    }
  }
  // /api/cat/* — [[path]] catch-all: params.path is the segment array.
  if (!mod && (path === '/api/cat' || path.startsWith('/api/cat/'))) {
    mod = m_api_cat_path;
    params = { path: path.slice('/api/cat/'.length).split('/').filter(Boolean) };
  }
  // Single-segment fallthrough — the [hub].ts allow-list router. Its own
  // matchHub() decides; misses call next(), which passes through to Pages.
  if (!mod && /^\/[a-z0-9-]+\/?$/i.test(path)) {
    mod = m_hub;
  }

  if (!mod) return passthrough();

  const handler = pickHandler(mod, request.method);
  if (!handler) return new Response('Method Not Allowed', { status: 405 });

  const context = {
    request,
    env: { ...env, ASSETS: { fetch: assetsFetch(env) } },
    params,
    data: {} as Record<string, unknown>,
    next: passthrough,
    waitUntil: (p: Promise<unknown>) => ctx.waitUntil(p),
  };
  return handler(context);
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecCtx): Promise<Response> {
    // Host-level middleware (apex 301, update.* / admin.* redirects), then the router.
    return hostMiddleware({ request, next: () => route(request, env, ctx) });
  },
};
