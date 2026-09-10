import { describe, expect, it } from 'vitest';
import { scoreAndSequence, primaryArtist, songKey } from './flow';
import type { Song } from '@/types';

function track(id: string, artist: string): Song {
  return {
    kind: 'song',
    id,
    title: `Track ${id}`,
    subtitle: artist,
    artists: [{ id: artist, name: artist }],
    album: null,
    images: [],
    audio: [],
    duration: 200,
    language: 'telugu',
    year: null,
    explicit: false,
    hasLyrics: false,
    playCount: null,
  };
}

describe('next-song sequencing in small catalogs', () => {
  it('alternates artists after relaxing the two-per-artist cap', () => {
    const songs = Array.from({ length: 8 }, (_, i) => track(String(i), i < 4 ? 'Alpha' : 'Beta'));
    const result = scoreAndSequence({ seed: songs, second: [], artist: [], fresh: [] }, 8);
    expect(result).toHaveLength(8);
    expect(new Set(result.map(songKey)).size).toBe(8);
    for (let i = 1; i < result.length; i++)
      expect(primaryArtist(result[i])).not.toBe(primaryArtist(result[i - 1]));
  });
  it('does not starve a queue with only one available artist', () => {
    const songs = Array.from({ length: 5 }, (_, i) => track(String(i), 'Alpha'));
    expect(scoreAndSequence({ seed: songs, second: songs, artist: [], fresh: [] }, 5)).toHaveLength(
      5,
    );
  });
});
