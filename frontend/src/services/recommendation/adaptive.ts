import type { Song } from '@/types';
import { usePlayerStore } from '@/store/playerStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useHistoryStore } from '@/store/historyStore';
import { readListenerEnergy } from '@/services/ai/sessionContext';
import { sequenceSongs, type ArcShape } from './sequencer';
import { admitSongs } from './admission';
import { toast } from '@/store/toastStore';

/**
 * v6.3.0 — adaptive re-planning. The recommender extends the queue with an
 * "auto tail"; when the listener skips two of its songs in a row, the read
 * is "restless" and the REMAINING auto tail is re-sequenced on the spot:
 * sure favourites first ("lift"), discovery held back, the listener's own
 * hand-queued songs untouched. Skips of songs the listener queued by hand
 * never trigger it, and a completed song resets the streak.
 */
let skipStreak = 0;
let lastReplanAt = 0;
const REPLAN_COOLDOWN_MS = 90_000;

/** Arc shape for the current session, from the same signals the AI DJ reads. */
export function shapeForSession(now = new Date()): ArcShape {
  const energy = readListenerEnergy(useHistoryStore.getState().entries, now.getHours());
  if (energy.startsWith('restless') || energy.startsWith('wavering')) return 'lift';
  if (energy.includes('late hours')) return 'wind-down';
  return 'steady';
}

/** Favourites and most-played ids: the "sure" picks a restless listener gets first. */
export function sureSongIds(): Set<string> {
  const favs = useLibraryStore.getState().favorites.map((s) => s.id);
  const counts = new Map<string, number>();
  for (const e of useHistoryStore.getState().entries) counts.set(e.song.id, (counts.get(e.song.id) ?? 0) + 1);
  const top = [...counts.entries()].filter(([, n]) => n >= 2).map(([id]) => id);
  return new Set([...favs, ...top]);
}

export function noteCompleted(): void {
  skipStreak = 0;
}

/** Called after the player records a skip. Returns true when a re-plan ran. */
export function noteSkipAndMaybeReplan(skipped: Song, now = Date.now()): boolean {
  const p = usePlayerStore.getState();
  if (!p.isAutoQueued(skipped.id)) {
    skipStreak = 0;
    return false;
  }
  skipStreak += 1;
  if (skipStreak < 2 || now - lastReplanAt < REPLAN_COOLDOWN_MS) return false;
  const current = p.queue[p.index] ?? null;
  const tail = p.autoTail();
  if (!current || tail.length < 3) return false;
  const sure = sureSongIds();
  const lang = current.language && current.language !== 'unknown' ? current.language : null;
  // Bring a few sure favourites into the pool. 7.2.0 — through the same
  // current-state gate as every automatic addition (Kid mode, hidden songs and
  // artists, muted languages, soft mutes, identity, recent plays, this
  // sitting's skips): a favourite is not exempt from the listener's rules.
  const inLanguage = useLibraryStore.getState().favorites.filter((s) => !lang || !s.language || s.language === lang);
  const extra = admitSongs(inLanguage, { queue: p.queue, index: p.index }).admitted.slice(0, 4);
  const plan = sequenceSongs([...extra, ...tail], { seed: current, shape: 'lift', sureIds: sure, language: lang, limit: tail.length + Math.min(2, extra.length) });
  const replacing = new Set(tail.map((s) => s.id));
  const admitted = admitSongs(plan.songs.map((s) => s.song), { queue: p.queue, index: p.index, replacing }).admitted;
  if (admitted.length < 3) return false;
  p.replaceAutoTail(admitted);
  skipStreak = 0;
  lastReplanAt = now;
  toast('Two skips — the DJ re-planned what comes next with surer picks');
  return true;
}

/**
 * 8.5.0 — a like re-plans too. Liking the song that is playing already pulls
 * its artist and language for this sitting (session intent); this makes the
 * pull felt NOW by rebuilding the automatic tail, instead of five songs
 * later. Hand-queued songs are never touched (only the auto tail is rebuilt),
 * and it shares the skip re-plan's cooldown so a burst of likes and skips
 * never churns the queue.
 */
export function noteLikeAndMaybeReplan(liked: Song, now = Date.now()): boolean {
  const p = usePlayerStore.getState();
  const current = p.queue[p.index];
  if (!current || current.id !== liked.id) return false;
  if (now - lastReplanAt < REPLAN_COOLDOWN_MS) return false;
  if (p.autoTail().length < 3) return false;
  p.regenerateAutoTail();
  skipStreak = 0;
  lastReplanAt = now;
  toast('Liked — more like this is coming up next');
  return true;
}

/** Test hook. */
export function resetAdaptive(): void {
  skipStreak = 0;
  lastReplanAt = 0;
}
