import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { STORAGE_PREFIX } from '@/constants/storage-keys';

/**
 * v5.17.0 — moments inside songs. A bookmark is a timestamp (seconds) on a
 * song id; Now Playing → More shows them as chips you can jump to. On this
 * device only, like everything else.
 */
interface BookmarkState {
  marks: Record<string, number[]>;
  add(songId: string, seconds: number): void;
  remove(songId: string, seconds: number): void;
  clear(songId: string): void;
}

export const useBookmarkStore = create<BookmarkState>()(
  persist(
    (set, get) => ({
      marks: {},
      add: (songId, seconds) => {
        const s = Math.max(0, Math.round(seconds));
        const cur = get().marks[songId] ?? [];
        if (cur.some((m) => Math.abs(m - s) < 3)) return;
        const next = [...cur, s].sort((a, b) => a - b).slice(0, 12);
        set({ marks: { ...get().marks, [songId]: next } });
      },
      remove: (songId, seconds) => {
        const next = (get().marks[songId] ?? []).filter((m) => m !== seconds);
        const marks = { ...get().marks };
        if (next.length) marks[songId] = next;
        else delete marks[songId];
        set({ marks });
      },
      clear: (songId) => {
        const marks = { ...get().marks };
        delete marks[songId];
        set({ marks });
      },
    }),
    { name: `${STORAGE_PREFIX}.bookmarks.v1`, storage: createJSONStorage(() => window.localStorage) },
  ),
);
