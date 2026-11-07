import { describe, expect, it } from 'vitest';
import type { Song } from '@/types';
import { normalizeArtist } from '@/services/api/normalize';
import { compactCount, sortArtistSongs } from './sortSongs';

const song = (id: string, title: string, year: string | null) => ({ id, title, year }) as unknown as Song;
const list = [song('1', 'Kesariya', '2022'), song('2', 'apna bana le', '2023'), song('3', 'Tum Hi Ho', '2013'), song('4', 'Zaalima', null)];

describe('sortArtistSongs', () => {
  it('keeps the catalogue order for popular', () => {
    expect(sortArtistSongs(list, 'popular').map((s) => s.id)).toEqual(['1', '2', '3', '4']);
  });
  it('puts the newest first and undated last', () => {
    expect(sortArtistSongs(list, 'newest').map((s) => s.id)).toEqual(['2', '1', '3', '4']);
  });
  it('sorts A–Z ignoring case', () => {
    expect(sortArtistSongs(list, 'az').map((s) => s.id)).toEqual(['2', '1', '3', '4']);
  });
  it('does not change the input', () => {
    sortArtistSongs(list, 'az');
    expect(list[0].id).toBe('1');
  });
});

describe('artist counts', () => {
  it('formats compactly', () => {
    expect(compactCount(9_512_264)).toBe('9.5M');
    expect(compactCount(109_192_194)).toBe('109.2M');
  });
  it('reads both catalogue dialects', () => {
    const wrapper = normalizeArtist({ id: '1', name: 'A', fanCount: '9512264', followerCount: 109192194, isVerified: true });
    expect(wrapper).toMatchObject({ listeners: 9512264, followers: 109192194, verified: true });
    const raw = normalizeArtist({ artistId: '2', name: 'B', fan_count: '1,200', follower_count: '0', isVerified: false });
    expect(raw).toMatchObject({ listeners: 1200, followers: null, verified: false });
  });
});
