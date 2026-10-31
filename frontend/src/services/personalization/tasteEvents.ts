/**
 * One place that announces what the taste profile just learned. The updater
 * calls `emitTasteEvent` from every record* function, so anything that wants
 * to follow listening (the personal engine's reporter) subscribes here
 * instead of wrapping the player, the library and the search page one by
 * one. Session-only; nothing is stored.
 */
import type { Song } from '@/types';

export type TasteEventKind = 'play' | 'complete' | 'skip' | 'like' | 'unlike' | 'dislike' | 'save' | 'queue' | 'search_play';

export interface TasteEvent {
  kind: TasteEventKind;
  song: Song;
  heardSec?: number;
  at: number;
}

type Listener = (e: TasteEvent) => void;
const listeners = new Set<Listener>();

export function onTasteEvent(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function emitTasteEvent(e: Omit<TasteEvent, 'at'> & { at?: number }): void {
  const full: TasteEvent = { ...e, at: e.at ?? Date.now() };
  for (const cb of [...listeners]) {
    try {
      cb(full);
    } catch {
      /* a listener's failure never reaches the profile */
    }
  }
}
