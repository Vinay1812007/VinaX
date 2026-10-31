/**
 * VinaX AI — web search (docs/ai.md "Web search").
 *
 *   wantsSearch   the toggle is on, or it is on auto and the message has a
 *                 recency cue (today, latest, news, prices, scores, weather,
 *                 "is … open", a recent year, a link or domain…)
 *   buildQuery    the latest message only, links cut to host names, at most
 *                 300 characters; a short follow-up borrows key words from
 *                 the previous question
 *   searchWeb     the search API (Tavily by default, Serper supported):
 *                 cached 15 min (news) / 60 min, under a global daily cap
 *                 (SEARCH_DAILY_LIMIT, default 100, 0 = off), resting a day
 *                 after the provider refuses the key or the credits run out
 *   placeMarkers  turns Gemini grounding's supports into [n] markers in the
 *                 answer text
 *
 * At most one search per turn. A failed search is not an error: the reply
 * is written without it.
 */
import { db, type DbEnv } from '../db';
import type { AiEnv, GroundingSupport, Source } from './types';

export type SearchMode = 'auto' | 'on' | 'off';
export type Topic = 'news' | 'general';

export const MAX_RESULTS = 6;
export const QUERY_MAX = 300;
export const DEFAULT_DAILY_LIMIT = 100;
/** Grounded requests per day: kept under the free tier's 500 (shared by 2.5 Flash and Flash-Lite). */
export const GROUNDING_DAILY_LIMIT = 450;
export const SEARCH_TIMEOUT_MS = 8_000;
export const PROVIDER_REST_MS = 24 * 60 * 60_000;
const CACHE_NEWS_S = 15 * 60;
const CACHE_OTHER_S = 60 * 60;

export const searchMode = (v: unknown): SearchMode => (v === 'on' || v === 'off' ? v : 'auto');

const RECENCY = /\b(today|tonight|tomorrow|yesterday|this (week|weekend|month|year|season)|right now|currently|current|latest|newest|recent(ly)?|breaking|news|headlines?|update[sd]?|announce[ds]?|released?|launch(ed)?|price|prices|cost(s)?|rate|rates|stock|shares?|score[sd]?|result[sd]?|match|fixture|standings|weather|forecast|temperature|election|poll|who won|who is winning|box office|trending|live|schedule|open now|deadline|upcoming|in theatres|ott)\b/i;
const IS_OPEN = /\bis\b[^.?!]{1,60}\bopen\b/i;
// Known top-level domains only: a generic pattern would take file names (utils.py) for sites.
const LINK = /https?:\/\/\S+|\b[a-z0-9-]+(\.[a-z0-9-]+)*\.(com|org|net|in|io|dev|ai|co|gov|edu|info|me|app|news|tv|online|site|xyz|store|shop|blog|tech|music|uk|us|ca|au|de|fr|jp)\b/i;

/** A message that is probably about something current. */
export function hasRecencyCue(text: string, now = new Date()): boolean {
  if (RECENCY.test(text) || IS_OPEN.test(text) || LINK.test(text)) return true;
  const year = now.getUTCFullYear();
  for (const m of text.matchAll(/\b(19|20)\d{2}\b/g)) if (Number(m[0]) >= year - 1) return true;
  return false;
}

export function wantsSearch(text: string, mode: SearchMode, now = new Date()): boolean {
  if (mode === 'off' || !text.trim()) return false;
  return mode === 'on' || hasRecencyCue(text, now);
}

export function topicOf(text: string): Topic {
  return /\b(news|today|tonight|latest|breaking|headlines?|score[sd]?|match|weather|price|prices|stock|election|live)\b/i.test(text) ? 'news' : 'general';
}

const STOP = new Set('a an the and or but of to in on at for with from by about as is are was were be been it its this that these those what which who whom how why when where can could should would will do does did i me my we our you your he she they them their please tell show give explain more also just like than then so if not any some there here'.split(' '));

/** Key words of a question, for a short follow-up's query. */
export function keyWords(text: string, max = 6): string[] {
  const words = text.replace(/https?:\/\/\S+/g, ' ').toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'.-]*/gu) ?? [];
  const out: string[] = [];
  for (const w of words) if (!STOP.has(w) && w.length > 1 && !out.includes(w)) out.push(w);
  return out.slice(0, max);
}

