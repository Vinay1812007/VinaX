// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';
import { filterSongs, songMatchesQuery } from './collectionEdit';

vi.mock('@/services/personalization/updater', () => ({ recordFavorite: () => undefined }));
import { useLibraryStore } from '@/store/libraryStore';

const song = (id: string, title: string, artist = 'Artist', extra: Partial<Song> = {}): Song => ({
  kind: 'song', id, title, subtitle: artist, artists: [{ id: `a-${artist}`, name: artist }], album: null, images: [], audio: [],
  duration: 200, language: 'telugu', year: '2024', explicit: false, hasLyrics: false, playCount: null, ...extra,
});

describe('in-collection search', () => {
  const list = [song('1', 'Samajavaragamana', 'Sid Sriram', { album: { id: 'al', name: 'Ala Vaikunthapurramuloo' } }), song('2', 'నీవే నీవే', 'Sid Sriram'), song('3', 'Kesariya', 'Arijit Singh')];
  it('matches words across title, artist and album, script-safe', () => {
    expect(filterSongs(list, 'sid').map((s) => s.id)).toEqual(['1', '2']);
    expect(filterSongs(list, 'vaikuntha sid').map((s) => s.id)).toEqual(['1']);
    expect(filterSongs(list, 'నీవే').map((s) => s.id)).toEqual(['2']);
    expect(filterSongs(list, 'KESARIYA').map((s) => s.id)).toEqual(['3']);
    expect(filterSongs(list, '')).toBe(list);
    expect(songMatchesQuery(list[0], 'nothing here')).toBe(false);
  });
});

describe('collection batch edits', () => {
  const a = song('a', 'A'), b = song('b', 'B'), c = song('c', 'C'), d = song('d', 'D');
  beforeEach(() => {
    useLibraryStore.setState({
      favorites: [], saved: [], hiddenSongIds: [], later: [], hiddenArtists: [], trash: [],
      collections: [
        { id: 'src', name: 'Source', createdAt: 1, songs: [a, b, c, d] },
        { id: 'dst', name: 'Target', createdAt: 2, songs: [c] },
      ],
    });
  });
  const songsOf = (id: string) => useLibraryStore.getState().collections.find((x) => x.id === id)!.songs.map((s) => s.id);

  it('copy skips songs the target already has and reports the count', () => {
    const added = useLibraryStore.getState().addManyToCollection('dst', [a, c, d]);
    expect(added).toBe(2);
    expect(songsOf('dst')).toEqual(['c', 'a', 'd']);
    expect(songsOf('src')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('remove returns positions and restore puts them back in order (undo)', () => {
    const removed = useLibraryStore.getState().removeManyFromCollection('src', ['b', 'd']);
    expect(removed).toEqual([{ song: b, index: 1 }, { song: d, index: 3 }]);
    expect(songsOf('src')).toEqual(['a', 'c']);
    useLibraryStore.getState().restoreToCollection('src', removed);
    expect(songsOf('src')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('move = copy then remove, and undo reverses both', () => {
    const s = useLibraryStore.getState();
    s.addManyToCollection('dst', [a, b]);
    const removed = s.removeManyFromCollection('src', ['a', 'b']);
    expect(songsOf('src')).toEqual(['c', 'd']);
    expect(songsOf('dst')).toEqual(['c', 'a', 'b']);
    // undo
    useLibraryStore.getState().restoreToCollection('src', removed);
    useLibraryStore.getState().removeManyFromCollection('dst', ['a', 'b']);
    expect(songsOf('src')).toEqual(['a', 'b', 'c', 'd']);
    expect(songsOf('dst')).toEqual(['c']);
  });

  it('restore never duplicates a song that is already back', () => {
    const removed = useLibraryStore.getState().removeManyFromCollection('src', ['a']);
    useLibraryStore.getState().addToCollection('src', a);
    useLibraryStore.getState().restoreToCollection('src', removed);
    expect(songsOf('src').filter((x) => x === 'a')).toHaveLength(1);
  });
});
