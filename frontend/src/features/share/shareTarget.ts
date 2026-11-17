/**
 * Share to VinaX (round 8): what to do with text another app shared here.
 * It arrives at /share from the installed web app's share target
 * (manifest.webmanifest share_target: title, text, url) or from the Android
 * app's share sheet entry (MainActivity.shareAsLink: text, title).
 *
 *  - a VinaX link opens that page;
 *  - a list (two lines or more) goes to Import a playlist, for review;
 *  - a JioSaavn link with a name in it searches that name;
 *  - one line is a search (without "Check out … on Spotify" round it);
 *  - otherwise the share's title, if it has one, is the search.
 *
 * Pure (no DOM, no network), so it is tested as plain data.
 */
import { deepLinkPath } from '@/features/together/invite';

export type ShareAction =
  | { kind: 'open'; path: string }
  | { kind: 'import'; text: string }
  | { kind: 'search'; query: string }
  | { kind: 'none' };

export interface SharedFields {
  title?: string | null;
  text?: string | null;
  url?: string | null;
}

const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;
/** Chat punctuation that sticks to the end of a pasted link. */
const TRAILING = /[.,;:!?)\]}>]+$/;
const MAX_LINES = 100;
const MAX_QUERY = 120;
const SAAVN_HOSTS = new Set(['jiosaavn.com', 'www.jiosaavn.com']);

/** The wrapper other music apps put round a shared song ("Check out X by Y on Spotify"). */
const LEAD_IN = /^(?:check out|listen to|i'?m listening to|now playing:?)\s+/i;
const TAIL = /\s+(?:on|via)\s+(?:spotify|jiosaavn|youtube(?: music)?|apple music|gaana|wynk(?: music)?|amazon music)\s*[:.!]*$/i;

/** One pasted line as a search: "Title - Artist" reads better as "Title Artist".
 *  " by " is dropped only inside an app's wrapper, so "Stand by Me" stays whole. */
function asQuery(line: string): string {
  const bare = line.replace(LEAD_IN, '').replace(TAIL, '');
  const wrapped = bare !== line;
  return bare.replace(wrapped ? /\s+(?:[-–—|]|by)\s+/gi : /\s+[-–—|]\s+/g, ' ').trim().slice(0, MAX_QUERY);
}

/** A VinaX page to open for a link, but never /share itself (no loop). */
function vinaxPath(link: string): string | null {
  const path = deepLinkPath(link);
  if (!path || path === '/share' || path.startsWith('/share?') || path.startsWith('/share/')) return null;
  return path;
}

/** The name in a JioSaavn link (…/song/kesariya-from-brahmastra/<token>), or null. */
function catalogueQuery(link: string): string | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  if (!SAAVN_HOSTS.has(url.hostname.toLowerCase())) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  const at = parts.findIndex((p) => ['song', 'album', 'artist', 'featured', 'playlist'].includes(p));
  const slug = at >= 0 ? parts[at + 1] : undefined;
  if (!slug) return null;
  let name: string;
  try {
    name = decodeURIComponent(slug);
  } catch {
    name = slug;
  }
  name = name.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return /\p{L}/u.test(name) ? name.slice(0, MAX_QUERY) : null;
}

export function shareAction({ title, text, url }: SharedFields): ShareAction {
  const all = [text, url].filter((s): s is string => typeof s === 'string' && s.trim() !== '').join('\n');
  const links = (all.match(URL_RE) ?? []).map((l) => l.replace(TRAILING, ''));
  for (const link of links) {
    const path = vinaxPath(link);
    if (path) return { kind: 'open', path };
  }
  const lines = all
    .replace(URL_RE, ' ')
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    // A line of only punctuation or an emoji is not a song.
    .filter((l) => l.length >= 2 && /[\p{L}\p{N}]/u.test(l));
  if (lines.length >= 2) return { kind: 'import', text: lines.slice(0, MAX_LINES).join('\n') };
  // A JioSaavn link's own name beats the chat line its app wraps round it.
  for (const link of links) {
    const query = catalogueQuery(link);
    if (query) return { kind: 'search', query };
  }
  if (lines.length === 1) {
    const query = asQuery(lines[0]);
    if (query.length >= 2) return { kind: 'search', query };
  }
  const named = (title ?? '').replace(/\s+/g, ' ').trim();
  if (named.length >= 2 && /[\p{L}\p{N}]/u.test(named)) return { kind: 'search', query: asQuery(named) };
  return { kind: 'none' };
}
