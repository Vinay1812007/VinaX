import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Song } from '@/types';
import { KEYS } from '@/constants/storage-keys';
import { recordFavorite } from '@/services/personalization/updater';
import { findDuplicates } from '@/features/library/duplicates';
import { pruneTrash, type TrashEntry } from '@/features/library/trash';
import { normalizeTags } from '@/features/library/tags';

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
/** Normalised artist name for the never-play list. */
export function artistKey(name: string): string {
  return name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** v5.12.0 — true when a song is hidden outright or credited to a never-play artist. */
export function isSongBlocked(song: Song, state: { hiddenSongIds: string[]; hiddenArtists: string[] }): boolean {
  if (state.hiddenSongIds.includes(song.id)) return true;
  if (!state.hiddenArtists.length) return false;
  const names = [...song.artists.map((a) => a.name), ...song.subtitle.split(',')].map(artistKey).filter(Boolean);
  return names.some((n) => state.hiddenArtists.includes(n));
}

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
  /** v5.17.0 — pinned collections list first in the Library. */
  pinned?: boolean;
  /** v5.17.0 — optional blurb shown under the name. */
  description?: string;
  /** v5.17.0 — optional glyph shown on the Library tile. */
  emoji?: string;
  /** v5.19.0 — lower-case labels (max 8, 24 chars each) the Library can filter by. */
  tags?: string[];
}

/** v5.17.0 — editable metadata beyond the name. */
export interface CollectionMeta {
  description?: string;
  emoji?: string;
}

export type { TrashEntry };

/** v5.17.0 — pinned first (stable), otherwise the stored order. */
export function orderCollections(collections: LocalCollection[]): LocalCollection[] {
  return [...collections.filter((c) => c.pinned), ...collections.filter((c) => !c.pinned)];
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
  /** v5.12.0 — Listen Later: a lightweight 'save for later' queue, separate from favorites. */
  later: Song[];
  /** v5.12.0 — artists the listener never wants to hear (normalised lower-case names). */
  hiddenArtists: string[];
  /** v5.17.0 — recently deleted collections, newest first; kept 7 days, max 20. */
  trash: TrashEntry[];

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
  /** v5.17.0 — pin / unpin a collection so it lists first. */
  togglePinCollection(id: string): void;
  /** v5.17.0 — bring a trashed collection back (no-op when it expired). */
  restoreCollection(id: string): void;
  /** v5.17.0 — empty the recently-deleted list for good. */
  purgeTrash(): void;
  /** v5.17.0 — drop repeated songs, keeping the first occurrence; returns how many were removed. */
  dedupeCollection(id: string): number;
  /** v5.17.0 — set description / emoji (empty strings clear the field). */
  updateCollectionMeta(id: string, meta: CollectionMeta): void;
  /** v5.19.0 — replace a collection's tags (normalised; an empty list clears the field). */
  setCollectionTags(id: string, tags: string[] | string): void;
  toggleLater(song: Song): void;
  isLater(id: string): boolean;
  toggleHiddenArtist(name: string): void;
  isArtistHidden(song: Song): boolean;
}

export const useLibraryStore = create<LibraryState>()(
  persist(
    (set, get) => ({
      favorites: [],
      collections: [],
      saved: [],
      hiddenSongIds: [],
      later: [],
      hiddenArtists: [],
      trash: [],
      toggleLater: (song) => {
        const has = get().later.some((s) => s.id === song.id);
        set({ later: has ? get().later.filter((s) => s.id !== song.id) : [song, ...get().later].slice(0, 500) });
      },
      isLater: (id) => get().later.some((s) => s.id === id),
      toggleHiddenArtist: (name) => {
        const key = artistKey(name);
        if (!key) return;
        const list = get().hiddenArtists;
        set({ hiddenArtists: list.includes(key) ? list.filter((a) => a !== key) : [...list, key] });
      },
      isArtistHidden: (song) => isSongBlocked(song, get()),
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
      deleteCollection: (id) => {
        const { collections, trash } = get();
        const victim = collections.find((c) => c.id === id);
        if (!victim) return;
        const now = Date.now();
        set({
          collections: collections.filter((c) => c.id !== id),
          trash: pruneTrash([{ collection: victim, deletedAt: now }, ...trash.filter((t) => t.collection.id !== id)], now),
        });
      },
      restoreCollection: (id) => {
        const { collections, trash } = get();
        const entry = pruneTrash(trash).find((t) => t.collection.id === id);
        const rest = trash.filter((t) => t.collection.id !== id);
        if (!entry) {
          set({ trash: rest });
          return;
        }
        const restored = collections.some((c) => c.id === id) ? collections : [...collections, entry.collection];
        set({ collections: restored, trash: rest });
      },
      purgeTrash: () => set({ trash: [] }),
      togglePinCollection: (id) =>
        set({ collections: get().collections.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c)) }),
      dedupeCollection: (id) => {
        const target = get().collections.find((c) => c.id === id);
        if (!target) return 0;
        const { unique, duplicates } = findDuplicates(target.songs);
        if (!duplicates.length) return 0;
        set({ collections: get().collections.map((c) => (c.id === id ? { ...c, songs: unique } : c)) });
        return duplicates.length;
      },
      updateCollectionMeta: (id, meta) =>
        set({
          collections: get().collections.map((c) => {
            if (c.id !== id) return c;
            const next: LocalCollection = { ...c };
            if (meta.description !== undefined) {
              const d = meta.description.trim().slice(0, 280);
              if (d) next.description = d;
              else delete next.description;
            }
            if (meta.emoji !== undefined) {
              const e = meta.emoji.trim().slice(0, 8);
              if (e) next.emoji = e;
              else delete next.emoji;
            }
            return next;
          }),
        }),
      setCollectionTags: (id, tags) =>
        set({
          collections: get().collections.map((c) => {
            if (c.id !== id) return c;
            const clean = normalizeTags(tags);
            const next: LocalCollection = { ...c };
            if (clean.length) next.tags = clean;
            else delete next.tags;
            return next;
          }),
        }),
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
    {
      name: KEYS.library,
      storage: createJSONStorage(() => window.localStorage),
      // v5.17.0 — expired "recently deleted" entries are pruned as the
      // persisted snapshot is merged in, so they never reach the page.
      merge: (persisted, current) => {
        const p = (persisted && typeof persisted === 'object' ? persisted : {}) as Partial<LibraryState>;
        return { ...current, ...p, trash: pruneTrash(p.trash) };
      },
      onRehydrateStorage: () => (state) => { if (state) rebuildIndexes(state); },
    },
  ),
);
