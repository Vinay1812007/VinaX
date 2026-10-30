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
// Every functions/api/**.ts handler needs BOTH an import here and an EXACT
// entry below — worker/__tests__/routerCoverage.test.ts enforces it (an
// orphaned handler falls through to Pages and 405s, which a --dry-run build
// cannot detect: that is exactly how /api/preview shipped dead in v5.11.2).
import * as m_api_status from './functions/api/status';
import * as m_api_aimodels from './functions/api/aimodels';
import * as m_api_curate from './functions/api/curate';
import * as m_api_dj from './functions/api/dj';
import * as m_api_embed from './functions/api/embed';
import * as m_api_voices from './functions/api/voices';
import * as m_album_id from './functions/album/[id]';
import * as m_api_admin_ailab from './functions/api/admin/ailab';
import * as m_api_admin_catalog_search from './functions/api/admin/catalog-search';
import * as m_api_admin_edge from './functions/api/admin/edge';
import * as m_api_admin_seo from './functions/api/admin/seo';
import { guardVerdict, isEntityPage, isHubPage, plainShell } from './functions/_lib/pageGuard';
import * as m_api_admin_envcheck from './functions/api/admin/envcheck';
import * as m_api_admin_enginetest from './functions/api/admin/enginetest';
import * as m_api_admin_health from './functions/api/admin/health';
import * as m_api_admin_musicapi from './functions/api/admin/musicapi';
import * as m_api_admin_fcmcheck from './functions/api/admin/fcmcheck';
import * as m_api_admin_releases from './functions/api/admin/releases';
// 14.0 — the database-backed console routes and the scheduled jobs.
import * as m_api_admin_overview from './functions/api/admin/overview';
import * as m_api_admin_live from './functions/api/admin/live';
import * as m_api_admin_listeners from './functions/api/admin/listeners';
import * as m_api_admin_analytics from './functions/api/admin/analytics';
import * as m_api_admin_ai from './functions/api/admin/ai';
import * as m_api_admin_feedback from './functions/api/admin/feedback';
import * as m_api_admin_content from './functions/api/admin/content';
import * as m_api_admin_settings from './functions/api/admin/settings';
import * as m_api_admin_experiments from './functions/api/admin/experiments';
import * as m_api_admin_push from './functions/api/admin/push';
import * as m_api_admin_notifications from './functions/api/admin/notifications';
import * as m_api_admin_audit from './functions/api/admin/audit';
import * as m_api_admin_database from './functions/api/admin/database';
import * as m_api_cron_run from './functions/api/cron/run';
import { runScheduled } from './functions/_lib/jobs';
// 7.2.0 — recommendation quality, AI operations, recommendation tuning.
import * as m_api_announcements from './functions/api/announcements';
import * as m_api_apk from './functions/api/apk';
import * as m_api_appconfig from './functions/api/appconfig';
import * as m_api_assistant from './functions/api/assistant';
import * as m_api_blocklist from './functions/api/blocklist';
import * as m_api_events from './functions/api/events';
import * as m_api_experiments from './functions/api/experiments';
import * as m_api_feedback from './functions/api/feedback';
import * as m_api_geo from './functions/api/geo';
import * as m_api_handoff from './functions/api/handoff';
import * as m_api_image from './functions/api/image';
import * as m_api_lyrics_tools from './functions/api/lyrics-tools';
import * as m_api_playlist from './functions/api/playlist';
import * as m_api_recommendations from './functions/api/recommendations';
import * as m_api_ai_search from './functions/api/ai/search';
import * as m_api_ai_playlist from './functions/api/ai/playlist';
import * as m_api_ai_dj from './functions/api/ai/dj';
import * as m_api_auth_google from './functions/api/auth/google';
import * as m_api_auth_me from './functions/api/auth/me';
import * as m_api_account_data from './functions/api/account/data';
// 15.0 — the social layer: profiles, follows, shared playlists, shared chats.
import * as m_api_profile from './functions/api/profile';
import * as m_api_profile_handle from './functions/api/profile/[handle]';
import * as m_api_follow from './functions/api/follow';
import * as m_api_shared_playlist from './functions/api/shared-playlist';
import * as m_api_shared_playlist_id from './functions/api/shared-playlist/[id]';
import * as m_api_share_chat from './functions/api/share-chat';
import * as m_api_share_chat_id from './functions/api/share-chat/[id]';
import * as m_api_ai_headlines from './functions/api/ai/headlines';
import * as m_api_ai_title from './functions/api/ai/title';
import * as m_api_favicon from './functions/api/favicon';
import * as m_api_webimg from './functions/api/webimg';
import * as m_api_preview from './functions/api/preview';
import * as m_api_push_fcm_register from './functions/api/push/fcm-register';
import * as m_api_push_subscribe from './functions/api/push/subscribe';
import * as m_api_push_unsubscribe from './functions/api/push/unsubscribe';
import * as m_api_push_vapid from './functions/api/push/vapid';
import * as m_api_room from './functions/api/room';
import * as m_api_site_mode from './functions/api/site-mode';
import * as m_api_trending_searches from './functions/api/trending-searches';
import * as m_api_trends from './functions/api/trends';
import * as m_api_tts from './functions/api/tts';
// 10.3 — speech to text and music generation on the free models.
import * as m_api_transcribe from './functions/api/transcribe';
import * as m_api_music from './functions/api/music';
import * as m_api_username from './functions/api/username';
import * as m_api_version from './functions/api/version';
import * as m_api_vinaxai from './functions/api/vinaxai';
// VinaX CLI — the terminal coding agent's own API family. Deliberately its
// own routes: the assistant endpoint answers a person, these drive a process
// that can write to a developer's disk.
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
import * as m_api_recs_similar from './functions/api/recommendations/similar/[songId]';
import * as m_hub from './functions/[hub]';
import * as m_api_cat_path from './functions/api/cat/[[path]]';
import * as m_sitemaps_map from './functions/sitemaps/[map]';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Handler = (context: any) => Response | Promise<Response>;

