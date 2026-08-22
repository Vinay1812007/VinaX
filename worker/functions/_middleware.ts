/**
 * Host-level routing:
 *   update.<domain>/*  → 302 to /api/apk (streams the newest APK from the
 *   private repo via the server-side token; nothing needs manual uploading).
 *   admin.<domain>/    → 302 to /admin/ (the token-gated admin dashboard).
 * All other hosts fall through to the app / other functions.
 */

export const onRequest = async (context: {
  request: Request;
  next: () => Promise<Response>;
}): Promise<Response> => {
  const url = new URL(context.request.url);
  const host = url.hostname.toLowerCase();
  if (host.startsWith('update.')) {
    return Response.redirect(`${url.origin}/api/apk`, 302);
  }
  // Admin subdomain: send the bare root to the (token-gated) dashboard app.
  if (host.startsWith('admin.') && (url.pathname === '/' || url.pathname === '')) {
    return Response.redirect(`${url.origin}/admin/`, 302);
  }
  return context.next();
};
