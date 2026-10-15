/**
 * 13.5.0 — the server's own text for this URL, kept before React replaces #root.
 *
 * Prerendered pages (Charts, Top songs, language and mood hubs, Discover…)
 * arrive with a `<main id="seo-content">` block written for that URL and a
 * canonical link naming it. React used to throw that block away on start, so
 * a signed-out visitor — and Google, which renders the page — saw the same
 * sign-in screen on every URL. AuthGate now shows this text to signed-out
 * visitors (PublicPage), which costs no API calls: it is already in the HTML.
 *
 * Only a block whose canonical matches the address is kept. The app's
 * fallback shell (served for /library, /song/…) carries the HOME page's text
 * and canonical "/", so it never passes for another page.
 */
export interface ServerPage {
  /** Path without a trailing slash ("/charts"). */
  path: string;
  /** Inner HTML of the server's #seo-content block. */
  html: string;
}

let captured: ServerPage | null = null;

export const normPath = (p: string): string => p.replace(/\/+$/, '') || '/';

/** Read the server block. Call once, before React renders into #root. */
export function captureServerPage(doc: Document = document, loc: Pick<Location, 'pathname'> = location): ServerPage | null {
  captured = null;
  try {
    const block = doc.getElementById('seo-content');
    // The LAST canonical wins: an edge-rendered hub served from an older shell
    // can still carry the home page's canonical ahead of its own.
    const links = doc.querySelectorAll<HTMLLinkElement>('link[rel="canonical"]');
    const href = links.length ? links[links.length - 1].getAttribute('href') : null;
    if (!block || !href) return null;
    const path = normPath(new URL(href, 'https://www.sirimillavinay.online').pathname);
    if (path !== normPath(loc.pathname)) return null;
    const html = block.innerHTML.trim();
    if (!html) return null;
    captured = { path, html };
  } catch {
    captured = null;
  }
  return captured;
}

/** The kept server page for `pathname`, or null. */
export function serverPageFor(pathname: string): ServerPage | null {
  return captured && captured.path === normPath(pathname) ? captured : null;
}
