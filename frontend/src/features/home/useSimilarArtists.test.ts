// @vitest-environment jsdom
/** 8.5.0 — Home's "Similar artists": new artists only, strongest matches first. */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/personalization/updater', () => ({ recordFavorite: () => undefined, recordDislike: () => undefined, recordPlaylistAdd: () => undefined }));

import { mergeSimilarArtists } from './useSimilarArtists';

const ref = (id: string, name: string) => ({ id, name, image: null });
const NOW = 1_000_000;

describe('mergeSimilarArtists', () => {
  const seeds = [
    { id: 's1', name: 'Seed One', similarArtists: [ref('x', 'Shared Pick'), ref('y', 'Only One'), ref('k', 'Known Already')] },
    { id: 's2', name: 'Seed Two', similarArtists: [ref('z', 'Only Two'), ref('x', 'Shared Pick'), ref('h', 'Hidden Singer')] },
    { id: 's3', name: 'Seed Three', similarArtists: [ref('m', 'Muted Voice'), ref('', 'No Id'), ref('s1', 'Seed One')] },
  ];
  const exclude = {
    knownKeys: new Set(['known already', 'seed one', 's1']),
    hiddenArtists: ['hidden singer'],
    softMuted: { m: { until: NOW + 1 } },
  };

  it('ranks artists named by more of your artists first, then keeps catalogue order', () => {
    const out = mergeSimilarArtists(seeds, exclude, NOW);
    expect(out.map((a) => a.id)).toEqual(['x', 'y', 'z']);
    expect(out[0]).toMatchObject({ votes: 2, because: 'Seed One' });
    expect(out[2]).toMatchObject({ votes: 1, because: 'Seed Two' });
  });

  it('leaves out artists you already play, block, have muted for now, or that have no artist page', () => {
    const ids = mergeSimilarArtists(seeds, exclude, NOW).map((a) => a.id);
    for (const gone of ['k', 'h', 'm', '', 's1']) expect(ids).not.toContain(gone);
  });

  it('an expired "Less like this" no longer hides the artist', () => {
    const ids = mergeSimilarArtists(seeds, { ...exclude, softMuted: { m: { until: NOW - 1 } } }, NOW).map((a) => a.id);
    expect(ids).toContain('m');
  });

  it('caps the shelf', () => {
    const many = [{ id: 's', name: 'S', similarArtists: Array.from({ length: 30 }, (_, i) => ref(`a${i}`, `Artist ${i}`)) }];
    expect(mergeSimilarArtists(many, { knownKeys: new Set(), hiddenArtists: [] }, NOW)).toHaveLength(12);
  });
});