/** The search query: the latest message, links cut to host names, ≤ 300 characters. */
export function buildQuery(latest: string, previousUser?: string | null): string {
  let q = latest
    .replace(/<document[\s\S]*?<\/document>/gi, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/https?:\/\/([^/\s?#]+)\S*/gi, (_all, host: string) => host.replace(/^www\./, ''))
    .replace(/\s+/g, ' ')
    .trim();
  if (previousUser && q.split(' ').length < 4) {
    const borrowed = keyWords(previousUser).filter((w) => !q.toLowerCase().includes(w));
    if (borrowed.length) q = `${borrowed.join(' ')} ${q}`;
  }
  return q.slice(0, QUERY_MAX).trim();
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

const clean = (s: unknown, max: number): string => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** Search results as numbered sources (http(s) links only, no duplicates, at most six). */
export function toSources(raw: Array<{ url?: unknown; title?: unknown; snippet?: unknown }>): Source[] {
  const out: Source[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const url = typeof r.url === 'string' ? r.url.trim() : '';
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    const site = hostOf(url);
    out.push({ n: out.length + 1, url, title: clean(r.title, 200) || site, site, snippet: clean(r.snippet, 500) });
    if (out.length >= MAX_RESULTS) break;
  }
  return out;
}

// ------------------------------------------------------------- providers

type Provider = 'tavily' | 'serper';
export const providerOf = (env: AiEnv): Provider => (String(env.SEARCH_API_PROVIDER ?? '').trim().toLowerCase() === 'serper' ? 'serper' : 'tavily');
export const searchConfigured = (env: AiEnv): boolean => typeof env.SEARCH_API_KEY === 'string' && env.SEARCH_API_KEY.trim().length > 0 && dailyLimit(env) > 0;

export function dailyLimit(env: AiEnv): number {
  const raw = String(env.SEARCH_DAILY_LIMIT ?? '').trim();
  if (!raw) return DEFAULT_DAILY_LIMIT;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_DAILY_LIMIT;
}

const resting = new Map<Provider, number>();
/** Tests only. */
export function _resetSearch(): void {
  resting.clear();
}

async function callProvider(env: AiEnv, provider: Provider, query: string, topic: Topic): Promise<{ ok: true; sources: Source[] } | { ok: false; status: number }> {
  const key = env.SEARCH_API_KEY!.trim();
  const signal = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
  const res = provider === 'serper'
    ? await fetch(`https://google.serper.dev/${topic === 'news' ? 'news' : 'search'}`, {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', 'X-API-KEY': key },
      body: JSON.stringify({ q: query, num: MAX_RESULTS + 2 }),
    })
    : await fetch('https://api.tavily.com/search', {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ query, topic, search_depth: 'basic', max_results: MAX_RESULTS + 2, include_answer: false }),
    });
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    return { ok: false, status: res.status };
  }
  const j = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!j) return { ok: false, status: 502 };
  if (provider === 'serper') {
    const list = (Array.isArray(j.news) ? j.news : Array.isArray(j.organic) ? j.organic : []) as Array<Record<string, unknown>>;
    return { ok: true, sources: toSources(list.map((r) => ({ url: r.link, title: r.title, snippet: r.snippet }))) };
  }
  const list = (Array.isArray(j.results) ? j.results : []) as Array<Record<string, unknown>>;
  return { ok: true, sources: toSources(list.map((r) => ({ url: r.url, title: r.title, snippet: r.content }))) };
}

/** Take one from a global daily allowance (ai_take_daily, schema 5). False when spent or unknown. */
export async function takeDaily(env: DbEnv, kind: 'search' | 'grounding', limit: number): Promise<boolean> {
  if (limit <= 0) return false;
  const r = await db.rpc<boolean>(env, 'ai_take_daily', { p_kind: kind, p_limit: limit });
  return r.ok && r.value === true;
}

async function cacheKey(provider: Provider, topic: Topic, query: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(query.toLowerCase()));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `https://vinax-ai-search.internal/${provider}/${topic}/${hex}`;
}

const edgeCache = (): Cache | null => {
  const c = (globalThis as { caches?: { default?: Cache } }).caches;
  return c?.default ?? null;
};

export type SearchResult =
  | { ok: true; sources: Source[]; cached: boolean; provider: Provider }
  | { ok: false; reason: 'not_configured' | 'resting' | 'daily_limit' | 'failed' | 'empty' };

