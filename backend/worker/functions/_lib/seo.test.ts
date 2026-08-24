/**
 * Pins the SEO corpus contracts (4.15.0):
 *  - seoRow sanitizes ids (M-SRV-7 posture) and builds stable keys/slugs,
 *  - songRowsDeep harvests the song + its album + its artists,
 *  - parseResults accepts every upstream list shape,
 *  - dedupeRows collapses re-discoveries,
 *  - the sitemap page-name grammar (/sitemaps/<plural>-<n>.xml) stays fixed —
 *    the /sitemap.xml index and functions/sitemaps/[map].ts must agree.
 */
import { describe, expect, it } from 'vitest';
import { SEO_PAGE_SIZE, SEO_TYPES, dedupeRows, parseResults, safeId, seoRow, slugify, songRowsDeep } from './seo';

describe('seoRow', () => {
  it('builds key, slug and trimmed title', () => {
    const r = seoRow('song', 'AbC123', '  Naatu Naatu  ', 'Telugu');
    expect(r).toMatchObject({ key: 'song:AbC123', type: 'song', entity_id: 'AbC123', slug: 'naatu-naatu', title: 'Naatu Naatu', lang: 'telugu' });
  });
  it('rejects unusable ids/names and strips hostile id chars', () => {
    expect(seoRow('song', '', 'x')).toBeNull();
    expect(seoRow('song', 'id1', '')).toBeNull();
    expect(seoRow('song', '"><script>', 'x')).toStrictEqual(expect.objectContaining({ entity_id: 'script' }));
    expect(safeId('a"b<c>d')).toBe('abcd');
  });
  it('always carries lang (null when unknown) — PostgREST bulk inserts need identical keys on every row (PGRST102)', () => {
    expect(seoRow('artist', 'a1', 'Sid Sriram')?.lang).toBeNull();
    const keys = (r: object | null) => Object.keys(r ?? {}).sort();
    expect(keys(seoRow('artist', 'a1', 'Sid Sriram'))).toStrictEqual(keys(seoRow('song', 's1', 'Song', 'Telugu')));
  });
});

describe('songRowsDeep', () => {
  it('harvests song + album + primary artists', () => {
    const rows = songRowsDeep({
      id: 's1',
      name: 'Song',
      language: 'hindi',
      album: { id: 'al1', name: 'Album' },
      artists: { primary: [{ id: 'ar1', name: 'Artist One' }, { id: 'ar2', name: 'Artist Two' }] },
    });
    expect(rows.map((r) => r.key)).toStrictEqual(['song:s1', 'album:al1', 'artist:ar1', 'artist:ar2']);
  });
  it('survives missing album/artists', () => {
    expect(songRowsDeep({ id: 's2', title: 'T' }).map((r) => r.key)).toStrictEqual(['song:s2']);
  });
});

describe('parseResults', () => {
  it('accepts data.results / data.songs / data.albums / bare arrays', () => {
    expect(parseResults({ data: { results: [1] } })).toStrictEqual([1]);
    expect(parseResults({ data: { songs: [2] } })).toStrictEqual([2]);
    expect(parseResults({ data: { albums: [3] } })).toStrictEqual([3]);
    expect(parseResults({ data: [4] })).toStrictEqual([4]);
    expect(parseResults(null)).toStrictEqual([]);
  });
});

describe('dedupeRows', () => {
  it('drops nulls and repeated keys', () => {
    const a = seoRow('song', 's1', 'One');
    const b = seoRow('song', 's1', 'One again');
    expect(dedupeRows([a, null, b]).length).toBe(1);
  });
});

describe('sitemap page grammar', () => {
  it('page size stays under the 50k spec cap', () => {
    expect(SEO_PAGE_SIZE).toBeLessThanOrEqual(50000);
  });
  it('plural names map to entity types (index ↔ [map].ts contract)', () => {
    expect(SEO_TYPES).toStrictEqual({ songs: 'song', albums: 'album', artists: 'artist', playlists: 'playlist' });
    // The exact regex [map].ts uses — a rename on either side breaks this pin.
    const m = /^([a-z]+)-(\d{1,4})\.xml$/.exec('songs-12.xml');
    expect(m && SEO_TYPES[m[1]]).toBe('song');
  });
  it('slugify keeps urls xml-safe', () => {
    expect(slugify('Pushpa 2: The Rule (2024) — <Songs>')).toBe('pushpa-2-the-rule-2024-songs');
  });
  it('slugify strips catalog HTML entities (4.17.6 — the -quot- canonical bug)', () => {
    expect(slugify('Sorry Sorry (&quot;Bhojpuriya Raja&quot;)')).toBe('sorry-sorry-bhojpuriya-raja');
    expect(slugify('Raat &amp; Din')).toBe('raat-din');
    expect(slugify('Don&#39;t Stop')).toBe('don-t-stop');
  });
});
