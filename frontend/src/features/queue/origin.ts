import { usePlayerStore } from '@/store/playerStore';

/**
 * 7.2 — who put an upcoming entry in the queue.
 *
 *  - `manual`: the listener ("Add to queue", "Play next", "Keep this song").
 *    It keeps its place through every rebuild and AI refinement.
 *  - `auto`: the DJ appended it. A rebuild ("New DJ picks", a tune, a pinned
 *    mood) replaces it; "Keep this song" turns it into the listener's own.
 *  - `list`: neither — the album or playlist the listener started, or a queue
 *    restored after a reload (the player keeps ownership in memory only).
 *
 * Read at render time from the player's own sets; every ownership change
 * also replaces `queue`, so a component subscribed to the queue re-reads it.
 */
export type QueueOrigin = 'manual' | 'auto' | 'list';

export function originOf(id: string): QueueOrigin {
  const s = usePlayerStore.getState();
  if (s.isManualQueued(id)) return 'manual';
  if (s.isAutoQueued(id)) return 'auto';
  return 'list';
}

/** The marker's words. `list` entries carry no marker. */
export const ORIGIN_LABEL: Record<QueueOrigin, string | null> = {
  auto: 'DJ pick',
  manual: 'Added by you',
  list: null,
};

export interface UpcomingMix {
  auto: number;
  manual: number;
  list: number;
}

/** How the songs after the current one split by origin. */
export function upcomingMix(): UpcomingMix {
  const { queue, index } = usePlayerStore.getState();
  const mix: UpcomingMix = { auto: 0, manual: 0, list: 0 };
  for (const s of queue.slice(index + 1)) mix[originOf(s.id)] += 1;
  return mix;
}
