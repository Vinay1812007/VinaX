import { describe, expect, it } from 'vitest';
import type { Playlist } from '@/types';
import { cityPlaylists } from './CatalogueRows';

const pl = (title: string): Playlist => ({ kind: 'playlist', id: title, title, subtitle: '', images: [], songs: [] }) as unknown as Playlist;

describe('cityPlaylists', () => {
  it("keeps only the city's own hot/top/trending playlists", () => {
    const list = [pl("What's Hot In Hyderabad"), pl('Hyderabad Top 50'), pl('Hyderabadi Biryani Beats'), pl("What's Hot In Chennai"), pl('Trending Today')];
    expect(cityPlaylists(list, 'Hyderabad').map((p) => p.title)).toEqual(["What's Hot In Hyderabad", 'Hyderabad Top 50']);
  });

  it('is empty for an unknown or blank city', () => {
    expect(cityPlaylists([pl("What's Hot In Hyderabad")], '  ')).toEqual([]);
    expect(cityPlaylists([pl("What's Hot In Hyderabad")], 'Pune')).toEqual([]);
  });
});
