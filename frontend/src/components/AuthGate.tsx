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

/** Pages anyone may read without signing in. */
export const PUBLIC_PATHS = new Set(['/privacy', '/terms', '/contact']);

export function AuthGate({ children }: { children: ReactNode }): ReactNode {
  const account = useAccount();
  const { pathname } = useLocation();
  // A session the server no longer accepts (expired, account deleted) signs out here.
  useEffect(() => {
    if (account) void validateSession();
  }, [account]);
  if (account || PUBLIC_PATHS.has(pathname.replace(/\/+$/, '') || '/')) return <>{children}</>;
  return (
    <Suspense fallback={<main className="min-h-dvh bg-ink-950" aria-busy="true" />}>
      <SignInScreen />
    </Suspense>
  );
}

