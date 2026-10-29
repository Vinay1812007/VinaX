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
 * 1.2.0 — the upstream list is a secret. CATALOG_UPSTREAMS names wrapper
 * bases tried in order; a wrapper that fails is benched for a minute. The
 * JioSaavn translation answers only when CATALOG_DIRECT_URL names it;
 * otherwise a failed wrapper is a 502. /stream never leaves the Worker.
 */
import { afterEach, beforeEach, vi } from 'vitest';
import { catalogBases, catalogMediaBase, cleanWrapperBody, configureCatalog, onRequestGet, upstreamBases, type CatalogEnv } from './[[path]]';

const DIRECT = 'https://www.jiosaavn.com/api.php';

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
const get = (path: string, env?: CatalogEnv) =>
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

  it('moves to the next wrapper on a failure, then to a configured direct translation, and benches the failed one', async () => {
    answer = (url) => {
      if (url.startsWith('https://a.example/')) return new Response('rate limited', { status: 429 });
      if (url.startsWith('https://b.example/')) return new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } });
      return jsonRes({ results: [{ id: 'direct', title: 'T', more_info: {} }] }); // JioSaavn's own shape
    };
    const env = { CATALOG_UPSTREAMS: 'https://a.example/api,https://b.example/api', CATALOG_DIRECT_URL: DIRECT };
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

  it('calls no built-in provider: without a direct URL a failed wrapper is a 502', async () => {
    answer = () => new Response('down', { status: 503 });
    const res = await get('search/songs?query=x', { CATALOG_UPSTREAMS: 'https://c.example/api' });
    expect(res.status).toBe(502);
    expect(calls).toEqual(['https://c.example/api/search/songs?query=x']);
    calls.length = 0;
    expect((await get('search/songs?query=x')).status).toBe(502);
    expect(calls).toEqual([]);
  });

  it('CATALOG_DIRECT_URL turns the translation on, at that URL', async () => {
    answer = () => jsonRes({ results: [] });
    await get('search/songs?query=x', { CATALOG_DIRECT_URL: 'https://direct.example/api.php' });
    expect(calls[0].startsWith('https://direct.example/api.php?')).toBe(true);
  });

  it('in-process callers without an env read the secrets the router configured', async () => {
    answer = (url) => jsonRes({ success: true, data: { results: [{ id: url }] } });
    configureCatalog({ CATALOG_UPSTREAMS: 'https://d.example/api' });
    try {
      expect(catalogBases()).toEqual(['https://d.example/api']);
      const res = await get('search/songs?query=z');
      expect((await res.json()).data.results[0].id).toBe('https://d.example/api/search/songs?query=z');
    } finally {
      configureCatalog(undefined);
    }
  });

  it('/stream never goes to a wrapper', async () => {
    answer = () => jsonRes({});
    const res = await get('stream?e=junk&q=160', { CATALOG_UPSTREAMS: 'https://a.example/api' });
    expect(res.status).toBe(404);
    expect(calls.some((u) => u.startsWith('https://a.example/'))).toBe(false);
  });
});

describe('what the browser sees of a wrapper answer', () => {
  const WRAPPED = JSON.stringify({
    success: true,
    data: [{
      id: 'rjkrTnma',
      url: 'https://www.jiosaavn.com/song/kesariya/AgIAQyBeWlI',
      album: { id: '1', url: 'https://www.jiosaavn.com/album/brahmastra/x' },
      image: [{ quality: '500x500', url: 'https://musicapi.example/media/abc/500x500.jpg' }],
      downloadUrl: [{ quality: '320kbps', url: 'https://musicapi.example/media/def/320.mp4' }],
      artists: { primary: [{ image: [{ url: 'https://www.jiosaavn.com/_i/3.0/artist-default-music.png' }] }] },
    }],
  });

  it('blanks JioSaavn page links but keeps its default artwork', () => {
    const out = JSON.parse(cleanWrapperBody(WRAPPED, ['https://musicapi.example/api'], ''));
    expect(out.data[0].url).toBe('');
    expect(out.data[0].album.url).toBe('');
    expect(out.data[0].artists.primary[0].image[0].url).toContain('/_i/');
    expect(out.data[0].image[0].url).toBe('https://musicapi.example/media/abc/500x500.jpg');
  });

  it('moves the API host media links to CATALOG_MEDIA_BASE', () => {
    const out = cleanWrapperBody(WRAPPED, ['https://musicapi.example/api'], 'https://media.example');
    expect(out).not.toContain('musicapi.example');
    expect(JSON.parse(out).data[0].downloadUrl[0].url).toBe('https://media.example/media/def/320.mp4');
  });

  it('/api/cat serves the cleaned body', async () => {
    answer = () => jsonRes(JSON.parse(WRAPPED));
    const res = await get('songs/rjkrTnma', { CATALOG_UPSTREAMS: 'https://e.example/api', CATALOG_MEDIA_BASE: 'https://media.example/' });
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain('jiosaavn.com/song');
    expect(text).toContain('musicapi.example/media/');
    expect(cleanWrapperBody(text, ['https://musicapi.example/api'], 'https://media.example')).not.toContain('musicapi.example');
  });

  it('takes CATALOG_MEDIA_BASE only as an https origin', () => {
    try {
      configureCatalog({ CATALOG_MEDIA_BASE: 'https://media.example/' });
      expect(catalogMediaBase()).toBe('https://media.example');
      configureCatalog({ CATALOG_MEDIA_BASE: 'http://media.example' });
      expect(catalogMediaBase()).toBe('');
      configureCatalog({ CATALOG_MEDIA_BASE: 'https://media.example/sub' });
      expect(catalogMediaBase()).toBe('');
    } finally {
      configureCatalog(undefined);
    }
  });
});
