import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { KEYS } from '@/constants/storage-keys';

export interface SearchState {
  recent: string[];
  addRecent(query: string): void;
  removeRecent(query: string): void;
  clearRecent(): void;
}

export const useSearchStore = create<SearchState>()(
  persist(
    (set, get) => ({
      recent: [],
      addRecent: (query) => {
        const q = query.trim();
        if (!q) return;
        set({ recent: [q, ...get().recent.filter((r) => r !== q)].slice(0, 12) });
      },
      removeRecent: (query) => set({ recent: get().recent.filter((r) => r !== query) }),
      clearRecent: () => set({ recent: [] }),
    }),
    { name: KEYS.search, storage: createJSONStorage(() => window.localStorage) },
  ),
);
