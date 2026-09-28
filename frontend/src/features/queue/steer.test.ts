import { describe, expect, it } from 'vitest';
import { makeSong } from '@/__fixtures__/songs';
import { tuneForSong } from './steer';

/** 8.3.0 — "More like this" keeps a styled song's style before reading its mood. */
describe('tuneForSong', () => {
  it('keeps a DJ remix on DJ remixes', () => {
    expect(tuneForSong(makeSong('d', { title: 'Nadakallo Nadaka (DJ Remix Song Version 5)' }))).toBe('dj');
  });

  it('keeps a folk song on folk songs even when its title reads romantic', () => {
    const song = makeSong('f', { title: 'Prema Pilla', mood: 'romantic' });
    song.album = { id: 'al', name: 'Telugu Folk Songs Telangana Janapadalu Vol - 6' };
    expect(tuneForSong(song)).toBe('folk');
  });

  it('falls back to the mood for an ordinary song', () => {
    expect(tuneForSong(makeSong('r', { title: 'Film Song', mood: 'romantic' }))).toBe('romantic');
  });
});
