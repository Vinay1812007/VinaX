/**
 * Host-level routing:
 *   sirimillavinay.online/*  → 301 to www.sirimillavinay.online (host
 *   canonicalization, 4.19.1). The apex was serving the FULL SITE as a
 *   second origin: Google filed every apex copy under duplicate/canonical
 *   reasons in Search Console, and apex visitors accumulated a separate
 *   service worker + cache that could wedge independently of www (the
 *   2026-08-17 stuck-shell screenshots were on the apex). Permanent
 *   redirect, path + query preserved.
 *   update.<domain>/*  → 302 to /api/apk (streams the newest APK from the
 *   private repo via the server-side token; nothing needs manual uploading).
 *   admin.<domain>/    → 302 to /admin/ (the token-gated admin dashboard).
 * All other hosts fall through to the app / other functions.
 */

const CANONICAL_HOST = 'www.sirimillavinay.online';

export const onRequest = async (context: {
  request: Request;
  next: () => Promise<Response>;
}): Promise<Response> => {
  const url = new URL(context.request.url);
  const host = url.hostname.toLowerCase();
  if (host === 'sirimillavinay.online') {
    url.hostname = CANONICAL_HOST;
    return Response.redirect(url.toString(), 301);
  }
  if (host.startsWith('update.')) {
    return Response.redirect(`${url.origin}/api/apk`, 302);
  }
  // Admin subdomain: send the bare root to the (token-gated) dashboard app.
  if (host.startsWith('admin.') && (url.pathname === '/' || url.pathname === '')) {
    return Response.redirect(`${url.origin}/admin/`, 302);
  }

  // NOTE (2026-08-21): the hashed-asset guard that lived here is gone —
  // /assets/* (and all other static paths) no longer reach Functions at
  // all, excluded via public/_routes.json. Running this middleware on ~30
  // chunk/font/icon requests per page view burned through the 100k/day
  // free Functions quota (101,774 hit on 2026-08-21) and threatened daily
  // /api/* outages. The missing-chunk→HTML poison class is now owned by
  // client-side layers that cost nothing per request: the b3 URL epoch
  // (vite.config.ts), no `immutable` on /assets so reloads revalidate
  // (_headers), the service worker's no-cache asset revalidation (sw.js),
  // and the e2e suite failing CI if any built asset is secretly HTML
  // (scripts/e2e-smoke.mjs).
  return context.next();
};
