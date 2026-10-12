/**
 * 11.7.1 — the bare domain belongs on www.
 *
 * Since 11.0.3 the apex is no longer a Worker route and `_redirects` was meant
 * to send it to www with a 301. Probed live on 2026-10-12: it does not — the
 * apex answers 200 with the full app, while every `/api/*` request there gets
 * the HTML shell back. On the apex nothing that talks to the server works,
 * push notifications included (`/api/push/vapid` returns a web page).
 *
 * This is the in-app half of the fix, imported FIRST by main.tsx so it runs
 * before anything else boots. The edge redirect still has to be repaired in
 * the Cloudflare dashboard; this keeps listeners safe until then.
 */
export const APEX_HOST = 'sirimillavinay.online';
export const CANONICAL_ORIGIN = 'https://www.sirimillavinay.online';

/** The www URL for an apex location, or null when no redirect is needed. */
export function apexTarget(loc: Pick<Location, 'hostname' | 'pathname' | 'search' | 'hash'>): string | null {
  if (loc.hostname.toLowerCase() !== APEX_HOST) return null;
  return `${CANONICAL_ORIGIN}${loc.pathname}${loc.search}${loc.hash}`;
}

if (typeof window !== 'undefined') {
  const target = apexTarget(window.location);
  if (target) window.location.replace(target);
}
