/**
 * 13.0 — VinaX needs a Google account. Until the listener signs in, every
 * screen is this one: the VinaX mark, one line on what signing in does, and
 * the Google button. The legal pages stay readable without an account (the
 * sign-in screen links to them, and Google's sign-in requires a public
 * privacy policy).
 */
import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { validateSession } from '@/services/auth/google';
import { useAccount } from './useAccount';

// The sign-in screen (and Google's button) loads only when it is needed.
const SignInScreen = lazy(() => import('./SignInScreen'));

/** Pages anyone may read without signing in.
 *  13.4.0 — About, Help, Get the app and Copyright joined the legal pages:
 *  they are plain text (no catalogue calls), they answer what a visitor asks
 *  before signing in, and they are what a search engine should be able to
 *  read and list under the site's name. Before, every one of these URLs
 *  rendered the same sign-in screen once the app had loaded. */
export const PUBLIC_PATHS = new Set(['/privacy', '/terms', '/contact', '/about', '/help', '/download', '/dmca']);

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
  if (account || PUBLIC_PATHS.has(pathname.replace(/\/+$/, '') || '/')) return <>{children}</>;
  return (
    <Suspense fallback={<main className="min-h-dvh bg-ink-950" aria-busy="true" />}>
      <SignInScreen />
    </Suspense>
  );
}