/** Run the search API once (cache first, then the daily cap, then the provider). Never throws. */
export async function searchWeb(env: AiEnv, query: string, topic: Topic, now = Date.now()): Promise<SearchResult> {
  if (!searchConfigured(env) || !query) return { ok: false, reason: 'not_configured' };
  const provider = providerOf(env);
  if ((resting.get(provider) ?? 0) > now) return { ok: false, reason: 'resting' };
  const cache = edgeCache();
  const key = await cacheKey(provider, topic, query);
  try {
    const hit = cache ? await cache.match(key) : undefined;
    if (hit) {
      const sources = (await hit.json()) as Source[];
      if (Array.isArray(sources) && sources.length) return { ok: true, sources, cached: true, provider };
    }
  } catch { /* a cache miss */ }
  if (!(await takeDaily(env, 'search', dailyLimit(env)))) return { ok: false, reason: 'daily_limit' };
  let out: Awaited<ReturnType<typeof callProvider>>;
  try {
    out = await callProvider(env, provider, query, topic);
  } catch {
    return { ok: false, reason: 'failed' };
  }
  if (!out.ok) {
    // A refused key, spent credits or a rate limit: rest the provider for a day.
    if ([401, 402, 403, 429, 432, 433].includes(out.status)) resting.set(provider, now + PROVIDER_REST_MS);
    return { ok: false, reason: 'failed' };
  }
  if (!out.sources.length) return { ok: false, reason: 'empty' };
  if (cache) {
    const ttl = topic === 'news' ? CACHE_NEWS_S : CACHE_OTHER_S;
    try {
      await cache.put(key, new Response(JSON.stringify(out.sources), { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${ttl}` } }));
    } catch { /* caching is best-effort */ }
  }
  return { ok: true, sources: out.sources, cached: false, provider };
}

// --------------------------------------------------------------- markers

/** UTF-16 index of a UTF-8 byte offset in `text`. */
function charIndexOfByte(text: string, byte: number): number {
  const enc = new TextEncoder();
  let bytes = 0;
  let i = 0;
  for (const ch of text) {
    if (bytes >= byte) return i;
    bytes += enc.encode(ch).length;
    i += ch.length;
  }
  return text.length;
}

export interface Marker {
  /** UTF-16 index in the answer text the marker goes after. */
  at: number;
  ns: number[];
}

/**
 * Where grounding's [n] markers go: after each supported stretch of the
 * answer (found by its text, else by its byte offset), moved to the end of a
 * word, never inside a code block.
 */
export function placeMarkers(text: string, supports: GroundingSupport[]): Marker[] {
  const fences: Array<[number, number]> = [];
  const re = /```[\s\S]*?(```|$)/g;
  for (let m = re.exec(text); m; m = re.exec(text)) fences.push([m.index, m.index + m[0].length]);
  const inFence = (i: number) => fences.some(([a, b]) => i > a && i < b);
  const byAt = new Map<number, Set<number>>();
  let from = 0;
  for (const s of supports) {
    let at = -1;
    if (s.text) {
      const idx = text.indexOf(s.text, Math.max(0, from - s.text.length));
      const found = idx >= 0 ? idx : text.indexOf(s.text);
      if (found >= 0) at = found + s.text.length;
    }
    if (at < 0 && s.endIndex >= 0) at = charIndexOfByte(text, s.endIndex);
    if (at < 0 || at > text.length) continue;
    while (at < text.length && /[\p{L}\p{N}]/u.test(text[at])) at++;
    if (inFence(at)) continue;
    from = at;
    const set = byAt.get(at) ?? new Set<number>();
    for (const n of s.ns) set.add(n);
    byAt.set(at, set);
  }
  return [...byAt.entries()].sort((a, b) => a[0] - b[0]).map(([at, ns]) => ({ at, ns: [...ns].sort((x, y) => x - y) }));
}

/** The text with its markers written in as [n]. */
export function applyMarkers(text: string, markers: Marker[]): string {
  let out = '';
  let last = 0;
  for (const m of [...markers].sort((a, b) => a.at - b.at)) {
    out += text.slice(last, m.at) + m.ns.map((n) => `[${n}]`).join('');
    last = m.at;
  }
  return out + text.slice(last);
}
