import { describe, expect, it } from 'vitest';
import type { Album, Artist, Song } from '@/types';
import { indexOfKey, itemKey, stepSelection, typeaheadItems, type TypeaheadItem } from './SearchTypeahead';

const song = (id: string, title: string) => ({ id, title, subtitle: 'x' }) as unknown as Song;
const artist = (id: string) => ({ id, name: id }) as unknown as Artist;
const album = (id: string) => ({ id, name: id }) as unknown as Album;
const q = (text: string) => ({ text, source: 'recent' as const });

describe('typeahead highlight follows the row, not the position (11.0.1)', () => {
  it('every kind of row has a stable key; queries are compared case-insensitively', () => {
    const items: TypeaheadItem[] = [
      { kind: 'query', text: ' Kesariya Lofi ', source: 'recent' },
      { kind: 'song', song: song('s1', 'Kesariya'), index: 0 },
      { kind: 'artist', artist: artist('ar1') },
      { kind: 'album', album: album('al1') },
    ];
    expect(items.map(itemKey)).toEqual(['q:kesariya lofi', 's:s1', 'ar:ar1', 'al:al1']);
    expect(indexOfKey(items, null)).toBe(-1);
    expect(indexOfKey(items, 's:s1')).toBe(1);
    expect(indexOfKey(items, 's:gone')).toBe(-1);
  });

  it('a late completion that lands above the highlighted song moves the highlight with the song', () => {
    const songs = [song('s0', 'Kesariya'), song('s4', 'Kesaria Balam')];
    const before = typeaheadItems([q('kesariya lofi')], { songs, artists: [], albums: [] });
    // The listener walks down to the second song…
    let sel = -1;
    for (let i = 0; i < 3; i += 1) sel = stepSelection(sel, 1, before.length);
    const key = itemKey(before[sel]);
    expect(key).toBe('s:s4');
    // …then more completions arrive and push every row down by two.
    const after = typeaheadItems([q('kesariya lofi'), q('kesaria balam'), q('kesariya reprise')], { songs, artists: [], albums: [] });
    // By position the old index would now be a text completion — the 10.x bug.
    expect(after[sel].kind).toBe('query');
    // By identity it is still the same song.
    const now = indexOfKey(after, key);
    expect(after[now]).toMatchObject({ kind: 'song', song: { id: 's4' } });
  });

  it('a highlighted row that leaves the list loses the highlight instead of passing it on', () => {
    const before = typeaheadItems([], { songs: [song('s1', 'A'), song('s2', 'B')], artists: [], albums: [] });
    const after = typeaheadItems([], { songs: [song('s3', 'C'), song('s1', 'A')], artists: [], albums: [] });
    expect(indexOfKey(after, itemKey(before[1]))).toBe(-1);
    expect(indexOfKey(after, itemKey(before[0]))).toBe(1);
  });
});
