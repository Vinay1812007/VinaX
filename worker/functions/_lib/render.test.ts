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
