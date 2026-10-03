/** Shared song identity and recently displayed music for catalog shelves and playlists. */
import type { Song } from '@/types';
import { versionKind, versionTag, type VersionKind } from './identityCore';
import { exposureLedger, recordExposureKeys, resetExposure } from './exposure';
import { songKey } from './songKey';

/** Titles that are never songs — they poison queues when a search returns them. */
const JUNK_TITLE = /\b(dialogue|dialogues|bgm|jukebox|trailer|teaser|promo|ringtone|commentary)\b/i;

// The normalisation itself is the shared contract in ./identityCore (kept
// byte-identical with the Worker's copy): NFKC, invisible characters dropped,
// Latin accents folded, Indic vowel signs kept, version decorations and
// featured credits stripped, primary artist only. The Song-level key is
// ./songKey (its own module so ./exposure can use it without a cycle).
export { canonicalKey, recordingKey, versionKind, versionTag, type VersionKind } from './identityCore';
export { primaryArtist, songKey } from './songKey';

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

/**
 * 9.1.0 — the "shown on another surface" memory is now one slice of the
 * shared exposure ledger (./exposure.ts), which also knows what was queued,
 * played, completed and skipped, and how long ago. These three functions are
 * kept as the names every Home hook and the AI Playlist already call; they
 * read and write that ledger instead of the old `vinax.flow.served.v1` list.
 * A device's old list is imported once by `migrateLegacyExposure`.
 */

/** The shared shown-identity set — consult it before surfacing anything. */
export function servedKeySet(): Set<string> {
  return new Set(exposureLedger().shownKeys);
}

/** Remember shown identities so no surface re-serves what another just showed. */
export function recordServed(keys: string[]): void {
  recordExposureKeys(keys, 'shown');
}

/** 9.0.0 — forget every exposure (taste reset, tests). */
export function resetServedMemory(): void {
  resetExposure();
}

/** True when a title is a non-song artifact (dialogue strip, BGM cut, …). */
export function isJunkTitle(title: string): boolean {
  return JUNK_TITLE.test(title);
}
