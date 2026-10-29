/** 1.3 — the artist page's related artists: catalogue list, then payload, then co-credits. */
import { describe, expect, it } from 'vitest';
import { pickRelatedArtists } from './useSimilar';

const ref = (id: string, name = id, image: string | null = null) => ({ id, name, image });

describe('pickRelatedArtists', () => {
  it('prefers the catalogue’s similar artists', () => {
    expect(pickRelatedArtists('me', [[ref('a', 'A', 'a.jpg')], [ref('b')], [ref('c')]]).map((a) => a.id)).toEqual(['a']);
  });

  it('falls back to the payload, then to the artists credited on their songs', () => {
    expect(pickRelatedArtists('me', [undefined, [ref('b')], [ref('c')]]).map((a) => a.id)).toEqual(['b']);
    expect(pickRelatedArtists('me', [null, [], [ref('c')]]).map((a) => a.id)).toEqual(['c']);
    expect(pickRelatedArtists('me', [undefined, undefined, []])).toEqual([]);
  });

  it('drops the artist themself, id-less entries and repeats, and caps the list', () => {
    expect(pickRelatedArtists('me', [[ref('me'), ref('', 'No Id'), ref('x'), ref('x')]]).map((a) => a.id)).toEqual(['x']);
    // A list with only the artist themself counts as empty.
    expect(pickRelatedArtists('me', [[ref('me')], [ref('y')]]).map((a) => a.id)).toEqual(['y']);
    const many = Array.from({ length: 20 }, (_, i) => ref(`a${i}`));
    expect(pickRelatedArtists('me', [many])).toHaveLength(12);
  });
});
