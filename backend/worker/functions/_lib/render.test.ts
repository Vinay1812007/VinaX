/**
 * Entity SEO renderer (Spotify/JioSaavn-parity pass): drives the REAL
 * renderEntity against the REAL index.html shell with a stubbed catalog,
 * pinning the three fixes — mirror-ladder upstream, no duplicate og: tags
 * (the share-card bug), and the music.* OpenGraph + ListenAction payload.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { matchHub, renderEntity, renderHub } from './render';

const shell = readFileSync(resolve(__dirname, '../../../index.html'), 'utf8');

const SONG = {
  data: [{
    id: 'abc123', name: 'Chukkala Chunni', duration: 245, year: '2022', language: 'telugu',
    album: { id: 'al9', name: 'Sr Kalyanamandapam' },
    artists: { primary: [{ id: 'ar7', name: 'Anurag Kulkarni' }] },
    image: [{ quality: '500x500', url: 'https://img.test/500.jpg' }],
  }],
};

function env() {
  return { ASSETS: { fetch: () => Promise.resolve(new Response(shell, { headers: { 'content-type': 'text/html' } })) } };
}
const req = () => new Request('https://www.sirimillavinay.online/song/chukkala-chunni-abc123');

afterEach(() => vi.unstubAllGlobals());

describe('renderEntity — song', () => {
  it('injects unique title/desc, exactly ONE og:title (the entity one), music.* tags and ListenAction', async () => {
    vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('saavn.sumit.co')) return Promise.resolve(Response.json(SONG));
      return Promise.resolve(new Response('nope', { status: 500 }));
    });
    const res = await renderEntity('song', 'chukkala-chunni-abc123', req(), env());
    const html = await res.text();

    expect(html).toContain('<title>Chukkala Chunni — Anurag Kulkarni · Telugu Song | VinaX</title>');
    expect(html).toContain('Telugu song');
    // The share-card bug: the shell's generic og:title used to survive ahead
    // of ours — crawlers take the FIRST, so shares showed the site card.
    expect(html.match(/property="og:title"/g)).toHaveLength(1);
    expect(html.match(/property="og:type"/g)).toHaveLength(1);
    expect(html).toContain('content="music.song"');
    expect(html.match(/name="twitter:card"/g)).toHaveLength(1);
    expect(html).toContain('property="music:duration" content="245"');
    expect(html).toContain('property="music:musician" content="Anurag Kulkarni"');
    expect(html).toContain('"@type":"ListenAction"');
    expect(html).toContain('"@type":"MusicRecording"');
    expect(html).toContain('"@type":"BreadcrumbList"');
    expect(html).toContain('rel="canonical" href="https://www.sirimillavinay.online/song/chukkala-chunni-abc123"');
    // og:site_name (brand) deliberately survives.
    expect(html).toContain('property="og:site_name"');
  });

  it('falls through the mirror ladder when the first mirror is dead', async () => {
    vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('saavn.sumit.co')) return Promise.reject(new Error('ENOTFOUND'));
      if (url.includes('nepotuneapi')) return Promise.resolve(Response.json(SONG));
      return Promise.resolve(new Response('', { status: 500 }));
    });
    const res = await renderEntity('song', 'abc123', req(), env());
    const html = await res.text();
    expect(html).toContain('Chukkala Chunni — Anurag Kulkarni');
  });

  it('serves the untouched shell when every mirror is down (fail-soft)', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('total outage')));
    const res = await renderEntity('song', 'abc123', req(), env());
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('VinaX — music tuned to you'); // generic card intact
  });

  it('a hostile song name cannot break out of the JSON-LD script block', async () => {
    const hostile = { data: [{ ...SONG.data[0], name: '</script><img src=x onerror=alert(1)>' }] };
    vi.stubGlobal('fetch', () => Promise.resolve(Response.json(hostile)));
    const res = await renderEntity('song', 'abc123', req(), env());
    const html = await res.text();
    expect(html).not.toContain('</script><img');
  });
});

describe('mood x language hubs', () => {
  it('matchHub allow-lists real hubs and passes everything else through', () => {
    expect(matchHub('/telugu-romantic-songs')).toEqual({ lang: 'telugu', mood: 'romantic' });
    expect(matchHub('/hindi-sad-songs/')).toEqual({ lang: 'hindi', mood: 'sad' });
    expect(matchHub('/telugu-songs')).toBeNull(); // language hub — static route
    expect(matchHub('/about')).toBeNull();
    expect(matchHub('/klingon-romantic-songs')).toBeNull();
    expect(matchHub('/telugu-explosive-songs')).toBeNull();
    expect(matchHub('/assets/x.js')).toBeNull();
  });

  it('renderHub injects unique title, CollectionPage JSON-LD and a crawlable song list', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        Response.json({ data: { results: [{ id: 's1', name: 'Nee Kannu Neeli', artists: { primary: [{ name: 'Artist A' }] } }] } }),
      ),
    );
    const res = await renderHub('telugu', 'romantic', new Request('https://www.sirimillavinay.online/telugu-romantic-songs'), env());
    const html = await res.text();
    expect(html).toContain('<title>Telugu Romantic Songs — Stream Free | VinaX</title>');
    expect(html.match(/property="og:title"/g)).toHaveLength(1); // generic tags stripped here too
    expect(html).toContain('"@type":"CollectionPage"');
    expect(html).toContain('"@type":"ItemList"');
    expect(html).toContain('Nee Kannu Neeli');
    expect(html).toContain('href="/telugu-sad-songs"'); // sibling links for crawl discovery
    expect(html).toContain('rel="canonical" href="https://www.sirimillavinay.online/telugu-romantic-songs"');
  });

  it('renderHub fails soft to the plain shell when the catalog is down', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('down')));
    const res = await renderHub('telugu', 'romantic', new Request('https://www.sirimillavinay.online/telugu-romantic-songs'), env());
    expect(res.status).toBe(200);
    const html = await res.text();
    // Meta still unique (no catalog needed for the head), list simply absent.
    expect(html).toContain('Telugu Romantic Songs');
  });
});

describe('renderEntity — prerendered shell (4.17.6 regression)', () => {
  it('replaces the baked-in home #seo-content block when #seo-slot was consumed by prerender', async () => {
    vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('saavn.sumit.co')) return Promise.resolve(Response.json(SONG));
      return Promise.resolve(new Response('nope', { status: 500 }));
    });
    // Simulate dist/index.html: prerender consumed the slot and left the
    // generic HOME content block in its place.
    const prerendered = shell.replace(
      '<div id="seo-slot"></div>',
      '<div id="seo-content"><h1>VinaX — Free Music Streaming for India</h1><p>generic home text</p><nav aria-label="Browse VinaX"><a href="/">Home</a></nav></div>',
    );
    const prerenderedEnv = {
      ASSETS: { fetch: () => Promise.resolve(new Response(prerendered, { headers: { 'content-type': 'text/html' } })) },
    };
    const res = await renderEntity('song', 'chukkala-chunni-abc123', req(), prerenderedEnv);
    const html = await res.text();
    // The generic home body is GONE — this exact failure shipped thin
    // duplicate content on every entity page and killed indexing.
    expect(html).not.toContain('generic home text');
    expect(html).not.toContain('VinaX — Free Music Streaming for India</h1>');
    // The entity's own crawlable block is in — and it is a <main> landmark
    // (4.17.7: PSI flags shells without one; the static shell is what the
    // audit snapshots before React mounts its own <main id="main-content">).
    expect(html).toContain('<h1>Chukkala Chunni</h1>');
    expect(html).toContain('<main id="seo-content">');
    expect(html.match(/id="seo-content"/g)).toHaveLength(1);
  });

  it('also replaces the <main id="seo-content"> block baked by ≥4.17.7 builds', async () => {
    vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('saavn.sumit.co')) return Promise.resolve(Response.json(SONG));
      return Promise.resolve(new Response('nope', { status: 500 }));
    });
    const prerendered = shell.replace(
      '<div id="seo-slot"></div>',
      '<main id="seo-content"><h1>VinaX — Free Music Streaming for India</h1><p>generic home text</p><nav aria-label="Browse VinaX"><a href="/">Home</a></nav></main>',
    );
    const prerenderedEnv = {
      ASSETS: { fetch: () => Promise.resolve(new Response(prerendered, { headers: { 'content-type': 'text/html' } })) },
    };
    const res = await renderEntity('song', 'chukkala-chunni-abc123', req(), prerenderedEnv);
    const html = await res.text();
    expect(html).not.toContain('generic home text');
    expect(html).toContain('<h1>Chukkala Chunni</h1>');
    expect(html.match(/<main id="seo-content">/g)).toHaveLength(1);
    expect(html.match(/<\/main>/g)).toHaveLength(1);
  });

  it('slugify strips catalog HTML entities (canonical must match sitemap URLs)', async () => {
    vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('saavn.sumit.co')) {
        return Promise.resolve(Response.json({
          data: [{ id: '2x_4tjb7', name: 'Sorry Sorry (&quot;Bhojpuriya Raja&quot;)', language: 'bhojpuri', image: [] }],
        }));
      }
      return Promise.resolve(new Response('nope', { status: 500 }));
    });
    const res = await renderEntity('song', 'sorry-sorry-bhojpuriya-raja-2x_4tjb7', req(), env());
    const html = await res.text();
    // Before 4.17.6 this canonical read ".../song/sorry-sorry-quot-bhojpuriya-raja-quot-2x_4tjb7"
    // — a URL nothing else linked to, so Google filed every crawled page as
    // "Alternative page with proper canonical tag" and indexed almost nothing.
    expect(html).toContain('rel="canonical" href="https://www.sirimillavinay.online/song/sorry-sorry-bhojpuriya-raja-2x_4tjb7"');
    expect(html).not.toContain('-quot-');
  });

  it('clamps the meta description into Bing’s 25–160 char window for unbounded titles (4.19.4)', async () => {
    const longName = `${'Raama'.repeat(12)} ${'Krishna'.repeat(12)} ${'Govinda'.repeat(12)}`;
    vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('saavn.sumit.co')) {
        return Promise.resolve(Response.json({ data: [{ id: 'idx1', name: longName, language: 'hindi', image: [] }] }));
      }
      return Promise.resolve(new Response('nope', { status: 500 }));
    });
    const res = await renderEntity('song', 'x-idx1', req(), env());
    const html = await res.text();
    const m = /<meta name="description" content="([^"]*)"/.exec(html);
    expect(m).toBeTruthy();
    expect((m as RegExpExecArray)[1].length).toBeLessThanOrEqual(160);
    expect((m as RegExpExecArray)[1].length).toBeGreaterThanOrEqual(25);
  });
});

describe('renderEntity — 8.4.0 content depth (low-value content fix)', () => {
  const mainOf = (html: string) => /<main id="seo-content">([\s\S]*?)<\/main>/.exec(html)?.[1] ?? '';
  const words = (html: string) => mainOf(html).replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;

  const CREDITED = {
    data: [{
      ...SONG.data[0],
      releaseDate: '2021-08-06', label: 'Aditya Music', copyright: '℗ 2021 Aditya Music',
      artists: {
        primary: [{ id: 'ar7', name: 'Anurag Kulkarni' }],
        all: [
          { id: 'ar7', name: 'Anurag Kulkarni', role: 'singer' },
          { id: 'ar8', name: 'Chaitan Bharadwaj', role: 'music' },
          { id: 'ar9', name: 'Krishna Kanth', role: 'lyricist' },
        ],
      },
    }],
  };
  const ALBUM = {
    data: {
      id: 'al9', name: 'Sr Kalyanamandapam', year: 2021, language: 'telugu',
      songs: [
        { id: 'abc123', name: 'Chukkala Chunni', duration: 245 },
        { id: 's2', name: 'Choosale Kallaraa', duration: 230, artists: { all: [{ name: 'Sid Sriram', role: 'singer' }] } },
      ],
    },
  };
  const ARTIST = {
    data: {
      id: 'ar7', name: 'Anurag Kulkarni', dominantType: 'singer', dominantLanguage: 'telugu', availableLanguages: ['telugu', 'kannada', 'unknown'],
      topSongs: [{ id: 's3', name: 'Ramuloo Ramulaa', duration: 250, artists: { primary: [{ name: 'Anurag Kulkarni' }] } }],
      topAlbums: [{ id: 'al1', name: 'Ala Vaikunthapurramuloo', year: 2020 }],
      similarArtists: [{ id: 'ar2', name: 'Sid Sriram' }],
      bio: [{ title: 'Early life', text: 'A playback singer from Hyderabad.' }],
    },
  };
  const catalog = (input: RequestInfo | URL) => {
    const url = String(input);
    if (!url.includes('saavn.sumit.co')) return Promise.resolve(new Response('', { status: 500 }));
    if (url.includes('/songs/')) return Promise.resolve(Response.json(CREDITED));
    if (url.includes('/albums')) return Promise.resolve(Response.json(ALBUM));
    if (url.includes('/artists/')) return Promise.resolve(Response.json(ARTIST));
    return Promise.resolve(new Response('', { status: 404 }));
  };

  it('a song page carries credits, release details, the rest of the album, more by the artist and hub links', async () => {
    vi.stubGlobal('fetch', catalog);
    const html = await (await renderEntity('song', 'chukkala-chunni-abc123', req(), env())).text();
    const main = mainOf(html);
    expect(main).toContain('sung by Anurag Kulkarni with music by Chaitan Bharadwaj and lyrics by Krishna Kanth');
    expect(main).toContain('released on 6 August 2021 by Aditya Music');
    expect(main).toContain('<dt>Lyrics</dt><dd>Krishna Kanth</dd>');
    expect(main).toContain('More from Sr Kalyanamandapam');
    expect(main).toContain('href="/song/choosale-kallaraa-s2"');
    expect(main).not.toContain('href="/song/chukkala-chunni-abc123"'); // not listed under itself
    expect(main).toContain('More by Anurag Kulkarni');
    expect(main).toContain('href="/telugu-romantic-songs"');
    expect(main.toLowerCase()).not.toContain('no ads');
    expect(words(html)).toBeGreaterThan(90);
  });

  it('reads the raw catalog shape (more_info) too: album, credits and duration survive', async () => {
    const raw = {
      data: [{
        id: 'abc123', title: 'Chukkala Chunni', name: 'Chukkala Chunni', language: 'telugu', year: '2021', primaryArtists: 'Anurag Kulkarni',
        more_info: {
          album: 'Sr Kalyanamandapam', album_id: 'al9', duration: '245', label: 'Aditya Music', release_date: '2021-08-06',
          artistMap: { primary_artists: [{ id: 'ar7', name: 'Anurag Kulkarni' }], artists: [{ id: 'ar8', name: 'Chaitan Bharadwaj', role: 'music' }] },
        },
      }],
    };
    vi.stubGlobal('fetch', (input: RequestInfo | URL) =>
      String(input).includes('/songs/') ? Promise.resolve(Response.json(raw)) : Promise.resolve(new Response('', { status: 500 })));
    const html = await (await renderEntity('song', 'abc123', req(), env())).text();
    expect(html).toContain('property="music:duration" content="245"');
    expect(mainOf(html)).toContain('with music by Chaitan Bharadwaj');
    expect(mainOf(html)).toContain('href="/album/sr-kalyanamandapam-al9"');
  });

  it('a slow album/artist mirror drops only those sections, never the page', async () => {
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('saavn.sumit.co') && url.includes('/songs/')) return Promise.resolve(Response.json(CREDITED));
      if (!url.includes('/albums') && !url.includes('/artists/')) return Promise.resolve(new Response('', { status: 500 }));
      // Album/artist mirrors hang and ignore aborts: only the render's own cap can end the wait.
      void init;
      return new Promise<Response>(() => {});
    });
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      const pending = renderEntity('song', 'abc123', req(), env());
      await vi.advanceTimersByTimeAsync(10_000);
      const html = await (await pending).text();
      expect(mainOf(html)).toContain('Song details');
      expect(mainOf(html)).not.toContain('More from');
    } finally {
      vi.useRealTimers();
    }
  });

  it('an album page lists tracks with singers and lengths, plus credits', async () => {
    vi.stubGlobal('fetch', catalog);
    const html = await (await renderEntity('album', 'sr-kalyanamandapam-al9', new Request('https://www.sirimillavinay.online/album/x-al9'), env())).text();
    const main = mainOf(html);
    expect(main).toContain('Sr Kalyanamandapam is a 2021 Telugu album');
    expect(main).toContain('Its 2 songs run about 8 minutes in all');
    expect(main).toContain('Choosale Kallaraa</a> — Sid Sriram (3:50)');
    expect(main).toContain('<h2>Credits</h2>');
  });

  it('an artist page has a written intro, albums, biography and similar artists', async () => {
    vi.stubGlobal('fetch', catalog);
    const html = await (await renderEntity('artist', 'anurag-kulkarni-ar7', new Request('https://www.sirimillavinay.online/artist/x-ar7'), env())).text();
    const main = mainOf(html);
    expect(main).toContain('Anurag Kulkarni is a singer whose songs on VinaX are mostly in Telugu, with others in Kannada.');
    expect(main).toContain('href="/album/ala-vaikunthapurramuloo-al1"');
    expect(main).toContain('A playback singer from Hyderabad.');
    expect(main).toContain('href="/artist/sid-sriram-ar2"');
  });
});
