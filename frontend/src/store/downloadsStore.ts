import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Song } from '@/types';
import { KEYS } from '@/constants/storage-keys';

/** Which Capacitor directory holds a saved file. Legacy items (no tag) live
 *  in the internal data directory. */
export type DownloadDir = 'DATA' | 'EXTERNAL';

export interface DownloadItem {
  song: Song;
  path?: string;
  /**
   * v5.7.3 — absolute file URI resolved once at save time. Persisting it lets
   * the app register a playable file-bridge URL for every download
   * synchronously at boot — before any filesystem call — so an offline launch
   * can play a saved song in its very first seconds.
   */
  uri?: string;
  dir?: DownloadDir;
  addedAt: number;
}

interface DownloadsState {
  items: Record<string, DownloadItem>;
  downloading: Record<string, boolean>;
  add(song: Song, path?: string, uri?: string, dir?: DownloadDir): void;
  setUri(id: string, uri: string): void;
  remove(id: string): void;
  setDownloading(id: string, v: boolean): void;
}

export const useDownloadsStore = create<DownloadsState>()(
  persist(
    (set, get) => ({
      items: {},
      downloading: {},
      add: (song, path, uri, dir) =>
        set({ items: { ...get().items, [song.id]: { song, path, uri, dir, addedAt: Date.now() } } }),
      setUri: (id, uri) => {
        const cur = get().items[id];
        if (!cur) return;
        set({ items: { ...get().items, [id]: { ...cur, uri } } });
      },
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
