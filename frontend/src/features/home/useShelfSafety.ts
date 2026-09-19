import { useMemo, useSyncExternalStore } from 'react';
import type { Song } from '@/types';
import { useSettingsStore } from '@/store/settingsStore';
import { isSongBlocked, useLibraryStore } from '@/store/libraryStore';
import { isBlockedSong } from '@/services/content/blocklist';
import { loadProfile } from '@/services/personalization/storage';
import { safetyReasonFor } from '@/services/recommendation/filters';

/**
 * 7.2.0 — the listener's CURRENT safety settings as one predicate, for Home
 * lists that come out of a query cache or a placeholder: Kid mode (explicit
 * songs), muted languages, hidden songs and "never play" artists, the
 * server's blocklist and "show fewer like this" soft mutes — the same
 * `safetyReasonFor` rules the queue's hard filter applies.
 *
 * Filtering happens when the list RENDERS, so a newly forbidden song is gone
 * on the next render and no query key (and so no AI call) changes for a
 * safety-only change. The stores re-render on their own; soft mutes live in
 * the taste profile, which is not a store, so this also re-reads them after
 * any tap or key press (the gesture that added one) and when the page comes
 * back into view. Code that adds a soft mute without a gesture can call
 * `notifyShelfSafetyChanged()`.
 */
const listeners = new Set<() => void>();
let queued: ReturnType<typeof setTimeout> | undefined;
const EVENTS = ['click', 'keydown', 'visibilitychange'] as const;

/** After the event's own handlers have run (a tap's action is synchronous), let subscribers re-read. */
function ping(): void {
  if (queued) return;
  queued = setTimeout(() => {
    queued = undefined;
    for (const l of listeners) l();
  }, 0);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) for (const e of EVENTS) document.addEventListener(e, ping, true);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) for (const e of EVENTS) document.removeEventListener(e, ping, true);
  };
}

/** Active soft-mute keys, one per line: a string, so React re-renders only when the set changes. */
function softMuteSnapshot(): string {
  const now = Date.now();
  return Object.entries(loadProfile().softMuted ?? {})
    .filter(([, e]) => e.until > now)
    .map(([k]) => k)
    .sort()
    .join('\n');
}

export function notifyShelfSafetyChanged(): void {
  ping();
}

/** True when a song may be shown right now. */
export function useShelfSafety(): (song: Song) => boolean {
  const hideExplicit = useSettingsStore((s) => s.kidMode);
  const mutedLanguages = useSettingsStore((s) => s.mutedLanguages);
  const hiddenSongIds = useLibraryStore((s) => s.hiddenSongIds);
  const hiddenArtists = useLibraryStore((s) => s.hiddenArtists);
  const soft = useSyncExternalStore(subscribe, softMuteSnapshot, softMuteSnapshot);
  return useMemo(() => {
    // The snapshot holds only active entries, so each counts as muted until the next re-read.
    const softMuted = Object.fromEntries(soft ? soft.split('\n').map((k) => [k, { until: Infinity }]) : []);
    const library = { hiddenSongIds, hiddenArtists };
    const rules = { hideExplicit, mutedLanguages, softMuted, blocked: (s: Song) => isSongBlocked(s, library) || isBlockedSong(s) };
    return (song: Song) => safetyReasonFor(song, rules) === null;
  }, [hideExplicit, mutedLanguages, hiddenSongIds, hiddenArtists, soft]);
}
