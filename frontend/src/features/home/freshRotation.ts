import type { Song } from '@/types';
import { songKey } from '@/services/recommendation/songIdentity';
import { exposureLedger } from '@/services/recommendation/exposure';
import { useHistoryStore } from '@/store/historyStore';

/**
 * 1.14.4 — why Home kept showing the same songs, and the fix.
 *
 * The catalogue's /trending and /home feeds answer the SAME list on every
 * call (checked on the live API: the same 24 Telugu songs in the same order,
 * all day). Trending, New releases, the hero and Flow showed that list as it
 * came, so a refresh or a new visit changed nothing on screen.
 *
 * Now each of those shelves mixes the feed with a search page that rotates
 * with the Home generation (a refresh, or a visit after half an hour), and
 * orders the result per generation: songs the listener has not met lately
 * first, in an order shuffled by the generation's salt, then the ones they
 * heard, queued or were shown lately. Nothing is removed here; the shelf's
 * own surface rule (services/recommendation/surfacePolicy.ts) still applies.
 */

/** Deterministic shuffle: the same salt gives the same order, a new salt a new one. */
export function seededShuffle<T>(list: readonly T[], salt: number): T[] {
  const out = [...list];
  let h = (Math.abs(Math.floor(salt)) * 2654435761) >>> 0 || 1;
  for (let i = out.length - 1; i > 0; i -= 1) {
    h = (Math.imul(h, 1103515245) + 12345) >>> 0;
    const j = h % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export interface MetLately {
  /** True when the listener heard, queued or was shown this song lately. */
  (song: Song): boolean;
}

/** The listener's "met lately" check: the exposure ledger, plus the last plays in history. */
export function metLately(now = Date.now()): MetLately {
  const ledger = exposureLedger(now);
  const recent = new Set<string>();
  for (const e of useHistoryStore.getState().entries.slice(0, 60)) if (e?.song) recent.add(songKey(e.song));
  return (song) => {
    const key = songKey(song);
    return recent.has(key) || ledger.penalty(key) > 0;
  };
}

/**
 * One generation's order for a discovery shelf: unmet songs first, shuffled
 * by `salt`, then the met ones (also shuffled). Deduped by canonical identity.
 */
export function rotateFresh<T extends Song>(songs: readonly T[], salt: number, met: MetLately): T[] {
  const seen = new Set<string>();
  const fresh: T[] = [];
  const back: T[] = [];
  for (const s of songs) {
    if (!s?.id) continue;
    const key = songKey(s);
    if (seen.has(key)) continue;
    seen.add(key);
    (met(s) ? back : fresh).push(s);
  }
  return [...seededShuffle(fresh, salt), ...seededShuffle(back, salt + 1)];
}
