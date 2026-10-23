/**
 * 13.9 — browse first, sign in to listen.
 *
 * A visitor may read Explore, Discover, Charts, Search and every song, album,
 * artist and hub page without an account (AuthGate decides which pages). The
 * moment they tap play, like or save, the action asks them to sign in instead:
 * `requireAccount()` opens the sign-in sheet (components/SignInPrompt) and
 * answers false, and the sheet runs the action again once they have.
 *
 * The gate is ARMED by AuthGate only while a signed-out visitor is inside the
 * app. Signed-in sessions, the Android app (which always signs in first) and
 * unit tests that drive the stores directly never meet it.
 */
import { currentAccount } from './google';
import { useUiStore, type SignInReason } from '@/store/uiStore';

let guest = false;

/** AuthGate: true while a signed-out visitor is browsing the live app. */
export function setGuestBrowsing(on: boolean): void {
  guest = on;
}

export function isGuestBrowsing(): boolean {
  return guest;
}

/**
 * True when the action may go ahead. Otherwise the sign-in sheet opens with
 * copy for `reason`, `resume` is kept for after sign-in, and the answer is false.
 */
export function requireAccount(reason: SignInReason = 'listen', resume?: () => void): boolean {
  if (!guest || currentAccount()) return true;
  useUiStore.getState().openSignIn(reason, resume);
  return false;
}

/**
 * A visitor who chose "Explore first" on the sign-in screen or on a published
 * page gets the live app on every browse page for the rest of the tab's life,
 * instead of the published text that direct loads of those URLs show.
 */
const BROWSE_FLAG = 'vinax.guest-browse';

export function rememberGuestBrowse(): void {
  try {
    sessionStorage.setItem(BROWSE_FLAG, '1');
  } catch {
    /* storage blocked: the next direct load shows the published text again */
  }
}

export function guestBrowseChosen(): boolean {
  try {
    return sessionStorage.getItem(BROWSE_FLAG) === '1';
  } catch {
    return false;
  }
}
