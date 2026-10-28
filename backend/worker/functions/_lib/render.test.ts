/**
 * Hub SEO renderer: drives the REAL renderHub against the REAL index.html
 * shell. There is no music catalogue, so hubs carry text and links only.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { matchHub, renderHub } from './render';

const shell = readFileSync(resolve(__dirname, '../../../index.html'), 'utf8');

function env() {
  return { ASSETS: { fetch: () => Promise.resolve(new Response(shell, { headers: { 'content-type': 'text/html' } })) } };
}

afterEach(() => vi.unstubAllGlobals());

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

  it('renderHub injects unique title, CollectionPage JSON-LD and crawlable text — and fetches nothing', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const res = await renderHub('telugu', 'romantic', new Request('https://www.vinaxmusic.online/telugu-romantic-songs'), env());
    const html = await res.text();
    expect(html).toContain('<title>Telugu Romantic Songs — Stream Free | VinaX</title>');
    expect(html.match(/property="og:title"/g)).toHaveLength(1); // generic tags stripped here too
    expect(html).toContain('"@type":"CollectionPage"');
    expect(html).not.toContain('"@type":"ItemList"'); // no catalogue, so no song list
    expect(html).not.toContain('href="/song/');
    expect(f).not.toHaveBeenCalled();
    expect(html).toContain('href="/telugu-sad-songs"'); // sibling links for crawl discovery
    expect(html).toContain('rel="canonical" href="https://www.vinaxmusic.online/telugu-romantic-songs"');
  });

  it('13.5.0: a hub served from the prerendered home shell declares ONE canonical and og:url — its own', async () => {
    // dist/index.html is the prerendered HOME page: it carries home's canonical and og:url.
    const homeShell = shell.replace(
      '</head>',
      '<link rel="canonical" href="https://www.vinaxmusic.online/"/><meta property="og:url" content="https://www.vinaxmusic.online/"/></head>',
    );
    const homeEnv = { ASSETS: { fetch: () => Promise.resolve(new Response(homeShell, { headers: { 'content-type': 'text/html' } })) } };
    const html = await (await renderHub('hindi', 'sad', new Request('https://www.vinaxmusic.online/hindi-sad-songs'), homeEnv)).text();
    expect(html.match(/rel="canonical"/g)).toHaveLength(1);
    expect(html.match(/property="og:url"/g)).toHaveLength(1);
    expect(html).toContain('rel="canonical" href="https://www.vinaxmusic.online/hindi-sad-songs"');
  });
});
