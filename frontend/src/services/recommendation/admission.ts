import type { Song } from '@/types';
import { rejectReasonFor } from './filters';
import { songKey } from './songIdentity';
import type { RejectReason } from './types';
import { useSettingsStore } from '@/store/settingsStore';
import { isSongBlocked, useLibraryStore } from '@/store/libraryStore';
import { useHistoryStore } from '@/store/historyStore';
import { loadProfile } from '@/services/personalization/storage';
import { getSessionIntent } from '@/services/personalization/sessionIntent';

/**
 * 7.2.0 — the one admission gate for every AUTOMATIC queue mutation: a
 * continuation append, an adaptive re-plan, an AI refinement of the automatic
 * tail, a reserve top-up. It reads the listener's restrictions AT CALL TIME
 * (never a snapshot taken before an await), so a song that became forbidden
 * while a request was in flight — Kid mode switched on, a song or artist
 * hidden, a language muted, an artist soft-muted — never reaches the queue.
 *
 * Rules, each with a named reason (`filters.ts`): valid metadata, junk and
 * too-short cuts, explicit under Kid mode, hidden songs and artists, muted
 * languages, a soft-muted lead artist ("show fewer like this", until it
 * expires), another cut of the playing song, anything already in the queue
 * (by id or canonical identity), recent plays (by identity), and songs
 * skipped in this sitting. Survivors are de-duplicated by identity.
 *
 * `mode: 'plan'` is for lists the listener installs on purpose (Queue
 * Builder): only the explicit restrictions apply — invalid entries, explicit
 * under Kid mode, hidden, muted languages.
 */
export type AdmissionReason = RejectReason | 'soft-muted';

export interface AdmissionOptions {
  queue: Song[];
  index: number;
  /** Queue entries being replaced by this mutation (the old automatic tail): not counted as duplicates. */
  replacing?: Set<string>;
  mode?: 'automatic' | 'plan';
  now?: number;
}

export interface AdmissionResult {
  admitted: Song[];
  rejected: Array<{ song: Song; reason: AdmissionReason }>;
}

const EXPLICIT_RULES: ReadonlySet<AdmissionReason> = new Set<AdmissionReason>(['invalid', 'explicit', 'blocked', 'muted-language']);

/** Is the song's lead artist under an active "show fewer like this" soft mute? */
export function isSoftMuted(song: Song, now = Date.now()): boolean {
  const muted = loadProfile().softMuted;
  const lead = song?.artists?.[0];
  if (!muted || !lead) return false;
  const entry = (lead.id ? muted[lead.id] : undefined) ?? muted[lead.name.toLowerCase()];
  return !!entry && entry.until > now;
}

export function admitSongs(songs: Song[], o: AdmissionOptions): AdmissionResult {
  const settings = useSettingsStore.getState();
  const library = useLibraryStore.getState();
  const mode = o.mode ?? 'automatic';
  const now = o.now ?? Date.now();
  const current = o.queue[o.index] ?? null;
  const kept = o.queue.filter((s) => !o.replacing?.has(s.id));
  const rules = {
    seed: mode === 'automatic' ? current : null,
    queuedIds: mode === 'automatic' ? new Set(kept.map((s) => s.id)) : undefined,
    queuedKeys: mode === 'automatic' ? new Set(kept.map(songKey)) : undefined,
    recentKeys: mode === 'automatic' ? new Set(useHistoryStore.getState().entries.slice(0, 20).map((e) => songKey(e.song))) : undefined,
    sessionSkippedIds: mode === 'automatic' ? getSessionIntent(now).skippedSongIds : undefined,
    mutedLanguages: settings.mutedLanguages,
    blocked: (song: Song) => isSongBlocked(song, library),
    hideExplicit: settings.kidMode,
  };
  const admitted: Song[] = [];
  const rejected: AdmissionResult['rejected'] = [];
  const ids = new Set<string>();
  const keys = new Set<string>();
  for (const song of songs) {
    let reason: AdmissionReason | null = rejectReasonFor(song, rules);
    if (reason && mode === 'plan' && !EXPLICIT_RULES.has(reason)) reason = null;
    if (!reason && mode === 'automatic' && isSoftMuted(song, now)) reason = 'soft-muted';
    if (!reason) {
      const key = songKey(song);
      // A plan may hold two cuts on purpose; automatic additions never do.
      const duplicate = ids.has(song.id) || (mode === 'automatic' && keys.has(key));
      if (!duplicate) {
        ids.add(song.id);
        keys.add(key);
        admitted.push(song);
        continue;
      }
      reason = 'duplicate-version';
    }
    rejected.push({ song, reason });
  }
  return { admitted, rejected };
}
