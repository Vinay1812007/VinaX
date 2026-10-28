/**
 * 13.6.0 — build-time song/album/artist pages (scripts/prerender-entities.mjs):
 * which entities are picked, and where their pages are written.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — a plain .mjs build script, no types
import { HUB_PATHS, STATIC_SITEMAPS, fileFor, hubFileFor, hubSongIds, pickEntities } from '../../scripts/prerender-entities.mjs';

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
