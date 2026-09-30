/**
 * 8.5.0 — catalogue-only recommendations: /api/recommendations and
 * /api/recommendations/similar/:songId. Every track must be a song the
 * catalogue served; nothing about the caller is read.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogCandidate } from '../_lib/trends/matcher';

const songs = new Map<string, CatalogCandidate>();
const suggestions = new Map<string, CatalogCandidate[]>();
const searches = new Map<string, CatalogCandidate[]>();
let down = false;

vi.mock('../_lib/trends/catalog', async () => {
  class CatalogUnavailable extends Error {}
  const guard = () => {
    if (down) throw new CatalogUnavailable('down');
  };
  return {
    CatalogUnavailable,
    lookupCatalogSong: async (id: string) => (guard(), songs.get(id) ?? null),
    catalogSongSuggestions: async (id: string) => (guard(), suggestions.get(id) ?? []),
    searchCatalogSongs: async (q: string) => (guard(), searches.get(q) ?? []),
  };
});

import { interleave, parseIds, parseLanguages, parseLimit, selectTracks, type RecTrack } from '../_lib/recs';
import { onRequestGet as recsGet } from './recommendations';
import { onRequestGet as similarGet } from './recommendations/similar/[songId]';
import worker from '../../index';

const song = (id: string, title: string, artist: string, language = 'telugu', extra: Partial<CatalogCandidate> = {}): CatalogCandidate => ({
  id, title, primaryArtists: [artist], featuredArtists: [], credits: [artist], album: `${title} album`, language, year: 2020, durationSec: 200, ...extra,
});

const SEED = song('seed01', 'Evening Song', 'Lead Singer');

beforeEach(() => {
  songs.clear();
  suggestions.clear();
  searches.clear();
  down = false;
  songs.set(SEED.id, SEED);
});

// Each test gets its own client address so the per-isolate buckets never interfere.
let ip = 0;
const req = (url: string) => new Request(`https://vinax.test${url}`, { headers: { 'cf-connecting-ip': `10.0.0.${++ip % 250}` } });
const similar = (id: string, query = '') => similarGet({ request: req(`/api/recommendations/similar/${id}${query}`), env: {}, params: { songId: id } });

describe('selectTracks', () => {
  it('drops the seed, its alternate releases, duplicates, malformed ids and caps each artist', () => {
    const pool = [
      song('seed01', 'Evening Song', 'Lead Singer'),
      song('rmx001', 'Evening Song (Remix)', 'DJ Someone'),
      song('a00001', 'One', 'Artist A'),
      song('a00002', 'Two', 'Artist A'),
      song('a00003', 'Three', 'Artist A'),
      song('dup001', 'One', 'Artist A'),
      song('bad id!', 'Bad', 'Artist B'),
      song('b00001', 'Four', 'Artist B'),
    ];
    const out = selectTracks({ id: 'seed01', title: 'Evening Song', artist: 'Lead Singer', language: 'telugu' }, [{ reason: 'similar', songs: pool }], { limit: 10, artistCap: 2 });
    expect(out.map((t) => t.id)).toEqual(['a00001', 'a00002', 'b00001']);
    expect(out[0]).toMatchObject({ reason: 'similar', reasonText: 'Similar to “Evening Song”', seedId: 'seed01', artist: 'Artist A' });
  });

  it('filters languages and honours the limit', () => {
    const pool = [song('h00001', 'Hindi One', 'H', 'hindi'), song('t00001', 'Telugu One', 'T1'), song('t00002', 'Telugu Two', 'T2'), song('n00001', 'No Lang', 'N', '')];
    const seed = { id: 'seed01', title: 'Evening Song', artist: 'Lead Singer', language: 'telugu' };
    expect(selectTracks(seed, [{ reason: 'similar', songs: pool }], { limit: 10, languages: ['telugu'] }).map((t) => t.id)).toEqual(['t00001', 't00002']);
    expect(selectTracks(seed, [{ reason: 'similar', songs: pool }], { limit: 1 })).toHaveLength(1);
  });

  it('interleaves several seeds so one seed never fills the list', () => {
    const t = (id: string, seedId: string) => ({ id, seedId }) as RecTrack;
    const out = interleave([[t('a1', 'A'), t('a2', 'A'), t('a3', 'A')], [t('b1', 'B'), t('a1', 'B')]], 10);
    expect(out.map((x) => x.id)).toEqual(['a1', 'b1', 'a2', 'a3']);
  });

  it('parses query parameters strictly', () => {
    expect(parseLimit(null)).toBe(20);
    expect(parseLimit('30')).toBe(30);
    for (const bad of ['0', '31', '-1', '2.5', 'abc']) expect(parseLimit(bad), bad).toBeNull();
    expect(parseLanguages('Telugu, hindi,telugu')).toEqual(['telugu', 'hindi']);
    expect(parseLanguages('te1ugu')).toBeNull();
    expect(parseIds('a1,b2,a1', 5)).toEqual(['a1', 'b2']);
    expect(parseIds('a1,b2,c3', 2)).toBeNull();
    expect(parseIds('ok,no way', 5)).toBeNull();
  });
});

describe('GET /api/recommendations/similar/:songId', () => {
  it('returns catalogue suggestions first, then songs the catalogue credits to the seed artist', async () => {
    suggestions.set('seed01', [song('s00001', 'Night Drive', 'Artist A'), song('s00002', 'Moonlight', 'Artist B')]);
    searches.set('Lead Singer', [
      song('l00001', 'Morning Song', 'Lead Singer'),
      // A text match that is NOT credited to the artist must not appear as "More by".
      song('x00001', 'Lead Singer Tribute', 'Cover Band'),
    ]);
    const res = await similar('seed01');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('public');
    const body = (await res.json()) as { seed: { id: string }; tracks: RecTrack[]; source: string };
    expect(body.seed).toEqual({ id: 'seed01', title: 'Evening Song', artist: 'Lead Singer', language: 'telugu' });
    expect(body.source).toBe('catalogue');
    expect(body.tracks.map((t) => [t.id, t.reason])).toEqual([['s00001', 'similar'], ['s00002', 'similar'], ['l00001', 'same_artist']]);
    expect(body.tracks[2].reasonText).toBe('More by Lead Singer');
  });

  it('never returns an id the catalogue did not serve', async () => {
    const served = [song('s00001', 'A', 'X'), song('s00002', 'B', 'Y')];
    suggestions.set('seed01', served);
    const body = (await (await similar('seed01')).json()) as { tracks: RecTrack[] };
    const known = new Set(served.map((s) => s.id));
    for (const t of body.tracks) expect(known.has(t.id)).toBe(true);
  });

  it('answers 400 for a malformed id or bad query, 404 for an unknown song, 502 when the catalogue is down', async () => {
    expect((await similar('bad id!')).status).toBe(400);
    expect((await similar('seed01', '?limit=99')).status).toBe(400);
    expect((await similar('seed01', '?languages=1')).status).toBe(400);
    const missing = await similar('nope01');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'song_not_found' });
    down = true;
    const failed = await similar('seed01');
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ error: 'catalogue_unavailable' });
  });

  it('is reachable through the worker router', async () => {
    suggestions.set('seed01', [song('s00001', 'A', 'X')]);
    const res = await worker.fetch(req('/api/recommendations/similar/seed01?limit=5'), {}, { waitUntil: () => undefined });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { tracks: RecTrack[] }).tracks[0].id).toBe('s00001');
    const post = await worker.fetch(new Request('https://vinax.test/api/recommendations/similar/seed01', { method: 'POST' }), {}, { waitUntil: () => undefined });
    expect(post.status).toBe(405);
  });
});

describe('GET /api/recommendations', () => {
  const get = (query: string) => recsGet({ request: req(`/api/recommendations${query}`), env: {} });

  it('mixes several seeds in turn, never returns a seed or an excluded id, and is not publicly cached', async () => {
    const second = song('seed02', 'Rain Song', 'Other Singer', 'hindi');
    songs.set(second.id, second);
    suggestions.set('seed01', [song('seed02', 'Rain Song', 'Other Singer'), song('a00001', 'A1', 'Artist A'), song('a00002', 'A2', 'Artist C'), song('gone01', 'Gone', 'Artist D')]);
    suggestions.set('seed02', [song('b00001', 'B1', 'Artist B', 'hindi'), song('a00001', 'A1', 'Artist A')]);
    const res = await get('?seeds=seed01,seed02&exclude=gone01');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('private');
    const body = (await res.json()) as { seeds: Array<{ id: string }>; tracks: RecTrack[] };
    expect(body.seeds.map((s) => s.id)).toEqual(['seed01', 'seed02']);
    expect(body.tracks.map((t) => t.id)).toEqual(['a00001', 'b00001', 'a00002']);
  });

  it('skips unknown seeds, 404s when none exist, and rejects bad input', async () => {
    suggestions.set('seed01', [song('a00001', 'A1', 'Artist A')]);
    expect((await get('?seeds=seed01,nope01')).status).toBe(200);
    expect((await get('?seeds=nope01')).status).toBe(404);
    expect((await get('')).status).toBe(400);
    expect((await get('?seeds=a1,b2,c3,d4,e5,f6')).status).toBe(400);
    expect((await get('?seeds=seed01&limit=0')).status).toBe(400);
  });

  it('is reachable through the worker router', async () => {
    suggestions.set('seed01', [song('a00001', 'A1', 'Artist A')]);
    const res = await worker.fetch(req('/api/recommendations?seeds=seed01'), {}, { waitUntil: () => undefined });
    expect(res.status).toBe(200);
  });
});
