/** Shared song identity and recently displayed music for catalog shelves and playlists. */
import type { Song } from '@/types';

/** Recently displayed songs shared by catalog shelves and playlists. */
const SERVED_KEY = 'vinax.flow.served.v1';
const SERVED_CAP = 300;
const SERVED_TTL = 7 * 24 * 60 * 60_000;
let servedMemory: ServedEntry[] = [];

/** Titles that are never songs — they poison queues when a search returns them. */
const JUNK_TITLE = /\b(dialogue|dialogues|bgm|jukebox|trailer|teaser|promo|ringtone|commentary)\b/i;

/** Words that mark a bracketed or dashed suffix as a VERSION of a song rather than part of its name. */
const VERSION_WORDS =
  'from|remix|remaster(?:ed)?|reprise|version|mix|unplugged|reloaded|revisited|slowed|sped\\s?up|reverb|lofi|lo-fi|live|acoustic|cover|karaoke|instrumental|edit|extended|female|male|duet|8d|bass\\s?boosted|deluxe|bonus|ost|flip|mashup|19\\d{2}|20\\d{2}';

/** Version decorations that make one song look like many. */
const VERSION_TAG = new RegExp(`\\s*[([{][^)\\]}]*\\b(?:${VERSION_WORDS})\\b[^)\\]}]*[)\\]}]`, 'gi');
/** The same decorations written without brackets: "Song - Lofi Flip", "Song – 2019 Remaster". */
const VERSION_DASH = new RegExp(`\\s+[-–—]\\s+[^-–—]*\\b(?:${VERSION_WORDS})\\b[^-–—]*$`, 'i');
/** Invisible characters catalogue titles pick up (zero-width joiners stay: Indic scripts need them). */
const INVISIBLE = /[\u200B\u2060\uFEFF\u00AD]/g;

/** Primary credited artist for a song — the identity half of the canonical key. */
export function primaryArtist(s: Song): string {
  return s.artists?.[0]?.name ?? s.subtitle?.split(',')[0] ?? '';
}

const squash = (text: string): string => text.replace(/[^\p{L}\p{N}\p{M}]+/gu, '');

/**
 * Canonical song identity: normalized title + primary artist. "Monica",
 * "Monica (From \"Coolie\")", "Monica (2025 Remix)" and "Monica - Lofi Flip"
 * by the same artist all collapse onto one key, so one of them ever reaches a
 * queue or shelf. Unicode-safe: NFKC folds width/compatibility forms, and
 * combining marks are kept so Indic titles do not lose their vowel signs.
 */
export function canonicalKey(title: string, artist: string): string {
  const base = title.normalize('NFKC').replace(INVISIBLE, '').toLowerCase();
  const stripped = base
    .replace(VERSION_TAG, '')
    .replace(VERSION_DASH, '')
    .replace(/\s*[-–—]\s*from\s+.+$/i, '')
    .replace(/\s*(?:feat\.?|ft\.?|featuring)\s+.+$/i, '');
  // A title that is nothing BUT a version word ("Remix", "Live") keeps its own name.
  const t = squash(stripped) || squash(base);
  const a = squash(artist.normalize('NFKC').replace(INVISIBLE, '').toLowerCase().split(/[,&]/)[0]);
  return `${t}|${a}`;
}

export type VersionKind = 'original' | 'remaster' | 'alternate';

/** v7.0.0 — what kind of cut a title is: the plain release, a remaster of it, or an alternate (remix, live, slowed, cover…). */
export function versionKind(title: string): VersionKind {
  const base = title.normalize('NFKC').toLowerCase();
  const tags = [...(base.match(VERSION_TAG) ?? []), ...(base.match(VERSION_DASH) ?? [])].join(' ');
  if (!tags) return 'original';
  if (/\b(?:remix|reprise|mix|unplugged|reloaded|revisited|slowed|sped\s?up|reverb|lofi|lo-fi|live|acoustic|cover|karaoke|instrumental|edit|extended|female|male|duet|8d|bass\s?boosted|flip|mashup)\b/.test(tags)) return 'alternate';
  if (/\bremaster(?:ed)?\b/.test(tags)) return 'remaster';
  return 'original'; // "(From "Film")", a year, a deluxe/bonus tag: the same recording
}

const VERSION_RANK: Record<VersionKind, number> = { original: 0, remaster: 1, alternate: 2 };

/**
 * v7.0.0 — collapse songs that share a canonical identity, keeping the best
 * cut of each: the original over a remaster over an alternate, then the more
 * played one. Order-preserving — the survivor takes the FIRST position its
 * identity appeared at, so a ranked list stays ranked.
 */
export function dedupeByIdentity<T>(items: T[], songOf: (item: T) => Song): T[] {
  const slot = new Map<string, number>();
  const out: T[] = [];
  for (const item of items) {
    const song = songOf(item);
    const key = songKey(song);
    const at = slot.get(key);
    if (at === undefined) {
      slot.set(key, out.length);
      out.push(item);
      continue;
    }
    const kept = songOf(out[at]);
    const better = VERSION_RANK[versionKind(song.title)] - VERSION_RANK[versionKind(kept.title)] || (kept.playCount ?? 0) - (song.playCount ?? 0);
    if (better < 0) out[at] = item;
  }
  return out;
}

/** Canonical key straight from a Song. */
export function songKey(s: Song): string {
  return canonicalKey(s.title, primaryArtist(s));
}

interface ServedEntry {
  k: string;
  t: number;
}

function loadServed(): ServedEntry[] {
  let raw: unknown = servedMemory;
  try {
    const stored = window.localStorage.getItem(SERVED_KEY);
    if (stored != null) raw = JSON.parse(stored);
  } catch { /* retain session memory when storage is unavailable */ }
  const cutoff = Date.now() - SERVED_TTL;
  return Array.isArray(raw)
    ? raw.filter((e): e is ServedEntry => e && typeof e.k === 'string' && Number.isFinite(e.t) && e.t > cutoff).slice(0, SERVED_CAP)
    : [];
}

/** The shared served-identity set — consult it before surfacing anything. */
export function servedKeySet(): Set<string> {
  return new Set(loadServed().map((e) => e.k));
}

/** Remember served identities so no surface re-serves what another just played. */
export function recordServed(keys: string[]): void {
  if (!keys.length) return;
  try {
    const now = Date.now();
    const merged: ServedEntry[] = [...keys.map((k) => ({ k, t: now })), ...loadServed()];
    const seen = new Set<string>();
    const dedup: ServedEntry[] = [];
    for (const e of merged) {
      if (!seen.has(e.k)) {
        seen.add(e.k);
        dedup.push(e);
      }
    }
    servedMemory = dedup.slice(0, SERVED_CAP);
    window.localStorage.setItem(SERVED_KEY, JSON.stringify(servedMemory));
  } catch {
    /* storage unavailable — memory-less rounds still work, just less varied */
  }
}

/** True when a title is a non-song artifact (dialogue strip, BGM cut, …). */
export function isJunkTitle(title: string): boolean {
  return JUNK_TITLE.test(title);
}
