import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { HistoryEntry, Song } from '@/types';
import { KEYS } from '@/constants/storage-keys';

const MAX_ENTRIES = 150;

export interface HistoryState {
  entries: HistoryEntry[];
  addPlay(song: Song): void;
  markCompleted(songId: string): void;
  clearHistory(): void;
  /** v5.17.0 — drop one play (entries are keyed by their timestamp). */
  removeEntry(ts: number): void;
  /** v5.17.0 — drop every play at or after `ts` ("clear last hour" / "clear today"). */
  clearSince(ts: number): void;
  /** Add measured playback seconds to the most recent play of `songId` (listen clock). */
  addListened(songId: string, seconds: number): void;
}

export const useHistoryStore = create<HistoryState>()(
  persist(
    (set, get) => ({
      entries: [],
      addPlay: (song) =>
        set({
          entries: [{ song, ts: Date.now(), completed: false }, ...get().entries].slice(
            0,
            MAX_ENTRIES,
          ),
        }),
      markCompleted: (songId) => {
        const entries = [...get().entries];
        const idx = entries.findIndex((e) => e.song.id === songId && !e.completed);
        if (idx >= 0) {
          entries[idx] = { ...entries[idx], completed: true };
          void import('@/services/analytics/telemetry').then((m) => m.trackComplete(entries[idx].song));
        }
        set({ entries });
      },
      clearHistory: () => set({ entries: [] }),
      addListened: (songId, seconds) => {
        if (!(seconds > 0) || !Number.isFinite(seconds)) return;
        const entries = get().entries;
        const idx = entries.findIndex((e) => e.song.id === songId);
        if (idx < 0) return;
        const next = [...entries];
        const cur = next[idx];
        next[idx] = { ...cur, listenedSec: Math.round(((cur.listenedSec ?? 0) + seconds) * 10) / 10 };
        set({ entries: next });
      },
      removeEntry: (ts) => set({ entries: get().entries.filter((e) => e.ts !== ts) }),
      clearSince: (ts) => set({ entries: get().entries.filter((e) => e.ts < ts) }),
    }),
    { name: KEYS.history, storage: createJSONStorage(() => window.localStorage) },
  ),
);
