/**
 * 1.13 — Listen Together invites: the link a QR carries, what a scanned QR
 * means, and the hand-off between the website and the Android app. Pure
 * functions (no DOM, no network) so they are tested as plain data.
 */
export const INVITE_ORIGIN = 'https://www.vinaxmusic.online';
const HOSTS = new Set(['www.vinaxmusic.online', 'vinaxmusic.online']);
const ANDROID_PACKAGE = 'app.Vinax.music';
const CODE = /^[A-Z0-9]{4,8}$/;

/** The invite link for a room: what the QR encodes and Share sends. */
export function inviteUrl(code: string): string {
  return `${INVITE_ORIGIN}/together?code=${encodeURIComponent(code)}`;
}

/**
 * The room code inside whatever a camera read: a VinaX invite link
 * (…/together?code=ABC123) or the bare code. Anything else — another site's
 * QR, a payment code — is null, so the scanner keeps looking.
 */
export function codeFromScan(text: string): string | null {
  const raw = text.trim();
  if (!raw) return null;
  const bare = raw.toUpperCase();
  if (CODE.test(bare)) return bare;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!HOSTS.has(url.hostname.toLowerCase()) || !/^\/together\/?$/.test(url.pathname)) return null;
  const code = (url.searchParams.get('code') ?? '').trim().toUpperCase();
  return CODE.test(code) ? code : null;
}

/**
 * An Android intent link that opens `path` in the VinaX app. Chrome hands it
 * to the app when it is installed and can open links (the APK from 1.13 on);
 * otherwise it goes to the download page. `path` is an in-app path that
 * starts with "/".
 */
export function appIntentUrl(path: string): string {
  const safe = path.startsWith('/') && !path.startsWith('//') ? path : '/';
  const fallback = encodeURIComponent(`${INVITE_ORIGIN}/download`);
  return `intent://www.vinaxmusic.online${safe}#Intent;scheme=https;package=${ANDROID_PACKAGE};S.browser_fallback_url=${fallback};end`;
}

/**
 * The in-app path a link opened in the Android app should show, or null when
 * the link is not one of ours (or is only the home page / the widget's play
 * link, which the app already handles).
 */
export function deepLinkPath(link: string): string | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !HOSTS.has(url.hostname.toLowerCase())) return null;
  if (url.searchParams.has('widget')) return null;
  const path = `${url.pathname}${url.search}${url.hash}`;
  return path === '/' || path === '' ? null : path;
}