interface Mod {
  onRequest?: Handler;
  onRequestGet?: Handler;
  onRequestPost?: Handler;
  /** 13.0 — /api/account/data writes the synced copy with PUT. */
  onRequestPut?: Handler;
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
  '/api/admin/ailab': m_api_admin_ailab,
  '/api/admin/catalog-search': m_api_admin_catalog_search,
  '/api/admin/edge': m_api_admin_edge,
  '/api/admin/seo': m_api_admin_seo,
  '/api/admin/envcheck': m_api_admin_envcheck,
  '/api/admin/enginetest': m_api_admin_enginetest,
  '/api/admin/health': m_api_admin_health,
  '/api/admin/musicapi': m_api_admin_musicapi,
  '/api/admin/fcmcheck': m_api_admin_fcmcheck,
  '/api/admin/releases': m_api_admin_releases,
  '/api/admin/overview': m_api_admin_overview,
  '/api/admin/live': m_api_admin_live,
  '/api/admin/listeners': m_api_admin_listeners,
  '/api/admin/analytics': m_api_admin_analytics,
  '/api/admin/ai': m_api_admin_ai,
  '/api/admin/feedback': m_api_admin_feedback,
  '/api/admin/content': m_api_admin_content,
  '/api/admin/settings': m_api_admin_settings,
  '/api/admin/experiments': m_api_admin_experiments,
  '/api/admin/push': m_api_admin_push,
  '/api/admin/notifications': m_api_admin_notifications,
  '/api/admin/audit': m_api_admin_audit,
  '/api/admin/database': m_api_admin_database,
  '/api/cron/run': m_api_cron_run,
  '/api/aimodels': m_api_aimodels,
  '/api/curate': m_api_curate,
  '/api/dj': m_api_dj,
  '/api/embed': m_api_embed,
  '/api/voices': m_api_voices,
  '/api/announcements': m_api_announcements,
  '/api/apk': m_api_apk,
  '/api/appconfig': m_api_appconfig,
  '/api/assistant': m_api_assistant,
  '/api/blocklist': m_api_blocklist,
  '/api/events': m_api_events,
  '/api/experiments': m_api_experiments,
  '/api/feedback': m_api_feedback,
  '/api/geo': m_api_geo,
  '/api/handoff': m_api_handoff,
  '/api/image': m_api_image,
  '/api/lyrics-tools': m_api_lyrics_tools,
  '/api/playlist': m_api_playlist,
  '/api/recommendations': m_api_recommendations,
  '/api/ai/search': m_api_ai_search,
  '/api/ai/playlist': m_api_ai_playlist,
  '/api/ai/dj': m_api_ai_dj,
  '/api/auth/google': m_api_auth_google,
  '/api/auth/me': m_api_auth_me,
  '/api/account/data': m_api_account_data,
  '/api/profile': m_api_profile,
  '/api/follow': m_api_follow,
  '/api/shared-playlist': m_api_shared_playlist,
  '/api/share-chat': m_api_share_chat,
  '/api/ai/headlines': m_api_ai_headlines,
  '/api/ai/title': m_api_ai_title,
  '/api/favicon': m_api_favicon,
  '/api/webimg': m_api_webimg,
  '/api/preview': m_api_preview,
  '/api/push/fcm-register': m_api_push_fcm_register,
  '/api/push/subscribe': m_api_push_subscribe,
  '/api/push/unsubscribe': m_api_push_unsubscribe,
  '/api/push/vapid': m_api_push_vapid,
  '/api/room': m_api_room,
  '/api/site-mode': m_api_site_mode,
  '/api/status': m_api_status,
  '/api/trending-searches': m_api_trending_searches,
  '/api/trends': m_api_trends,
  '/api/tts': m_api_tts,
  '/api/transcribe': m_api_transcribe,
  '/api/music': m_api_music,
  '/api/username': m_api_username,
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
  { re: /^\/api\/recommendations\/similar\/([^/]+)\/?$/, mod: m_api_recs_similar, key: 'songId' },
  { re: /^\/api\/profile\/([^/]+)\/?$/, mod: m_api_profile_handle, key: 'handle' },
  { re: /^\/api\/shared-playlist\/([^/]+)\/?$/, mod: m_api_shared_playlist_id, key: 'id' },
  { re: /^\/api\/share-chat\/([^/]+)\/?$/, mod: m_api_share_chat_id, key: 'id' },
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
        : m === 'PUT'
          ? mod.onRequestPut
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

  // 11.0 — the edge-rendered catalogue pages sit behind a guard: a browser
  // impostor, or a network reading pages faster than people do, gets the
  // plain app shell instead of a rendered page (_lib/pageGuard.ts).
  if (request.method === 'GET' && (isEntityPage(path) || isHubPage(path))) {
    const verdict = await guardVerdict(request, env);
    if (verdict !== 'render') return plainShell(request, assetsFetch(env), verdict);
  }

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
  // 14.0 — the Cron Trigger (wrangler.toml [triggers]): the status tick every
  // run, housekeeping once an hour, the AI model check every run (1.2.7).
  // Nothing runs without the database.
  async scheduled(event: { scheduledTime: number }, env: Env, ctx: ExecCtx): Promise<void> {
    ctx.waitUntil(runScheduled(env as Record<string, unknown>, event.scheduledTime));
  },
};
