import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { KEYS } from '@/constants/storage-keys';
import { toast } from './toastStore';

/** v5.17.0 — Songs-tab sort orders. 'relevance' is the existing ranking pass. */
export const SONG_SORTS = ['relevance', 'popular', 'newest', 'longest', 'shortest', 'az'] as const;
export type SongSort = (typeof SONG_SORTS)[number];

export function isSongSort(v: unknown): v is SongSort {
  return typeof v === 'string' && (SONG_SORTS as readonly string[]).includes(v);
}

const RECENT_MAX = 12;
export const PINNED_MAX = 5;

export interface SearchState {
  recent: string[];
  /** v5.17.0 — recents the listener keeps at the front (max 5). Every pinned
   *  query is also present in `recent`; pinning never lets it be pushed out. */
  pinned: string[];
  /** v5.17.0 — last sort chosen on the Songs tab. */
  songSort: SongSort;
  addRecent(query: string): void;
  removeRecent(query: string): void;
  /** Clears every recent search EXCEPT the pinned ones. */
  clearRecent(): void;
  pinRecent(query: string): void;
  unpinRecent(query: string): void;
  togglePin(query: string): void;
  setSongSort(sort: SongSort): void;
}

/** Keep every pinned entry, cap the rest at RECENT_MAX, most recent first. */
function trimRecent(recent: string[], pinned: string[]): string[] {
  const keep = new Set(pinned);
  let free = RECENT_MAX;
  return recent.filter((r) => {
    if (keep.has(r)) return true;
    if (free <= 0) return false;
    free -= 1;
    return true;
  });
}

export const useSearchStore = create<SearchState>()(
  persist(
    (set, get) => ({
      recent: [],
      pinned: [],
      songSort: 'relevance',
      addRecent: (query) => {
        const q = query.trim();
        if (!q) return;
        const { recent, pinned } = get();
        set({ recent: trimRecent([q, ...recent.filter((r) => r !== q)], pinned) });
      },
      removeRecent: (query) =>
        set({
          recent: get().recent.filter((r) => r !== query),
          pinned: get().pinned.filter((r) => r !== query),
        }),
      clearRecent: () => {
        const { pinned } = get();
        set({ recent: pinned.length ? get().recent.filter((r) => pinned.includes(r)) : [] });
      },
      pinRecent: (query) => {
        const q = query.trim();
        if (!q) return;
        const { recent, pinned } = get();
        if (pinned.includes(q)) return;
        if (pinned.length >= PINNED_MAX) {
          toast(`You can pin up to ${PINNED_MAX} searches`);
          return;
        }
        const nextPinned = [...pinned, q];
        const nextRecent = recent.includes(q) ? recent : [q, ...recent];
        set({ pinned: nextPinned, recent: trimRecent(nextRecent, nextPinned) });
      },
      unpinRecent: (query) => set({ pinned: get().pinned.filter((r) => r !== query) }),
      togglePin: (query) => {
        if (get().pinned.includes(query)) get().unpinRecent(query);
        else get().pinRecent(query);
      },
      setSongSort: (sort) => set({ songSort: isSongSort(sort) ? sort : 'relevance' }),
    }),
    {
      name: KEYS.search,
      storage: createJSONStorage(() => window.localStorage),
      partialize: (s) => ({ recent: s.recent, pinned: s.pinned, songSort: s.songSort }),
      // No persist version yet (0): the v5.17.0 fields are optional additions,
      // so an older blob simply lacks them — fill safe defaults instead of
      // letting `pinned` rehydrate as undefined.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Record<keyof SearchState, unknown>>;
        const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
        const pinned = strings(p.pinned).slice(0, PINNED_MAX);
        const recent = strings(p.recent);
        return {
          ...current,
          recent: trimRecent([...recent, ...pinned.filter((q) => !recent.includes(q))], pinned),
          pinned,
          songSort: isSongSort(p.songSort) ? p.songSort : 'relevance',
        };
      },
    },
  ),
);
