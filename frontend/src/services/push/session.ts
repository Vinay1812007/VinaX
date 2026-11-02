/**
 * Console rebuild — the signed-in listener's VinaX session for push registration.
 *
 * The owner console only sends notifications to people signed in with
 * Google, so a device registers WITH the session (`Authorization: Bearer
 * vx1…`) and the server links it to the account; without one it is unlinked.
 * Read straight from storage so this stays out of the auth module's weight.
 */
import { KEYS } from '@/constants/storage-keys';
import { getLocal } from '@/services/storage/local';

/** The current session token, or ''. */
export function pushSession(): string {
  const a = getLocal<{ session?: unknown } | null>(KEYS.account, null);
  return a && typeof a.session === 'string' && a.session.startsWith('vx1.') ? a.session : '';
}

/** Headers for a push registration request. */
export function pushAuthHeaders(): Record<string, string> {
  const s = pushSession();
  return s ? { authorization: `Bearer ${s}` } : {};
}

/** A short, non-secret tag of the session (which account a confirmation was for). */
export function sessionTag(): string {
  const s = pushSession();
  return s ? s.slice(-12) : '';
}
