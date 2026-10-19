/** 13.7 — search lists drop re-uploads of the same recording (one song under
 *  many catalogue ids) but keep remixes and other cuts, without moving rows. */
import { describe, expect, it } from 'vitest';
import type { Song } from '@/types';
import { flattenSongPages } from './useInfiniteSongs';

const song = (id: string, title: string, artist = 'Arijit Singh'): Song =>
  ({ id, title, artists: [{ id: 'a', name: artist }], subtitle: artist, images: [], language: 'hindi' }) as unknown as Song;

describe('flattenSongPages', () => {
  it('without the option, only exact id repeats go (other callers unchanged)', () => {
    const out = flattenSongPages([[song('1', 'Apna Bana Le'), song('2', 'Apna Bana Le')], [song('1', 'Apna Bana Le')]]);
    expect(out.map((s) => s.id)).toEqual(['1', '2']);
  });

  it('sameRecording keeps the first copy of a recording, and every other cut', () => {
    const out = flattenSongPages(
      [
        [song('1', 'Apna Bana Le'), song('2', 'Kesariya'), song('3', 'Apna Bana Le (From "Bhediya")')],
        [song('4', 'apna bana le'), song('5', 'Apna Bana Le - Lofi'), song('6', 'Apna Bana Le', 'Someone Else')],
      ],
      { sameRecording: true },
    );
    expect(out.map((s) => s.id)).toEqual(['1', '2', '5', '6']);
  });
});
