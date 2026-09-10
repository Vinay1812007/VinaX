/**
 * Free, keyless live web search — the shared research source behind VinaX AI
 * and VinaX CLI.
 *
 * Extracted from functions/api/vinaxai.ts (unchanged behaviour) when the CLI
 * agent endpoint needed the same capability: two endpoints running two copies
 * of a scraper is how one of them silently rots. One implementation, two
 * callers.
 *
 * No key is required. A BRAVE_API_KEY is used when one happens to be
 * configured, purely because it returns better results; everything works
 * without it.
 *
 * WHAT COMES BACK IS UNTRUSTED. These are arbitrary pages from the open web,
 * fetched and stripped of markup. Callers must hand the text to a model as
 * DATA, inside a fence, never as instructions.
 */

/** Env slice this module reads. */
const UA = 'VinaX/1.0 (+https://www.sirimillavinay.online)';

export interface WebSearchEnv {
  BRAVE_API_KEY?: string;
}

export type SearchHit = { text: string; sources: string[] };

// Abort a fetch after `ms` so a slow upstream can never hang the whole reply.
export function timeoutSignal(ms: number): AbortSignal {
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

// --- shared helpers for the free (no-key) search sources ---
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

export function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#(?:39|x27);/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface Item {
  title: string;
  snippet: string;
  url: string;
}

/** Merge, de-duplicate by URL, cap and number a set of search results. */
function itemsToHit(items: Item[]): SearchHit | null {
  const seen = new Set<string>();
  const uniq: Item[] = [];
  for (const it of items) {
    if (!it.url || !it.title || seen.has(it.url)) continue;
    seen.add(it.url);
    uniq.push(it);
    if (uniq.length >= 8) break;
  }
  if (!uniq.length) return null;
  const text = uniq.map((x, i) => `[${i + 1}] ${x.title}\n${x.snippet}\n${x.url}`.trim()).join('\n\n');
  return { text, sources: uniq.map((x) => x.url) };
}

// --- Brave (optional upgrade — only used if a key happens to be configured) ---
interface BraveResult {
  title?: string;
  description?: string;
  url?: string;
}
interface BraveResp {
  web?: { results?: BraveResult[] };
}
async function braveSearch(key: string, q: string): Promise<Item[]> {
  try {
    const u = new URL('https://api.search.brave.com/res/v1/web/search');
    u.searchParams.set('q', q);
    u.searchParams.set('count', '6');
    const r = await fetch(u.toString(), {
      headers: { 'X-Subscription-Token': key, accept: 'application/json' },
      signal: timeoutSignal(6000),
    });
    if (!r.ok) return [];
    const d = (await r.json()) as BraveResp;
    return (d.web?.results ?? []).slice(0, 6).map((x) => ({
      title: stripTags(x.title ?? ''),
      snippet: stripTags(x.description ?? ''),
      url: x.url ?? '',
    }));
  } catch {
    return [];
  }
}

// --- Google (free, no key) — best-effort scrape of the classic results page ---
async function googleSearch(q: string): Promise<Item[]> {
  try {
    const url = 'https://www.google.com/search?hl=en&num=10&safe=off&q=' + encodeURIComponent(q);
    const r = await fetch(url, {
      headers: { 'user-agent': BROWSER_UA, accept: 'text/html', 'accept-language': 'en-US,en;q=0.9' },
      signal: timeoutSignal(6000),
    });
    if (!r.ok) return [];
    // Cap HTML at 200KB before regex parsing — a hostile upstream (or a
    // captcha page redirected to something huge) can otherwise burn CPU
    // inside the regex engine (audit finding H-SRV-9).
    const html = (await r.text()).slice(0, 200_000);
    // Distinguish "no results" from "captcha / block" so admin monitoring can
    // spot when the scrape is silently useless (audit finding L5). Both still
    // return [] to keep the caller path unchanged.
    if (/id="captcha-form"|Our systems have detected unusual traffic|sorry\/index/i.test(html)) {
      console.warn('[googleSearch] blocked (captcha or unusual-traffic gate)');
      return [];
    }
    const items: Item[] = [];
    const push = (rawUrl: string, rawTitle: string): void => {
      let u = rawUrl;
      try {
        u = decodeURIComponent(rawUrl);
      } catch {
        /* keep raw */
      }
      const title = stripTags(rawTitle);
      if (u && title && /^https?:\/\//.test(u) && !/(?:\.google\.|gstatic\.|googleusercontent)/.test(u)) {
        items.push({ title, snippet: '', url: u });
      }
    };
    const re1 = /<a href="\/url\?q=(https?[^&"]+)[^"]*"[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/g;
    let m = re1.exec(html);
    while (m && items.length < 6) {
      push(m[1], m[2]);
      m = re1.exec(html);
    }
    if (!items.length) {
      const re2 = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/g;
      let m2 = re2.exec(html);
      while (m2 && items.length < 6) {
        push(m2[1], m2[2]);
        m2 = re2.exec(html);
      }
    }
    return items;
  } catch {
    return [];
  }
}

