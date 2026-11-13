/**
 * The log-in, sign-up and forgot-password pages (/login, /signup,
 * /forgot-password) send the listener back where they came from: `?next=`
 * carries that address, and `?email=` carries the address typed so far from
 * one page to the next (never the password).
 */

export const AUTH_PATHS = ['/login', '/signup', '/forgot-password'] as const;
export type AuthPath = (typeof AUTH_PATHS)[number];

/** True for an address on one of the sign-in pages (any query, hash or trailing slash). */
const isAuthPath = (raw: string): boolean => {
  const path = (raw.split(/[?#]/)[0] ?? '').replace(/\/+$/, '').toLowerCase();
  return (AUTH_PATHS as readonly string[]).includes(path);
};

/**
 * A same-site address to land on after signing in, or '/'. Only a path that
 * starts with one '/' passes: '//evil.com', '/\evil.com', 'https://…' and
 * control characters fall back to '/', and so do the sign-in pages themselves
 * (a loop).
 */
export function safeNext(raw: string | null | undefined): string {
  if (!raw || raw.length > 2000) return '/';
  // eslint-disable-next-line no-control-regex
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\') || /[\u0000-\u001f\u007f\\]/.test(raw)) return '/';
  if (isAuthPath(raw)) return '/';
  return raw;
}

/** The address of a sign-in page that keeps `next` (when not '/') and the typed email. */
export function authHref(path: AuthPath, opts: { next?: string | null; email?: string | null } = {}): string {
  const q = new URLSearchParams();
  const next = safeNext(opts.next);
  if (next !== '/') q.set('next', next);
  const email = opts.email?.trim();
  if (email) q.set('email', email.slice(0, 254));
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}
