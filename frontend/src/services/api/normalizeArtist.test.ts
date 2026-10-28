import { describe, expect, it } from 'vitest';
import { normalizeArtist } from './normalize';

/** 8.2.0 — the artist page's "similar artists" feed the next-song engine's related-artist source. */
describe('normalizeArtist similar artists', () => {
  it('reads either dialect, skips entries without an id or name, and decodes names', () => {
    const artist = normalizeArtist({
      id: 'a1',
      name: 'Lead',
      similarArtists: [
        { id: 's1', name: 'One &amp; Two', image_url: 'https://img/s1.jpg' },
        { artistId: 's2', title: 'Second', image: 'https://img/s2.jpg' },
        { id: '', name: 'No id' },
        { id: 's3' },
        null,
      ],
    });
    expect(artist?.similarArtists).toEqual([
      { id: 's1', name: 'One & Two', image: 'https://img/s1.jpg' },
      { id: 's2', name: 'Second', image: 'https://img/s2.jpg' },
    ]);
  });

  it('is an empty list when the page carries none', () => {
    expect(normalizeArtist({ id: 'a1', name: 'Lead' })?.similarArtists).toEqual([]);
  });
});
