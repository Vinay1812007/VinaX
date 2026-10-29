/**
 * Pins the self-hosted catalog's mapping contract (4.20.0): raw JioSaavn v4
 * objects pass through with `name`, flattened `primaryArtists`, and
 * play-time-resolved downloadUrl entries pointing at /api/cat/stream —
 * exactly the wrapper dialect src/services/api/normalize.ts consumes.
 */
import { describe, expect, it } from 'vitest';
import { mapSong, streamUrls } from './[[path]]';

const ORIGIN = 'https://www.vinaxmusic.online';
const RAW = {
  id: 'abc123',
  title: 'Naatu Naatu',
  subtitle: 'Rahul Sipligunj, Kaala Bhairava',
  image: 'https://c.saavncdn.com/x/RRR-150x150.jpg',
  language: 'telugu',
  year: '2022',
  play_count: '1000',
  more_info: {
    album: 'RRR',
    duration: '212',
    encrypted_media_url: 'ENCRYPTED+BLOB==',
    artistMap: { primary_artists: [{ id: 'a1', name: 'Rahul Sipligunj' }, { id: 'a2', name: 'Kaala Bhairava' }] },
  },
};

describe('mapSong', () => {
  it('adds name, flattened primaryArtists and stream-resolver downloadUrl', () => {
    const s = mapSong(RAW, ORIGIN);
    expect(s.name).toBe('Naatu Naatu');
    expect(s.primaryArtists).toBe('Rahul Sipligunj, Kaala Bhairava');
    expect(s.downloadUrl).toHaveLength(4);
    expect(s.downloadUrl[3]).toStrictEqual({
      quality: '320kbps',
      url: `${ORIGIN}/api/cat/stream?e=ENCRYPTED%2BBLOB%3D%3D&q=320`,
    });
    // Raw v4 fields normalize.ts reads survive untouched.
    expect(s.more_info.artistMap.primary_artists[0].name).toBe('Rahul Sipligunj');
    expect(s.language).toBe('telugu');
  });
  it('is defensive on junk and songs without an encrypted url', () => {
    expect(mapSong(null, ORIGIN)).toBeNull();
    expect(streamUrls({}, ORIGIN)).toStrictEqual([]);
    expect(mapSong({ id: 'x', title: 'T' }, ORIGIN).downloadUrl).toStrictEqual([]);
  });
});

/**
 * 14.0.4 — the upstream list is a secret. CATALOG_UPSTREAMS names wrapper
 * bases tried in order; a wrapper that fails is benched for a minute; with
 * none configured (or all failing) the built-in JioSaavn translation
 * answers; /stream never leaves the Worker.
 */
import { afterEach, beforeEach, vi } from 'vitest';
import { onRequestGet, upstreamBases } from './[[path]]';

const calls: string[] = [];
let answer: (url: string) => Response | Promise<Response>;

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    return Promise.resolve(answer(url));
  });
});
afterEach(() => vi.unstubAllGlobals());

const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const get = (path: string, env?: { CATALOG_UPSTREAMS?: string; CATALOG_DIRECT_URL?: string }) =>
  onRequestGet({ request: new Request(`${ORIGIN}/api/cat/${path}`), params: { path: path.split('?')[0].split('/') }, env });

describe('upstreamBases', () => {
  it('reads an ordered https list from the secret and ignores junk', () => {
    expect(upstreamBases(undefined)).toEqual([]);
    expect(upstreamBases({ CATALOG_UPSTREAMS: ' https://a.example/api/ , http://plain.example , https://b.example/api,, x' })).toEqual([
      'https://a.example/api',
      'https://b.example/api',
    ]);
  });
});

describe('/api/cat with CATALOG_UPSTREAMS', () => {
  it('answers from the first wrapper that works, in order, forwarding the path and query', async () => {
    answer = (url) => (url.startsWith('https://a.example/') ? jsonRes({ success: true, data: { results: [{ id: 'from-a' }] } }) : jsonRes({ data: { results: [] } }));
    const res = await get('search/songs?query=naatu&limit=3', { CATALOG_UPSTREAMS: 'https://a.example/api,https://b.example/api' });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-vinax-source')).toBe('upstream');
    expect(await res.json()).toEqual({ success: true, data: { results: [{ id: 'from-a' }] } });
    expect(calls).toEqual(['https://a.example/api/search/songs?query=naatu&limit=3']);
  });

  it('moves to the next wrapper on a failure, then to the direct translation, and benches the failed one', async () => {
    answer = (url) => {
      if (url.startsWith('https://a.example/')) return new Response('rate limited', { status: 429 });
      if (url.startsWith('https://b.example/')) return new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } });
      return jsonRes({ results: [{ id: 'direct', title: 'T', more_info: {} }] }); // JioSaavn's own shape
    };
    const env = { CATALOG_UPSTREAMS: 'https://a.example/api,https://b.example/api' };
    const res = await get('search/songs?query=x', env);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-vinax-source')).toBeNull();
    expect((await res.json()).data.results[0].name).toBe('T');
    expect(calls.map((u) => new URL(u).host)).toEqual(['a.example', 'b.example', 'www.jiosaavn.com']);
    // Benched: the next request skips both wrappers straight to the translation.
    calls.length = 0;
    await get('search/songs?query=y', env);
    expect(calls.map((u) => new URL(u).host)).toEqual(['www.jiosaavn.com']);
  });

  it('keeps the wrapper’s no-store (radio) and caches everything else', async () => {
    const env = { CATALOG_UPSTREAMS: 'https://cachehdr.example/api' };
    answer = (url) =>
      new Response(JSON.stringify({ success: true, data: { stationId: 's', songs: [] } }), {
        headers: { 'content-type': 'application/json', 'cache-control': url.includes('/radio') ? 'no-store' : 'public, max-age=0' },
      });
    expect((await get('radio/songs?stationId=s&limit=5', env)).headers.get('cache-control')).toBe('no-store');
    expect((await get('trending?language=hindi', env)).headers.get('cache-control')).toBe('public, max-age=60, s-maxage=600');
  });

  it('without the secret, only the direct translation is used, and CATALOG_DIRECT_URL can move it', async () => {
    answer = () => jsonRes({ results: [] });
    await get('search/songs?query=x');
    expect(calls).toHaveLength(1);
    expect(calls[0].startsWith('https://www.jiosaavn.com/api.php?')).toBe(true);
    calls.length = 0;
    await get('search/songs?query=x', { CATALOG_DIRECT_URL: 'https://direct.example/api.php' });
    expect(calls[0].startsWith('https://direct.example/api.php?')).toBe(true);
  });

  it('/stream never goes to a wrapper', async () => {
    answer = () => jsonRes({});
    const res = await get('stream?e=junk&q=160', { CATALOG_UPSTREAMS: 'https://a.example/api' });
    expect(res.status).toBe(404);
    expect(calls.some((u) => u.startsWith('https://a.example/'))).toBe(false);
  });
});
