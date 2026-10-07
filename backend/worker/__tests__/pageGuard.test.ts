/**
 * 11.0 — the entity-page guard (functions/_lib/pageGuard.ts): browser
 * impostors and page-hungry networks get the plain shell; people, search
 * engines and link previewers get the rendered page.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { guardVerdict, isBrowserImpostor, isEntityPage, isHubPage, isKnownCrawler, networkOf, plainShell } from '../functions/_lib/pageGuard';
import { _resetRateLimitsForTests } from '../functions/_lib/ratelimit';

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36';
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1';
const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0';

const page = (ip: string, headers: Record<string, string> = {}, path = '/song/little-flower-hkUmgmaL'): Request =>
  new Request(`https://www.sirimillavinay.online${path}`, { headers: { 'cf-connecting-ip': ip, 'user-agent': CHROME, ...headers } });

/** A real Chromium navigation carries client hints and fetch metadata. */
const REAL = { 'sec-ch-ua': '"Chromium";v="144", "Google Chrome";v="144"', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', 'accept-language': 'te-IN,te;q=0.9' };

beforeEach(() => _resetRateLimitsForTests());

describe('what is guarded', () => {
  it('matches the four entity page kinds and the language-mood hubs only', () => {
    for (const p of ['/song/x-1', '/album/raga-fantasy-3087167', '/artist/ansh-chomal-10062897', '/playlist/abc', '/song/x-1/']) expect(isEntityPage(p), p).toBe(true);
    for (const p of ['/', '/api/cat/search', '/song', '/song/a/b', '/sitemap.xml', '/telugu-sad-songs']) expect(isEntityPage(p), p).toBe(false);
    for (const p of ['/telugu-sad-songs', '/hindi-songs', '/english-workout-songs/']) expect(isHubPage(p), p).toBe(true);
    for (const p of ['/charts', '/song/x-1', '/api/status', '/telugu_sad_songs']) expect(isHubPage(p), p).toBe(false);
  });
});

describe('browser impostors', () => {
  it('a Chromium user agent with no client hints and no fetch metadata is a script', () => {
    expect(isBrowserImpostor(page('1.2.3.4'))).toBe(true);
    expect(isBrowserImpostor(page('1.2.3.4', REAL))).toBe(false);
    // Either family of headers is enough to pass: old HTTP/1 proxies drop some.
    expect(isBrowserImpostor(page('1.2.3.4', { 'sec-fetch-mode': 'navigate' }))).toBe(false);
    expect(isBrowserImpostor(page('1.2.3.4', { 'sec-ch-ua': '"Chromium";v="144"' }))).toBe(false);
  });
  it('browsers that never send client hints are not judged by them', () => {
    expect(isBrowserImpostor(page('1.2.3.4', { 'user-agent': SAFARI }))).toBe(false);
    expect(isBrowserImpostor(page('1.2.3.4', { 'user-agent': FIREFOX }))).toBe(false);
    expect(isBrowserImpostor(new Request('https://www.sirimillavinay.online/song/x-1'))).toBe(false);
  });
});

describe('known crawlers', () => {
  it('search engines and link previewers are exempt by name, and verified bots by the platform flag', () => {
    for (const ua of ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'Mozilla/5.0 (compatible; bingbot/2.0)', 'WhatsApp/2.23.20.0 A', 'Twitterbot/1.0', 'facebookexternalhit/1.1', 'TelegramBot (like TwitterBot)']) {
      expect(isKnownCrawler(page('1.2.3.4', { 'user-agent': ua })), ua).toBe(true);
    }
    expect(isKnownCrawler(page('1.2.3.4'))).toBe(false);
    const verified = Object.assign(page('1.2.3.4'), { cf: { verifiedBotCategory: 'Search Engine Crawler' } });
    expect(isKnownCrawler(verified)).toBe(true);
  });
});

describe('networks', () => {
  it('groups IPv4 by /24 and IPv6 by /32', () => {
    expect(networkOf('103.21.244.17')).toBe('103.21.244.0/24');
    expect(networkOf('2a12:f543:9ab:1::7')).toBe('2a12:f543::/32');
    expect(networkOf('2a10:7b00::1')).toBe('2a10:7b00::/32');
    expect(networkOf('::1')).toBe('0:0::/32');
    expect(networkOf('unknown')).toBe('unknown');
  });
});

describe('the verdict', () => {
  it('renders for a person, a crawler and a non-GET; serves the shell to an impostor at once', async () => {
    expect(await guardVerdict(page('1.2.3.4', REAL), {})).toBe('render');
    expect(await guardVerdict(page('1.2.3.4', { 'user-agent': 'Googlebot/2.1' }), {})).toBe('render');
    expect(await guardVerdict(new Request('https://www.sirimillavinay.online/song/x-1', { method: 'POST', headers: { 'user-agent': CHROME } }), {})).toBe('render');
    expect(await guardVerdict(page('1.2.3.4'), {})).toBe('impostor');
  });

  it('one address reading pages faster than people do is served the shell after its budget', async () => {
    let verdicts = 0;
    for (let i = 0; i < 30; i += 1) if ((await guardVerdict(page('5.6.7.8', REAL, `/song/s-${i}`), {})) === 'render') verdicts += 1;
    expect(verdicts).toBe(30);
    expect(await guardVerdict(page('5.6.7.8', REAL, '/song/s-31'), {})).toBe('address');
    // A neighbour on another address is unaffected.
    expect(await guardVerdict(page('9.9.9.9', REAL), {})).toBe('render');
  });

  it('a pool rotating addresses inside one IPv6 /32 shares one network budget', async () => {
    let served = 0;
    for (let i = 0; i < 260; i += 1) {
      const ip = `2a12:f543:${(i % 4000).toString(16)}:${i.toString(16)}::1`;
      if ((await guardVerdict(page(ip, REAL, `/album/a-${i}`), {})) === 'render') served += 1;
    }
    // 200 burst for the whole /32, then the shell.
    expect(served).toBe(200);
    expect(await guardVerdict(page('2a12:f543:ffff::1', REAL, '/album/last'), {})).toBe('network');
    // Another /32 is a different network.
    expect(await guardVerdict(page('2a10:7b00::1', REAL, '/album/other'), {})).toBe('render');
  });

  it('a failing binding never costs a visitor the page', async () => {
    const env = { RATE_LIMIT_60: { limit: vi.fn(async () => { throw new Error('down'); }) }, RATE_LIMIT_300: { limit: vi.fn(async () => ({ success: false })) } };
    expect(await guardVerdict(page('7.7.7.7', REAL), env)).toBe('network');
    const env2 = { RATE_LIMIT_60: { limit: vi.fn(async () => ({ success: false })) } };
    expect(await guardVerdict(page('8.8.8.8', REAL), env2)).toBe('address');
  });
});

describe('the plain shell', () => {
  it('is the app shell, uncacheable, labelled with the verdict', async () => {
    const fetchAsset = vi.fn(async (req: Request) => new Response(`<html>${new URL(req.url).pathname}</html>`, { headers: { 'content-type': 'text/html' } }));
    const res = await plainShell(page('1.2.3.4'), fetchAsset, 'impostor');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('<html>/index.html</html>');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('x-vinax-page')).toBe('impostor');
  });
});
