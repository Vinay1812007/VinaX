import { describe, expect, it } from 'vitest';
import { makeSong } from '@/__fixtures__/songs';
import type { LocalCollection, SavedEntity } from '@/store/libraryStore';
import { yourPlaylists } from './YourPlaylists';

const col = (id: string, createdAt: number, songs = 0, pinned = false): LocalCollection => ({
  id,
  name: `Mine ${id}`,
  createdAt,
  pinned,
  songs: Array.from({ length: songs }, (_, i) => makeSong(`${id}-${i}`, { images: [{ quality: '500x500', url: `https://img/${id}-${i}.jpg` }] })),
});
const saved = (id: string, kind: SavedEntity['kind'], savedAt: number): SavedEntity => ({ id, kind, title: `Saved ${id}`, subtitle: '', image: null, savedAt });

describe('yourPlaylists', () => {
  it('lists own playlists (pinned first, then newest) before saved playlists (newest first); albums and artists stay out', () => {
    const cards = yourPlaylists(
      [col('old', 1, 2), col('new', 5, 1), col('pin', 0, 3, true)],
      [saved('p1', 'playlist', 10), saved('a1', 'album', 20), saved('p2', 'playlist', 30), saved('ar', 'artist', 40)],
    );
    expect(cards.map((c) => c.key)).toEqual(['c:pin', 'c:new', 'c:old', 'p:p2', 'p:p1']);
    expect(cards[0]).toMatchObject({ to: '/collection/pin', subtitle: '3 songs' });
    expect(cards[1].subtitle).toBe('1 song');
    expect(cards[3]).toMatchObject({ to: '/playlist/p2', subtitle: 'Playlist', songs: null });
    expect(cards[3].image).toMatch(/^data:image\/svg/);
  });

  it('an empty playlist of their own still shows, without a play button; nothing at all means no shelf', () => {
    const [empty] = yourPlaylists([col('e', 1, 0)], []);
    expect(empty.songs).toBeNull();
    expect(empty.subtitle).toBe('0 songs');
    expect(yourPlaylists([], [saved('a', 'album', 1)])).toEqual([]);
  });

  it('caps the shelf', () => {
    const many = Array.from({ length: 30 }, (_, i) => col(String(i), i, 1));
    expect(yourPlaylists(many, [], 16)).toHaveLength(16);
  });
});
