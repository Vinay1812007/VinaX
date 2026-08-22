import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Song } from '@/types';
import { KEYS } from '@/constants/storage-keys';
import { recordFavorite } from '@/services/personalization/updater';

/** Derived indexes for O(1) membership checks. */
let _favIds = new Set<string>();
let _savedIds = new Set<string>();
let _hiddenIds = new Set<string>();

/**
 * Rebuild every derived index from the state snapshot passed in. The previous
 * signature accepted an optional `hiddenSongIds` and, when a caller (favorite
 * or saved toggle) omitted it, `_hiddenIds` was silently reset to the empty
 * set — so hidden songs would re-appear in shelves and the unlimited feed
 * until reload (audit finding H1). Callers must now pass the FULL snapshot
 * or the compiler will flag it.
 */
function rebuildIndexes(state: { favorites: Song[]; saved: SavedEntity[]; hiddenSongIds: string[] }) {
  _favIds = new Set(state.favorites.map(s => s.id));
  _savedIds = new Set(state.saved.map(e => e.id));
  _hiddenIds = new Set(state.hiddenSongIds);
}

export interface LocalCollection {
  id: string;
  name: string;
  createdAt: number;
  songs: Song[];
}

export interface SavedEntity {
  id: string;
  kind: 'album' | 'artist' | 'playlist';
  title: string;
  subtitle: string;
  image: string | null;
  savedAt: number;
}

export interface LibraryState {
  favorites: Song[];
  collections: LocalCollection[];
  saved: SavedEntity[];
  hiddenSongIds: string[];

  toggleFavorite(song: Song): void;
  isFavorite(id: string): boolean;
  clearFavorites(): void;
  toggleSaved(entity: Omit<SavedEntity, 'savedAt'>): void;
  isSaved(id: string): boolean;
  toggleHidden(songId: string): void;
  isHidden(id: string): boolean;
  createCollection(name: string): string;
  deleteCollection(id: string): void;
  addToCollection(collectionId: string, song: Song): void;
  removeFromCollection(collectionId: string, songId: string): void;
  renameCollection(id: string, name: string): void;
  moveInCollection(collectionId: string, from: number, to: number): void;
}

export const useLibraryStore = create<LibraryState>()(
  persist(
    (set, get) => ({
      favorites: [],
      collections: [],
      saved: [],
      hiddenSongIds: [],
      toggleFavorite: (song) => {
        if (!get().favorites.some((s) => s.id === song.id))
          void import('@/services/analytics/telemetry').then((m) => m.trackFavorite(song));
        const { favorites, saved, hiddenSongIds } = get();
        const exists = favorites.some((s) => s.id === song.id);
        recordFavorite(song, !exists);
        const newFavorites = exists ? favorites.filter((s) => s.id !== song.id) : [song, ...favorites];
        set({ favorites: newFavorites });
        rebuildIndexes({ favorites: newFavorites, saved, hiddenSongIds });
      },
      isFavorite: (id) => _favIds.has(id),
      clearFavorites: () => {
        const { saved, hiddenSongIds } = get();
        set({ favorites: [] });
        rebuildIndexes({ favorites: [], saved, hiddenSongIds });
      },
      toggleSaved: (entity) => {
        const { saved, favorites, hiddenSongIds } = get();
        const exists = saved.some((e) => e.id === entity.id && e.kind === entity.kind);
        const newSaved = exists
            ? saved.filter((e) => !(e.id === entity.id && e.kind === entity.kind))
            : [{ ...entity, savedAt: Date.now() }, ...saved];
        set({ saved: newSaved });
        rebuildIndexes({ favorites, saved: newSaved, hiddenSongIds });
      },
      isSaved: (id) => _savedIds.has(id),
      toggleHidden: (songId) => {
        const { hiddenSongIds } = get();
        const next = hiddenSongIds.includes(songId)
          ? hiddenSongIds.filter((i) => i !== songId)
          : [songId, ...hiddenSongIds].slice(0, 500);
        set({ hiddenSongIds: next });
        _hiddenIds = new Set(next);
      },
      isHidden: (id) => _hiddenIds.has(id),
      createCollection: (name) => {
        const id = `col-${Date.now().toString(36)}`;
        set({
          collections: [...get().collections, { id, name, createdAt: Date.now(), songs: [] }],
        });
        return id;
      },
      deleteCollection: (id) => set({ collections: get().collections.filter((c) => c.id !== id) }),
      addToCollection: (collectionId, song) =>
        set({
          collections: get().collections.map((c) =>
            c.id === collectionId && !c.songs.some((s) => s.id === song.id)
              ? { ...c, songs: [...c.songs, song] }
              : c,
          ),
        }),
      removeFromCollection: (collectionId, songId) =>
        set({
          collections: get().collections.map((c) =>
            c.id === collectionId ? { ...c, songs: c.songs.filter((s) => s.id !== songId) } : c,
          ),
        }),
      renameCollection: (id, name) =>
        set({ collections: get().collections.map((c) => (c.id === id ? { ...c, name } : c)) }),
      moveInCollection: (collectionId, from, to) =>
        set({
          collections: get().collections.map((c) => {
            if (c.id !== collectionId) return c;
            const songs = [...c.songs];
            if (from < 0 || from >= songs.length || to < 0 || to >= songs.length) return c;
            const [m] = songs.splice(from, 1);
            songs.splice(to, 0, m);
            return { ...c, songs };
          }),
        }),
    }),
    { name: KEYS.library, storage: createJSONStorage(() => window.localStorage), onRehydrateStorage: () => (state) => { if (state) rebuildIndexes(state); } },
  ),
);
