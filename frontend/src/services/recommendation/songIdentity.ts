/** Shared song identity and recently displayed music for catalog shelves and playlists. */
import type { Song } from '@/types';
import { canonicalKey, versionKind, versionTag, type VersionKind } from './identityCore';

/** Recently displayed songs shared by catalog shelves and playlists. */
const SERVED_KEY = 'vinax.flow.served.v1';
const SERVED_CAP = 300;
const SERVED_TTL = 7 * 24 * 60 * 60_000;
let servedMemory: ServedEntry[] = [];

/** Titles that are never songs — they poison queues when a search returns them. */
const JUNK_TITLE = /\b(dialogue|dialogues|bgm|jukebox|trailer|teaser|promo|ringtone|commentary)\b/i;

/** Primary credited artist for a song — the identity half of the canonical key. */
export function primaryArtist(s: Song): string {
  return s.artists?.[0]?.name ?? s.subtitle?.split(',')[0] ?? '';
}

// The normalisation itself is the shared contract in ./identityCore (kept
// byte-identical with the Worker's copy): NFKC, invisible characters dropped,
// Latin accents folded, Indic vowel signs kept, version decorations and
// featured credits stripped, primary artist only.
export { canonicalKey, recordingKey, versionKind, versionTag, type VersionKind } from './identityCore';

const VERSION_RANK: Record<VersionKind, number> = { original: 0, remaster: 1, alternate: 2 };

export interface DedupeOptions {
  /**
   * 7.2.0 — the listener asked for a particular recording (they chose a
   * remix, a live cut or a cover): within a family, the cut with this
   * version tag wins over the original instead of losing to it.
   */
  preferTag?: string | null;
}

/**
 * v7.0.0 — collapse songs that share a canonical identity, keeping the best
 * cut of each: the original over a remaster over an alternate, then the more
 * played one. Order-preserving — the survivor takes the FIRST position its
 * identity appeared at, so a ranked list stays ranked.
 */
export function dedupeByIdentity<T>(items: T[], songOf: (item: T) => Song, options: DedupeOptions = {}): T[] {
  const slot = new Map<string, number>();
  const out: T[] = [];
  const prefer = options.preferTag || null;
  const rank = (song: Song): number => (prefer && versionTag(song.title) === prefer ? -1 : VERSION_RANK[versionKind(song.title)]);
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
    const better = rank(song) - rank(kept) || (kept.playCount ?? 0) - (song.playCount ?? 0);
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

/** 9.0.0 — the in-memory copy is the source of truth only while storage refuses writes. */
let servedStorageFailed = false;

function loadServed(): ServedEntry[] {
  let raw: unknown = servedStorageFailed ? servedMemory : [];
  try {
    const stored = window.localStorage.getItem(SERVED_KEY);
    // A missing key is an empty memory (it was never written, or a reset removed it).
    // 8.x fell back to the in-memory copy here, so "Erase everything" left the
    // served list alive in memory until the next reload.
    if (stored != null) raw = JSON.parse(stored);
  } catch {
    raw = servedMemory; /* retain session memory when storage is unavailable */
  }
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
    servedStorageFailed = false;
  } catch {
    /* storage unavailable — this session keeps the memory; rounds still work */
    servedStorageFailed = true;
  }
}

/** 9.0.0 — forget every served identity (taste reset, tests). */
export function resetServedMemory(): void {
  servedMemory = [];
  servedStorageFailed = false;
  try {
    window.localStorage.removeItem(SERVED_KEY);
  } catch {
    /* nothing stored */
  }
}

/** True when a title is a non-song artifact (dialogue strip, BGM cut, …). */
export function isJunkTitle(title: string): boolean {
  return JUNK_TITLE.test(title);
}
