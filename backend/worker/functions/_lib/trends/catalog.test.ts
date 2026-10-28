/**
 * The matcher reads both catalogue dialects: JioSaavn's raw more_info and
 * the wrapper shape CATALOG_UPSTREAMS answers in (artists.primary, …).
 */
import { describe, expect, it } from 'vitest';
import { toCandidate } from './catalog';

describe('toCandidate', () => {
  it('reads the wrapper dialect', () => {
    const c = toCandidate({
      id: 'rjkrTnma',
      name: 'Kesariya',
      year: '2022',
      duration: 268,
      language: 'hindi',
      album: { id: '38845390', name: 'Brahmastra' },
      artists: {
        primary: [{ id: '456323', name: 'Pritam' }, { id: '459320', name: 'Arijit Singh' }],
        featured: [],
        all: [{ id: '1', name: 'Amitabh Bhattacharya' }],
      },
    });
    expect(c).toEqual({
      id: 'rjkrTnma',
      title: 'Kesariya',
      primaryArtists: ['Pritam', 'Arijit Singh'],
      featuredArtists: [],
      credits: ['Amitabh Bhattacharya'],
      album: 'Brahmastra',
      language: 'hindi',
      year: 2022,
      durationSec: 268,
    });
  });

  it('still reads the raw JioSaavn dialect', () => {
    const c = toCandidate({ id: 'x1', title: 'T', more_info: { artistMap: { primary_artists: [{ name: 'A' }] }, duration: '200' } });
    expect(c?.primaryArtists).toEqual(['A']);
    expect(c?.durationSec).toBe(200);
  });
});
