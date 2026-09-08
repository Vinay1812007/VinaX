// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Song } from '@/types';
import { KEYS } from '@/constants/storage-keys';
import { TRASH_TTL_MS } from '@/features/library/trash';

vi.mock('@/services/personalization/updater', () => ({ recordFavorite: () => undefined }));

import { orderCollections, useLibraryStore } from './libraryStore';

const song = (id: string, title: string, artist = 'Artist'): Song => ({
  kind: 'song',
  id,
  title,
  subtitle: artist,
  artists: [{ id: `a-${artist}`, name: artist }],
  album: null,
  images: [],
  audio: [],
  duration: 200,
  language: 'telugu',
  year: '2024',
  explicit: false,
  hasLyrics: false,
  playCount: null,
});

const reset = () =>
  useLibraryStore.setState({ favorites: [], collections: [], saved: [], hiddenSongIds: [], later: [], hiddenArtists: [], trash: [] });

describe('libraryStore v5.17.0 — collections', () => {
  beforeEach(() => {
    window.localStorage.clear();
    reset();
  });

  it('deleteCollection moves it to trash and restoreCollection brings it back', () => {
    const s = useLibraryStore.getState();
    const id = s.createCollection('Road trip');
    s.addToCollection(id, song('1', 'A'));
    s.deleteCollection(id);
    expect(useLibraryStore.getState().collections).toHaveLength(0);
    expect(useLibraryStore.getState().trash.map((t) => t.collection.id)).toEqual([id]);
    useLibraryStore.getState().restoreCollection(id);
    expect(useLibraryStore.getState().trash).toHaveLength(0);
    expect(useLibraryStore.getState().collections[0]).toMatchObject({ id, name: 'Road trip' });
    expect(useLibraryStore.getState().collections[0].songs).toHaveLength(1);
  });

  it('purgeTrash empties the list and deleting an unknown id is a no-op', () => {
    const s = useLibraryStore.getState();
    s.deleteCollection('nope');
    expect(useLibraryStore.getState().trash).toHaveLength(0);
    const id = s.createCollection('X');
    s.deleteCollection(id);
    useLibraryStore.getState().purgeTrash();
    expect(useLibraryStore.getState().trash).toHaveLength(0);
  });

  it('togglePinCollection flips the flag and orderCollections lists pinned first', () => {
    const s = useLibraryStore.getState();
    const a = s.createCollection('A');
    const b = s.createCollection('B');
    useLibraryStore.getState().togglePinCollection(b);
    expect(orderCollections(useLibraryStore.getState().collections).map((c) => c.id)).toEqual([b, a]);
    useLibraryStore.getState().togglePinCollection(b);
    expect(orderCollections(useLibraryStore.getState().collections).map((c) => c.id)).toEqual([a, b]);
  });

  it('dedupeCollection keeps the first occurrence and reports the count', () => {
    const s = useLibraryStore.getState();
    const id = s.createCollection('Dupes');
    // addToCollection already rejects a repeated id, so seed the list directly.
    useLibraryStore.setState({
      collections: useLibraryStore.getState().collections.map((c) =>
        c.id === id ? { ...c, songs: [song('1', 'Kesariya', 'Arijit'), song('2', 'Other'), song('3', 'kesariya', 'arijit')] } : c,
      ),
    });
    expect(useLibraryStore.getState().dedupeCollection(id)).toBe(1);
    expect(useLibraryStore.getState().collections[0].songs.map((x) => x.id)).toEqual(['1', '2']);
    expect(useLibraryStore.getState().dedupeCollection(id)).toBe(0);
  });

  it('updateCollectionMeta sets and clears description / emoji', () => {
    const s = useLibraryStore.getState();
    const id = s.createCollection('Meta');
    useLibraryStore.getState().updateCollectionMeta(id, { description: '  Long drives  ', emoji: '🚗' });
    expect(useLibraryStore.getState().collections[0]).toMatchObject({ description: 'Long drives', emoji: '🚗' });
    useLibraryStore.getState().updateCollectionMeta(id, { description: '' });
    expect(useLibraryStore.getState().collections[0].description).toBeUndefined();
    expect(useLibraryStore.getState().collections[0].emoji).toBe('🚗');
  });

  it('setCollectionTags normalises, caps and clears tags (v5.19.0)', () => {
    const s = useLibraryStore.getState();
    const id = s.createCollection('Tagged');
    useLibraryStore.getState().setCollectionTags(id, ' Chill, DRIVE ,, chill, #telugu ');
    expect(useLibraryStore.getState().collections[0].tags).toEqual(['chill', 'drive', 'telugu']);
    useLibraryStore.getState().setCollectionTags(id, Array.from({ length: 12 }, (_, i) => `t${i}`));
    expect(useLibraryStore.getState().collections[0].tags).toHaveLength(8);
    useLibraryStore.getState().setCollectionTags(id, []);
    expect(useLibraryStore.getState().collections[0].tags).toBeUndefined();
    expect('tags' in useLibraryStore.getState().collections[0]).toBe(false);
    // Unknown id is a no-op.
    useLibraryStore.getState().setCollectionTags('nope', ['x']);
    expect(useLibraryStore.getState().collections).toHaveLength(1);
  });

  it('prunes expired trash entries on rehydrate and keeps the rest', () => {
    const now = Date.now();
    const col = (id: string) => ({ id, name: id, createdAt: 0, songs: [] });
    window.localStorage.setItem(
      KEYS.library,
      JSON.stringify({
        state: {
          favorites: [],
          collections: [col('live')],
          saved: [],
          hiddenSongIds: [],
          later: [],
          hiddenArtists: [],
          trash: [
            { collection: col('fresh'), deletedAt: now - 1000 },
            { collection: col('stale'), deletedAt: now - TRASH_TTL_MS - 1000 },
          ],
        },
        version: 0,
      }),
    );
    void useLibraryStore.persist.rehydrate();
    const st = useLibraryStore.getState();
    expect(st.collections.map((c) => c.id)).toEqual(['live']);
    expect(st.trash.map((t) => t.collection.id)).toEqual(['fresh']);
  });
});
