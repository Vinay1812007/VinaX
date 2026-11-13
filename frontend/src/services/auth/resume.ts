/* Its own module, not next.ts: next.ts is in the first load (GoogleSignIn), this is only needed by the lazy sign-in sheet and pages. */
import { safeNext } from './next';

/**
 * What a guest was doing when the sign-in sheet opened (play this song, like
 * that one), kept while they follow its "Sign in with email" or "Create an
 * account" link. The pages run it once they sign in and land back on the
 * same `next` page, within 20 minutes (a code lasts 15). The app stays loaded
 * the whole time (links between the pages are in-app), so the closure is
 * still good; a reload forgets it.
 */
let kept: { next: string; at: number; run: () => void } | null = null;
const KEEP_MS = 20 * 60_000;

export function keepResume(here: string, run: () => void): void {
  kept = { next: safeNext(here), at: Date.now(), run };
}

/** The kept action for a sign-in that lands on `next`, once; null otherwise. */
export function takeResume(next: string, now = Date.now()): (() => void) | null {
  const k = kept;
  kept = null;
  return k && k.next === next && now - k.at <= KEEP_MS ? k.run : null;
}
