import { describe, expect, it } from 'vitest';
import type { Song } from '@/types';
import { pinFor, pinKey, withPinnedFirst, type SearchPins } from './pins';

const song = (id: string): Song => ({
  kind: 'song', id, title: `Song ${id}`, subtitle: '', artists: [], album: null, images: [], audio: [],
  duration: null, language: null, year: null, explicit: false, hasLyrics: false, playCount: null,
});

describe('search pins', () => {
  const pins: SearchPins = { 'kesariya remix': { id: 'abc', title: 'Kesariya' } };

  it('matches the exact words only, in any case and spacing', () => {
    expect(pinKey('  Kesariya   REMIX ')).toBe('kesariya remix');
    expect(pinFor(pins, 'Kesariya  Remix')?.id).toBe('abc');
    expect(pinFor(pins, 'kesariya')).toBeNull();
    expect(pinFor(pins, 'kesariya remix 2')).toBeNull();
    expect(pinFor(null, 'kesariya remix')).toBeNull();
  });

  it('never answers through the object prototype or for a pin without an id', () => {
    for (const q of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) expect(pinFor(pins, q)).toBeNull();
    expect(pinFor({ broken: { title: 'x' } as unknown as SearchPins[string] }, 'broken')).toBeNull();
  });

  it('puts the pinned song first without showing it twice', () => {
    const list = [song('a'), song('b'), song('c')];
    expect(withPinnedFirst(list, null)).toBe(list);
    expect(withPinnedFirst(list, song('a'))).toBe(list);
    expect(withPinnedFirst(list, song('c')).map((s) => s.id)).toEqual(['c', 'a', 'b']);
    expect(withPinnedFirst(list, song('z')).map((s) => s.id)).toEqual(['z', 'a', 'b', 'c']);
    // The copy already in the results is the one that moves up.
    expect(withPinnedFirst(list, { ...song('b'), title: 'fetched' })[0]).toBe(list[1]);
  });
});
