// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Song } from '@/types';
import { KEYS } from '@/constants/storage-keys';
import { TRASH_TTL_MS } from '@/features/library/trash';

vi.mock('@/services/personalization/updater', () => ({ recordFavorite: () => undefined, recordDislike: vi.fn(), recordPlaylistAdd: vi.fn() }));
vi.mock('@/services/analytics/telemetry', () => ({ trackDislike: vi.fn(), trackPlaylistAdd: vi.fn(), trackFavorite: vi.fn() }));

import { orderCollections, useLibraryStore } from './libraryStore';
import { recordDislike, recordPlaylistAdd } from '@/services/personalization/updater';

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

describe('7.2.0 — hiding an artist works in every script', () => {
  it('keys Indic-script names instead of reducing them to nothing, and keeps Latin keys unchanged', async () => {
    const { artistKey, isSongBlocked } = await import('./libraryStore');
    expect(artistKey('José González')).toBe('jose gonzalez');
    expect(artistKey('Sid Sriram')).toBe('sid sriram');
    expect(artistKey('సిద్ శ్రీరామ్')).not.toBe('');
    expect(artistKey('अरिजीत सिंह')).not.toBe('');
    const song = { id: 's', title: 't', subtitle: 'సిద్ శ్రీరామ్', artists: [{ id: 'a', name: 'సిద్ శ్రీరామ్' }] } as unknown as Parameters<typeof isSongBlocked>[0];
    expect(isSongBlocked(song, { hiddenSongIds: [], hiddenArtists: [artistKey('సిద్ శ్రీరామ్')] })).toBe(true);
    expect(isSongBlocked(song, { hiddenSongIds: [], hiddenArtists: [artistKey('అనిరుధ్')] })).toBe(false);
  });
});

describe('libraryStore 8.5.0 — taste signals', () => {
  beforeEach(() => {
    window.localStorage.clear();
    reset();
    vi.mocked(recordDislike).mockClear();
    vi.mocked(recordPlaylistAdd).mockClear();
  });

  it('hiding a song with the song in hand records a dislike, and the undo records the un-dislike', () => {
    const s = song('h1', 'Hidden');
    useLibraryStore.getState().toggleHidden('h1', s);
    expect(useLibraryStore.getState().isHidden('h1')).toBe(true);
    expect(recordDislike).toHaveBeenLastCalledWith(s, true);
    useLibraryStore.getState().toggleHidden('h1', s);
    expect(useLibraryStore.getState().isHidden('h1')).toBe(false);
    expect(recordDislike).toHaveBeenLastCalledWith(s, false);
  });

  it('an id-only hide (older callers) still hides, without guessing at a taste signal', () => {
    useLibraryStore.getState().toggleHidden('h2');
    expect(useLibraryStore.getState().isHidden('h2')).toBe(true);
    expect(recordDislike).not.toHaveBeenCalled();
  });

  it('a song filed into a playlist counts once; a duplicate add and a bulk import do not count', () => {
    const s = useLibraryStore.getState();
    const id = s.createCollection('Mine');
    s.addToCollection(id, song('p1', 'A'));
    s.addToCollection(id, song('p1', 'A'));
    expect(recordPlaylistAdd).toHaveBeenCalledTimes(1);
    s.addManyToCollection(id, [song('p2', 'B'), song('p3', 'C')]);
    expect(recordPlaylistAdd).toHaveBeenCalledTimes(1);
    s.addToCollection('missing', song('p4', 'D'));
    expect(recordPlaylistAdd).toHaveBeenCalledTimes(1);
  });
});