// --- DuckDuckGo HTML results (free, no key) — real ranked web results ---
function decodeDdgUrl(href: string): string {
  const m = /[?&]uddg=([^&]+)/.exec(href);
  if (m) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return '';
    }
  }
  if (href.startsWith('http')) return href;
  if (href.startsWith('//')) return 'https:' + href;
  return '';
}
async function ddgHtmlSearch(q: string): Promise<Item[]> {
  try {
    const r = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q), {
      headers: { 'user-agent': BROWSER_UA, accept: 'text/html', 'accept-language': 'en-US,en;q=0.9' },
      signal: timeoutSignal(6000),
    });
    if (!r.ok) return [];
    // Cap HTML at 200KB (audit finding H-SRV-9).
    const html = (await r.text()).slice(0, 200_000);
    const snippets: string[] = [];
    const snipRe = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let sm = snipRe.exec(html);
    while (sm) {
      snippets.push(stripTags(sm[1]));
      sm = snipRe.exec(html);
    }
    const items: Item[] = [];
    const linkRe = /class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let m = linkRe.exec(html);
    let i = 0;
    while (m && items.length < 6) {
      const url = decodeDdgUrl(m[1]);
      const title = stripTags(m[2]);
      if (url && title) items.push({ title, snippet: snippets[i] ?? '', url });
      i += 1;
      m = linkRe.exec(html);
    }
    return items;
  } catch {
    return [];
  }
}

// --- DuckDuckGo Instant Answer API (free, no key) — direct answers / definitions ---
interface DdgTopic {
  Text?: string;
  FirstURL?: string;
  Topics?: DdgTopic[];
}
interface DdgResp {
  Heading?: string;
  Answer?: string;
  AbstractText?: string;
  AbstractURL?: string;
  Definition?: string;
  DefinitionURL?: string;
  RelatedTopics?: DdgTopic[];
}
function flattenTopics(list: DdgTopic[]): DdgTopic[] {
  const out: DdgTopic[] = [];
  for (const t of list) {
    if (Array.isArray(t.Topics)) out.push(...flattenTopics(t.Topics));
    else if (t.Text) out.push(t);
  }
  return out;
}
async function ddgSearch(q: string): Promise<Item[]> {
  try {
    const u = new URL('https://api.duckduckgo.com/');
    u.searchParams.set('q', q);
    u.searchParams.set('format', 'json');
    u.searchParams.set('no_html', '1');
    u.searchParams.set('skip_disambig', '1');
    const r = await fetch(u.toString(), {
      headers: { accept: 'application/json', 'user-agent': UA },
      signal: timeoutSignal(6000),
    });
    if (!r.ok) return [];
    const d = (await r.json()) as DdgResp;
    const items: Item[] = [];
    const head = d.Heading ?? q;
    if (d.AbstractText) items.push({ title: head, snippet: d.AbstractText, url: d.AbstractURL ?? '' });
    if (d.Definition) items.push({ title: head, snippet: d.Definition, url: d.DefinitionURL ?? '' });
    for (const t of flattenTopics(d.RelatedTopics ?? []).slice(0, 4)) {
      if (t.Text) items.push({ title: t.Text.split(' - ')[0], snippet: t.Text, url: t.FirstURL ?? '' });
    }
    return items.filter((x) => x.url);
  } catch {
    return [];
  }
}

// Free, keyless web context: DuckDuckGo (real HTML results + instant answers) and
// Google, merged and de-duplicated. Brave is used only if a key is configured.
export async function liveSearch(env: WebSearchEnv, q: string): Promise<SearchHit | null> {
  if (env.BRAVE_API_KEY) {
    const hit = itemsToHit(await braveSearch(env.BRAVE_API_KEY, q));
    if (hit) return hit;
  }
  const [ddgHtml, google, ddgIA] = await Promise.all([ddgHtmlSearch(q), googleSearch(q), ddgSearch(q)]);
  return itemsToHit([...ddgHtml, ...google, ...ddgIA]);
}
