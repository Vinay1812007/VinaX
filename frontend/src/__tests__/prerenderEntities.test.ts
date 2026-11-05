/**
 * 13.6.0 — build-time song/album/artist pages (scripts/prerender-entities.mjs):
 * which entities are picked, and where their pages are written.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — a plain .mjs build script, no types
import { HUB_PATHS, STATIC_SITEMAPS, entityKey, songIdOf, fileFor, hubFileFor, hubSongIds, injectSection, linkedEntities, pickEntities, pruneEntityLinks, songSections } from '../../scripts/prerender-entities.mjs';

type Song = { id: string; name: string; language: string; playCount: number; album?: { id: string }; artists?: { primary: Array<{ id: string }> } };
const song = (id: string, name: string, plays: number, extra: Partial<Song> = {}): Song => ({
  id,
  name,
  language: 'telugu',
  playCount: plays,
  album: { id: `al${id}` },
  artists: { primary: [{ id: `ar${id}` }] },
  ...extra,
});

describe('pickEntities', () => {
  it('ranks by plays, keeps the language, drops year-only titles, tiny counts and duplicate works', async () => {
    const results = [
      song('a1', 'Mid', 500_000),
      song('a2', 'Big', 90_000_000),
      song('a3', '2026', 80_000_000), // a year, not a song name
      song('a4', 'Tiny', 900), // under the play floor
      song('a5', 'Other language', 70_000_000, { language: 'hindi' }),
      song('a6', 'Big (Remastered)', 1_000_000, { artists: { primary: [{ id: 'ara2' }] } }), // same work as a2
      song('a7', 'Mid', 400_000, { artists: { primary: [{ id: 'x9' }, { id: 'ara1' }] } }), // a1 again, singers reordered
      song('a8', 'Mid', 300_000, { artists: { primary: [{ id: 'z1' }] } }), // same title, different singer: a different song
    ];
    const get = async () => ({ data: { results } });
    const picked: Array<[string, string]> = await pickEntities(get, ['telugu'], 10);
    const songs = picked.filter(([t]) => t === 'song').map(([, id]) => id);
    expect(songs).toEqual(['a2', 'a1', 'a8']);
    expect(picked).toContainEqual(['album', 'ala2']);
    expect(picked).toContainEqual(['artist', 'ara2']);
    expect(picked).not.toContainEqual(['album', 'ala3']);
  });

  it('survives a dead mirror: nothing to build, no throw', async () => {
    expect(await pickEntities(async () => null, ['telugu'], 10)).toEqual([]);
  });
});

describe('fileFor', () => {
  it('writes a flat .html file, which the host serves at the canonical address with a 200', () => {
    expect(fileFor('/song/pal-pal-dil-ke-paas-fRI86se_')).toBe(join('dist', 'song/pal-pal-dil-ke-paas-fRI86se_.html'));
    expect(fileFor('/artist/anirudh-ravichander-455663')).toBe(join('dist', 'artist/anirudh-ravichander-455663.html'));
  });
  it('refuses anything that is not a song, album or artist page path', () => {
    expect(fileFor('/song/../../etc-x')).toBeNull();
    expect(fileFor('/library')).toBeNull();
    expect(fileFor('/song/Has Space-1')).toBeNull();
  });
});

describe('V2 1.0 — hubs and sitemaps are static files, not Worker requests', () => {
  it('builds all 72 mood × language hubs as flat files', () => {
    expect(HUB_PATHS).toHaveLength(72);
    expect(hubFileFor('/telugu-romantic-songs')).toBe(join('dist', 'telugu-romantic-songs.html'));
    expect(hubFileFor('/telugu-songs')).toBeNull();
    expect(hubFileFor('/../etc-romantic-songs')).toBeNull();
  });

  it('reads the songs a hub links to, so their pages are built first', () => {
    const html = '<ol><li><a href="/song/naa-ready-abc_12">Naa Ready</a></li><li><a href="/song/x-QQ9">X</a></li><li><a href="/song/naa-ready-abc_12">again</a></li></ol>';
    expect(hubSongIds(html)).toEqual(['abc_12', 'QQ9']);
  });

  it('writes the sitemap index and the maps it lists', () => {
    expect(STATIC_SITEMAPS.map(([f]: [string, string]) => f)).toEqual(['sitemap.xml', 'sitemap-static.xml', 'sitemap-hubs.xml']);
  });

  it('keeps the hubs and sitemaps off the Worker routes', () => {
    const toml = readFileSync(resolve(__dirname, '../../../backend/worker/wrangler.toml'), 'utf8');
    const patterns = [...toml.matchAll(/pattern = "([^"]+)"/g)].map((m) => m[1]);
    expect(patterns.some((p) => /-songs\*?$/.test(p))).toBe(false);
    expect(patterns.some((p) => p.includes('/sitemap'))).toBe(false);
    expect(patterns).toContain('www.vinaxmusic.online/api/*');
  });
});

describe('SEO 2026-11 — links lead only to built pages, and the chart pages list songs', () => {
  it('keys an entity path by type and id, whatever its slug', () => {
    expect(entityKey('/song/mahi-from-deewana-MRYcngMQ')).toBe('song:MRYcngMQ');
    expect(entityKey('/album/aashiqui-2-1139549')).toBe('album:1139549');
    expect(entityKey('/artist/x-1')).toBe('artist:1');
    expect(entityKey('/playlist/x-1')).toBeNull();
    expect(entityKey('/charts/')).toBeNull();
    // Song ids are 8 characters and may contain a dash.
    expect(entityKey('/song/teeje-week-H7SU6-O2')).toBe('song:H7SU6-O2');
    expect(songIdOf('x-123')).toBe('123');
    expect(hubSongIds('<a href="/song/teeje-week-H7SU6-O2">T</a>')).toEqual(['H7SU6-O2']);
    expect(fileFor('/song/teeje-week-H7SU6-O2')).toBe(join('dist', 'song/teeje-week-H7SU6-O2.html'));
  });

  it('counts the entity pages a page links to', () => {
    const html = '<a href="/album/a-1">A</a> <a href="/song/s-X2">S</a> <a href="/album/other-slug-1">A again</a> <a href="/charts/">Charts</a>';
    expect([...linkedEntities(html)]).toEqual([['album:1', 2], ['song:X2', 1]]);
  });

  it('unlinks pages that were not built and points the rest at the built path', () => {
    const built = new Map([['album:1', '/album/a-1'], ['song:X2', '/song/real-title-X2']]);
    const html = '<li><a href="/album/a-1">A</a></li><li><a href="/song/old-slug-X2">S</a></li><li><a href="/artist/nobody-9">Nobody</a></li><a href="/telugu-songs/">Telugu</a>';
    expect(pruneEntityLinks(html, built)).toBe('<li><a href="/album/a-1">A</a></li><li><a href="/song/real-title-X2">S</a></li><li>Nobody</li><a href="/telugu-songs/">Telugu</a>');
  });

  it('builds song lists for Charts, Top Songs, Trending and each language page', () => {
    const rows = [
      { path: '/song/a-1', lang: 'telugu', title: 'A & B', artist: 'Sid', year: 2026, plays: 9 },
      { path: '/song/b-2', lang: 'hindi', title: 'Old', artist: '', year: 2001, plays: 99 },
    ];
    const out = songSections(rows, 2026);
    expect(Object.keys(out).sort()).toEqual(['/charts', '/hindi-songs', '/telugu-songs', '/top-songs', '/trending']);
    expect(out['/charts']).toContain('<h2>Top Telugu songs</h2><ol><li><a href="/song/a-1">A &amp; B</a> — Sid</li></ol>');
    expect(out['/top-songs'].indexOf('/song/b-2')).toBeLessThan(out['/top-songs'].indexOf('/song/a-1'));
    expect(out['/trending']).toContain('/song/a-1');
    expect(out['/trending']).not.toContain('/song/b-2');
    expect(songSections([])).toEqual({});
  });

  it('puts a section just before the site nav, and leaves a page without one alone', () => {
    expect(injectSection('<main><h1>T</h1><nav aria-label="Browse VinaX">n</nav></main>', '<h2>S</h2>')).toBe('<main><h1>T</h1><h2>S</h2><nav aria-label="Browse VinaX">n</nav></main>');
    expect(injectSection('<main></main>', '<h2>S</h2>')).toBe('<main></main>');
  });
});
