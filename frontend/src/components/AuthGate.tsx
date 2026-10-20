/**
 * 13.0 — VinaX needs a Google account. Until the listener signs in, every
 * screen is this one: the VinaX mark, one line on what signing in does, and
 * the Google button. The legal pages stay readable without an account (the
 * sign-in screen links to them, and Google's sign-in requires a public
 * privacy policy).
 *
 * 13.5.0 — pages the server publishes for every URL (Charts, hubs…) show
 * their own text to signed-out visitors (PublicPage); playing and saving
 * still need the account.
 */
import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { validateSession } from '@/services/auth/google';
import { serverPageFor } from '@/services/seo/serverPage';
import { useAccount } from './useAccount';
import { GetAppSlot } from './GetAppSlot';

// The sign-in screen (and Google's button) loads only when it is needed.
const SignInScreen = lazy(() => import('./SignInScreen'));
// 13.5.0 — a published page's own text, for signed-out visitors (and search engines).
const PublicPage = lazy(() => import('./PublicPage'));

/** Pages anyone may read without signing in.
 *  13.4.0 — About, Help, Get the app and Copyright joined the legal pages:
 *  they are plain text (no catalogue calls), they answer what a visitor asks
 *  before signing in, and they are what a search engine should be able to
 *  read and list under the site's name. Before, every one of these URLs
 *  rendered the same sign-in screen once the app had loaded. */
export const PUBLIC_PATHS = new Set(['/privacy', '/terms', '/contact', '/about', '/help', '/download', '/dmca']);

/** Public pages that need the live app even signed out: Help's feedback form
 *  and Get the app's download button. The rest read the same from the
 *  server's text (13.5.0). */
const LIVE_PUBLIC_PATHS = new Set(['/help', '/download']);

export function AuthGate({ children }: { children: ReactNode }): ReactNode {
  const account = useAccount();
  const { pathname } = useLocation();
  // A session the server no longer accepts (expired, account deleted) signs out here.
  // 13.4.0 — keyed on the session string, not the account object: a refreshed
  // name or photo is a new object, and re-checking on each one was a loop.
  const session = account?.session ?? null;
  useEffect(() => {
    if (session) void validateSession();
  }, [session]);
  const path = pathname.replace(/\/+$/, '') || '/';
  if (account || LIVE_PUBLIC_PATHS.has(path)) return <>{children}</>;
  // 13.5.0 — signed out on a page the server published (Charts, Top songs,
  // language and mood hubs, About, Privacy…): that page's text with a
  // sign-in card, instead of the same sign-in screen on every URL. It loads
  // no app shell and makes no catalogue calls. Home stays the sign-in screen.
  const published = path !== '/' ? serverPageFor(pathname) : null;
  // Reached inside the app (a link, not a page load): the live page.
  if (!published && PUBLIC_PATHS.has(path)) return <>{children}</>;
  return (
    <Suspense fallback={<main className="min-h-dvh bg-ink-950" aria-busy="true" />}>
      <GetAppSlot />
      {published ? <PublicPage page={published} /> : <SignInScreen />}
    </Suspense>
  );
}

