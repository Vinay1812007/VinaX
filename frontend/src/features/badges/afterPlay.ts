/**
 * 1.12 — after a play is recorded (store/playerStore.ts, by dynamic import
 * so the first load carries none of this): a moment later, once the streak
 * has moved, count the play and announce any badge it earned. Also asks the
 * public profile to carry the new badge on its next digest.
 *
 * The player store hands over what the check needs and how to announce it;
 * importing the stores from here would make the bundler carve a chunk they
 * share with the player store, and that costs first-load bytes.
 */
import type { HistoryEntry } from '@/types';
import { getBestStreak, getStreak } from '@/utils/streak';
import { checkBadges, type CheckResult } from './engine';

export interface PlayFacts {
  entries: readonly HistoryEntry[];
  favorites: number;
  playlists: number;
}

export interface Announce {
  toast: (message: string, opts: { key: string; duration: number; action: { label: string; onClick: () => void } }) => void;
  navigate: (to: string) => void;
}

/** The longest listening streak reached: the live one or the record, whichever is longer. */
export const streakDaysNow = (): number => Math.max(getStreak(), getBestStreak());

/** Run the check on these facts. */
export function checkWith(facts: PlayFacts, now = Date.now()): CheckResult {
  return checkBadges({ entries: facts.entries, streakDays: streakDaysNow(), favorites: facts.favorites, playlists: facts.playlists, now });
}

let timer: ReturnType<typeof setTimeout> | null = null;

export function afterPlay(facts: () => PlayFacts, announce: Announce, delayMs = 1500): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    let r: CheckResult;
    try {
      r = checkWith(facts());
    } catch {
      return;
    }
    if (!r.newlyEarned.length) return;
    const [first, ...rest] = r.newlyEarned;
    const label = rest.length ? `${first.glyph} Badge earned: ${first.name} and ${rest.length} more` : `${first.glyph} Badge earned: ${first.name}`;
    announce.toast(label, { key: 'badge', duration: 7000, action: { label: 'See', onClick: () => announce.navigate('/stats#badges') } });
    // The public profile shows badges: send the digest early rather than at the half-hour.
    void import('@/features/social/store').then((m) => m.useSocialStore.getState().pushDigest(true)).catch(() => undefined);
  }, delayMs);
}
