/**
 * Console rebuild — the owner can block a whole album from the console: its songs
 * and the album itself disappear from every list the app normalises.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { isBlockedAlbum, isBlockedSong, setBlocklistForTest } from '@/services/content/blocklist';
import { normalizeAlbum, normalizeSongList } from '@/services/api/normalize';

afterEach(() => setBlocklistForTest({ ids: [], albums: [], artists: [], keywords: [] }));

describe('album blocking', () => {
  it('hides songs from a blocked album and the album itself', () => {
    setBlocklistForTest({ albums: ['al1'] });
    expect(isBlockedAlbum('al1')).toBe(true);
    expect(isBlockedSong({ id: 's1', album: { id: 'al1' } })).toBe(true);
    expect(isBlockedSong({ id: 's2', album: { id: 'al2' } })).toBe(false);
    const songs = normalizeSongList([
      { id: 's1', name: 'One', album: { id: 'al1', name: 'Gone' } },
      { id: 's2', name: 'Two', album: { id: 'al2', name: 'Kept' } },
    ]);
    expect(songs.map((s) => s.id)).toEqual(['s2']);
    expect(normalizeAlbum({ id: 'al1', name: 'Gone' })).toBeNull();
    expect(normalizeAlbum({ id: 'al2', name: 'Kept' })?.id).toBe('al2');
  });

  it('blocks nothing by album when the list is empty', () => {
    expect(isBlockedAlbum('al1')).toBe(false);
    expect(isBlockedSong({ id: 's1', album: { id: 'al1' } })).toBe(false);
  });
});
