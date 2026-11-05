import { describe, expect, it } from 'vitest';
import { INDEXNOW_KEY, runIndexNow, sitemapLocs } from '../functions/_lib/indexnow';

const O = 'https://www.vinaxmusic.online';
const map = (...urls: string[]): string => `<urlset>${urls.map((u) => `<url><loc>${O}${u}</loc></url>`).join('')}</urlset>`;

function kv(initial: string | null = null) {
  const store = new Map<string, string>();
  if (initial !== null) store.set('indexnow:urls', initial);
  return { store, get: async (k: string) => store.get(k) ?? null, put: async (k: string, v: string) => void store.set(k, v) };
}

function fetcher(maps: Record<string, string>, postStatus = 200) {
  const posts: Array<{ urlList: string[]; key: string; host: string }> = [];
  const f = (async (url: string, init?: RequestInit) => {
    if (url === 'https://api.indexnow.org/indexnow') {
      posts.push(JSON.parse(String(init?.body)));
      return new Response('', { status: postStatus });
    }
    const name = url.slice(O.length + 1);
    return maps[name] !== undefined ? new Response(maps[name]) : new Response('nope', { status: 404 });
  }) as unknown as typeof fetch;
  return { f, posts };
}

const MAPS = { 'sitemap-static.xml': map('/', '/charts/'), 'sitemap-hubs.xml': map('/telugu-romantic-songs'), 'entity-pages.xml': map('/song/a-1') };

describe('IndexNow', () => {
  it('reads only this site\'s URLs from a sitemap', () => {
    expect(sitemapLocs(`<loc> ${O}/a </loc><loc>https://evil.example/x</loc>`)).toEqual([`${O}/a`]);
  });

  it('sends every URL on the first run, then only new ones', async () => {
    const env = { HANDOFF: kv() };
    const one = fetcher(MAPS);
    expect(await runIndexNow(env, one.f)).toEqual({ urls: 4, submitted: 4 });
    expect(one.posts[0]).toMatchObject({ host: 'www.vinaxmusic.online', key: INDEXNOW_KEY });
    const two = fetcher({ ...MAPS, 'entity-pages.xml': map('/song/a-1', '/album/b-2') });
    expect(await runIndexNow(env, two.f)).toEqual({ urls: 5, submitted: 1 });
    expect(two.posts[0].urlList).toEqual([`${O}/album/b-2`]);
    const three = fetcher({ ...MAPS, 'entity-pages.xml': map('/song/a-1', '/album/b-2') });
    expect(await runIndexNow(env, three.f)).toEqual({ urls: 5, submitted: 0 });
    expect(three.posts).toHaveLength(0);
  });

  it('saves nothing when a map is empty or the post fails, so the next run retries', async () => {
    const env = { HANDOFF: kv() };
    await expect(runIndexNow(env, fetcher({ ...MAPS, 'entity-pages.xml': map() }).f)).rejects.toThrow(/entity-pages/);
    await expect(runIndexNow(env, fetcher(MAPS, 403).f)).rejects.toThrow(/403/);
    expect(env.HANDOFF.store.size).toBe(0);
  });

  it('skips without the KV namespace', async () => {
    expect(await runIndexNow({}, fetcher(MAPS).f)).toEqual({ skipped: 'no KV namespace' });
  });

  it('the key file the site serves matches the key', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    expect(readFileSync(resolve(__dirname, `../../../frontend/public/${INDEXNOW_KEY}.txt`), 'utf8').trim()).toBe(INDEXNOW_KEY);
  });
});
