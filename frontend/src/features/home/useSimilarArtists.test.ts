// @vitest-environment jsdom
/** 8.5.0 — Home's "Similar artists": new artists only, strongest matches first. */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/personalization/updater', () => ({ recordFavorite: () => undefined, recordDislike: () => undefined, recordPlaylistAdd: () => undefined }));

import { mergeSimilarArtists, similarSeed } from './useSimilarArtists';

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

describe('similarSeed — 1.3', () => {
  it('uses the catalogue\u2019s similar list when it has one (no artist payload fetched)', async () => {
    const artist = vi.fn();
    const seed = await similarSeed('s1', 'Seed One', { similar: async () => [ref('x', 'Pick')], artist });
    expect(seed).toEqual({ id: 's1', name: 'Seed One', similarArtists: [ref('x', 'Pick')] });
    expect(artist).not.toHaveBeenCalled();
  });

  it('falls back to the artist payload when the similar call fails or is empty', async () => {
    const payload = { id: 's1', name: 'Seed One', similarArtists: [ref('y', 'Old Way')] };
    const artist = vi.fn(async () => payload);
    expect(await similarSeed('s1', 'Seed One', { similar: async () => Promise.reject(new Error('down')), artist })).toBe(payload);
    expect(await similarSeed('s1', 'Seed One', { similar: async () => [], artist })).toBe(payload);
    expect(artist).toHaveBeenCalledTimes(2);
  });

  it('rejects only when both fail, so the shelf can hide', async () => {
    await expect(similarSeed('s1', 'S', { similar: async () => Promise.reject(new Error('a')), artist: async () => Promise.reject(new Error('b')) })).rejects.toThrow('b');
  });

  it('feeds mergeSimilarArtists like the payload did', async () => {
    const seeds = await Promise.all([
      similarSeed('s1', 'One', { similar: async () => [ref('x', 'Shared'), ref('y', 'Y')] }),
      similarSeed('s2', 'Two', { similar: async () => [], artist: async () => ({ id: 's2', name: 'Two', similarArtists: [ref('x', 'Shared')] }) }),
    ]);
    const out = mergeSimilarArtists(seeds, { knownKeys: new Set(), hiddenArtists: [] }, NOW);
    expect(out.map((a) => [a.id, a.votes])).toEqual([['x', 2], ['y', 1]]);
  });
});
