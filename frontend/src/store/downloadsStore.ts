import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Song } from '@/types';
import { KEYS } from '@/constants/storage-keys';

export interface DownloadItem {
  song: Song;
  path?: string;
  addedAt: number;
}

interface DownloadsState {
  items: Record<string, DownloadItem>;
  downloading: Record<string, boolean>;
  add(song: Song, path?: string): void;
  remove(id: string): void;
  setDownloading(id: string, v: boolean): void;
}

export const useDownloadsStore = create<DownloadsState>()(
  persist(
    (set, get) => ({
      items: {},
      downloading: {},
      add: (song, path) =>
        set({ items: { ...get().items, [song.id]: { song, path, addedAt: Date.now() } } }),
      remove: (id) => {
        const items = { ...get().items };
        delete items[id];
        set({ items });
      },
      setDownloading: (id, v) => {
        const d = { ...get().downloading };
        if (v) d[id] = true;
        else delete d[id];
        set({ downloading: d });
      },
    }),
    {
      name: KEYS.downloads,
      storage: createJSONStorage(() => window.localStorage),
      partialize: (s) => ({ items: s.items }),
    },
  ),
);
