/**
 * IndexNow (SEO 2026-11): tells Bing, Yandex, Seznam and Naver about new
 * pages as soon as they are live, instead of waiting for their next sitemap
 * read. Google does not use IndexNow; it reads the sitemap.
 *
 * The `indexnow` job reads the three sitemaps the static host serves, keeps
 * the last list it submitted in KV (the HANDOFF namespace, key
 * `indexnow:urls`), and posts only the URLs that are new since then. The
 * first run sends the whole list once. If a sitemap cannot be read or the
 * post fails, nothing is saved and the next run tries again.
 *
 * The key is public by design: IndexNow checks it against the file the site
 * serves at /<key>.txt (frontend/public/<key>.txt).
 */
export const INDEXNOW_KEY = '8ce2bf3b0262a2340b3aac6836a2e3c1';
const HOST = 'www.vinaxmusic.online';
const ORIGIN = `https://${HOST}`;
const MAPS = ['sitemap-static.xml', 'sitemap-hubs.xml', 'entity-pages.xml'];
const STATE_KEY = 'indexnow:urls';
/** IndexNow takes at most 10,000 URLs per post. */
const MAX_PER_POST = 10_000;

interface KV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}
export interface IndexNowEnv {
  HANDOFF?: KV;
}

/** The <loc> URLs of a sitemap, on this site only. */
export function sitemapLocs(xml: string): string[] {
  const out: string[] = [];
  for (const m of String(xml).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) if (m[1].startsWith(`${ORIGIN}/`)) out.push(m[1]);
  return out;
}

/** Run once: submit the URLs that are new since the last submission. */
export async function runIndexNow(env: IndexNowEnv, fetcher: typeof fetch = fetch): Promise<Record<string, unknown>> {
  if (!env.HANDOFF) return { skipped: 'no KV namespace' };
  const current = new Set<string>();
  for (const map of MAPS) {
    const res = await fetcher(`${ORIGIN}/${map}`, { headers: { accept: 'application/xml' } });
    const locs = res.ok ? sitemapLocs(await res.text()) : [];
    // An empty or unreadable map is a bad deploy moment, not "every page is gone".
    if (!locs.length) throw new Error(`indexnow: ${map} answered ${res.status} with no URLs`);
    for (const u of locs) current.add(u);
  }
  const previous = new Set((await env.HANDOFF.get(STATE_KEY))?.split('\n').filter(Boolean) ?? []);
  const fresh = [...current].filter((u) => !previous.has(u));
  for (let i = 0; i < fresh.length; i += MAX_PER_POST) {
    const res = await fetcher('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host: HOST, key: INDEXNOW_KEY, keyLocation: `${ORIGIN}/${INDEXNOW_KEY}.txt`, urlList: fresh.slice(i, i + MAX_PER_POST) }),
    });
    // 200 = received, 202 = received and the key is still being checked.
    if (res.status !== 200 && res.status !== 202) throw new Error(`indexnow: the post answered ${res.status}`);
  }
  if (fresh.length || previous.size !== current.size) await env.HANDOFF.put(STATE_KEY, [...current].sort().join('\n'));
  return { urls: current.size, submitted: fresh.length };
}
