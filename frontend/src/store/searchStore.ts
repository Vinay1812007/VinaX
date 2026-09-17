import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { KEYS } from '@/constants/storage-keys';
import { guardedLocalStorage } from '@/services/storage/local';
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

/** What makes two recents "the same search": NFC, case and runs of whitespace
 *  folded — "Arijit  Singh" and "arijit singh" are one entry. Exported for tests. */
export function recentKey(query: string): string {
  return query.normalize('NFC').toLowerCase().trim().replace(/\s+/g, ' ');
}

/** One entry per `recentKey`, first occurrence wins the position; when one of
 *  the duplicates is pinned, its spelling is the one kept (pins are matched by
 *  exact string, so dropping that spelling would orphan the pin). */
function dedupeRecents(list: string[], pinned: string[]): string[] {
  const at = new Map<string, number>();
  const out: string[] = [];
  for (const r of list) {
    const key = recentKey(r);
    if (!key) continue;
    const i = at.get(key);
    if (i === undefined) {
      at.set(key, out.length);
      out.push(r);
    } else if (pinned.includes(r) && !pinned.includes(out[i])) {
      out[i] = r;
    }
  }
  return out;
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
        const key = recentKey(q);
        // Rest-on-a-query recording catches a query mid-word: "arij", then
        // "arijit", then "arijit singh". The newest entry is dropped when the
        // new query merely extends it — unless the listener pinned it.
        const head = recent[0];
        const headKey = head === undefined ? '' : recentKey(head);
        const extendsHead =
          head !== undefined &&
          !pinned.includes(head) &&
          headKey.length > 0 &&
          headKey.length < key.length &&
          key.startsWith(headKey);
        const rest = extendsHead ? recent.slice(1) : recent;
        set({ recent: trimRecent(dedupeRecents([q, ...rest], pinned), pinned) });
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
      storage: createJSONStorage(() => guardedLocalStorage),
      partialize: (s) => ({ recent: s.recent, pinned: s.pinned, songSort: s.songSort }),
      // No persist version yet (0): the v5.17.0 fields are optional additions,
      // so an older blob simply lacks them — fill safe defaults instead of
      // letting `pinned` rehydrate as undefined.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Record<keyof SearchState, unknown>>;
        const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
        const pinned = dedupeRecents(strings(p.pinned), []).slice(0, PINNED_MAX);
        const recent = strings(p.recent);
        return {
          ...current,
          // Older blobs hold case / spacing variants of one search — fold them.
          recent: trimRecent(
            dedupeRecents([...recent, ...pinned.filter((q) => !recent.includes(q))], pinned),
            pinned,
          ),
          pinned,
          songSort: isSongSort(p.songSort) ? p.songSort : 'relevance',
        };
      },
    },
  ),
);
