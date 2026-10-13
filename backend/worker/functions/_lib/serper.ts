/**
 * 11.8 — Google results through Serper (google.serper.dev), the chat's second
 * web tool: used only on a turn where Gemini's own search grounding does not
 * run (see api/vinaxai.ts). Search results only — no page is fetched.
 *
 * Serper's free allowance is a ONE-TIME 2,500 queries, so every call is
 * guarded, cheapest check first:
 *   1. the edge cache (caches.default): news 15 min, other results 60 min,
 *      an empty answer 2 min — a cache hit spends nothing;
 *   2. a 24 h rest after an answer that says the credits are gone or the key
 *      is refused (401 / 402 / 403 / 429, or a 400 naming credits or quota);
 *   3. a daily cap (SERPER_DAILY_LIMIT, default 80) on successful, non-cached
 *      calls per UTC day, counted from the `web-search` / `serper` rows this
 *      module writes to vinax_ai_events (the same table the owner's AI
 *      Operations panel and spend caps read), plus this isolate's own calls
 *      since the last count.
 * One call asks for at most 10 results (larger pages cost 2 credits).
 *
 * The key (SERPER_API_KEY) is read here only, sent only in the X-API-KEY
 * header to Serper, and never logged or returned. Nothing here throws: every
 * failure is `{ results: [] }` and the chat answers without results.
 */
import { WEB_SEARCH_LOG_MODEL, logAiEvent } from './ai';
import { sbCountResult, supabaseConfigured, type SupabaseEnv } from './supabase';

export interface SerperEnv extends SupabaseEnv {
  SERPER_API_KEY?: string;
  /** Plain var: successful non-cached calls allowed per UTC day. Default 80. */
  SERPER_DAILY_LIMIT?: string;
}

export interface SerperResult {
  url: string;
  title: string;
  snippet: string;
  /** 12.0 — the result's own picture, when Serper returned one (news photos). */
  image?: string;
}

export interface SerperSearch {
  results: SerperResult[];
  quick?: string;
  /** 12.0 — the knowledge panel's picture, when there is one. No extra credit. */
  hero?: string;
}

export interface SerperOptions {
  /** Ask the news endpoint instead of web results. */
  news?: boolean;
  /** 12.1 — ask the images endpoint (pictures with their titles and pages). */
  images?: boolean;
  /** Two-letter country code for `gl`; anything else means "in". */
  country?: string | null;
  /** Two-letter language code for `hl`; anything else means "en". */
  lang?: string | null;
  /** The route's waitUntil, so the cache write and the log row outlive the response. */
  waitUntil?: (p: Promise<unknown>) => void;
  /** Origin the cache key is built on (the request's own); a fixed internal one otherwise. */
  cacheOrigin?: string;
  /** 11.9 — run only while today's calls are under this share of the daily cap
   *  (0–1, default 1). Background jobs pass less, so listeners' searches keep priority. */
  capShare?: number;
  client?: 'web' | 'app';
}

export const SERPER_SEARCH_URL = 'https://google.serper.dev/search';
export const SERPER_NEWS_URL = 'https://google.serper.dev/news';
export const SERPER_IMAGES_URL = 'https://google.serper.dev/images';
/** The vinax_ai_events `model` value of a Serper call (feature `web-search`). */
export const SERPER_LOG_MODEL = WEB_SEARCH_LOG_MODEL;
export const SERPER_DEFAULT_DAILY_LIMIT = 80;
/** Never above 10: a larger page costs 2 credits. */
export const SERPER_NUM = 10;
export const SERPER_TIMEOUT_MS = 5_000;
const MAX_RESULTS = 5;
/** 12.1 — pictures kept from an image search. */
const MAX_IMAGES = 6;
const TITLE_MAX = 160;
const SNIPPET_MAX = 400;
const QUICK_MAX = 400;
const NEWS_TTL_S = 15 * 60;
const WEB_TTL_S = 60 * 60;
const EMPTY_TTL_S = 2 * 60;
const EXHAUSTED_REST_MS = 24 * 60 * 60_000;
const COUNT_TTL_MS = 60_000;
const COUNT_RETRY_MS = 15_000;
const COUNT_READ_TIMEOUT_MS = 2_000;
const DEFAULT_ORIGIN = 'https://serper-cache.vinax.internal';

// ---------------------------------------------------------------- isolate state

let exhaustedUntil = 0;
let exhaustedLogged = false;
let countState: { day: string; db: number; local: number; refreshAt: number } | null = null;

/** Tests only: forget the rest, the count and the logged flag. */
export function resetSerperState(): void {
  exhaustedUntil = 0;
  exhaustedLogged = false;
  countState = null;
}

/** True while an out-of-credits / refused-key answer is being respected. */
export function serperResting(now = Date.now()): boolean {
  return now < exhaustedUntil;
}

// ---------------------------------------------------------------- pure helpers

/** The key, trimmed; null when unset or blank. */
export function serperKey(env: SerperEnv): string | null {
  const k = typeof env.SERPER_API_KEY === 'string' ? env.SERPER_API_KEY.trim() : '';
  return k || null;
}

/** SERPER_DAILY_LIMIT as a non-negative integer (0 = no calls); 80 when unset or invalid. */
export function serperDailyLimit(env: SerperEnv): number {
  const raw = typeof env.SERPER_DAILY_LIMIT === 'string' ? env.SERPER_DAILY_LIMIT.trim() : '';
  if (!/^\d{1,6}$/.test(raw)) return SERPER_DEFAULT_DAILY_LIMIT;
  return Number(raw);
}

/** Lowercased, whitespace collapsed, trimmed — the cache's view of a query. */
export function normaliseQuery(q: string): string {
  return q.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Text only: tags dropped, the common entities decoded, whitespace collapsed, clipped. */
export function plainText(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  const s = v
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/[<>]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

function httpUrl(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 2048) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Serper's JSON → at most 5 http(s) results (title ≤ 160, snippet ≤ 400) and an optional quick answer. Pure. */
export function mapSerperResponse(json: unknown, news = false, images = false): SerperSearch {
  if (!isObj(json)) return { results: [] };
  const list = json[images ? 'images' : news ? 'news' : 'organic'];
  const results: SerperResult[] = [];
  const seen = new Set<string>();
  const max = images ? MAX_IMAGES : MAX_RESULTS;
  if (Array.isArray(list)) {
    for (const item of list) {
      if (results.length >= max) break;
      if (!isObj(item)) continue;
      const url = httpUrl(item.link);
      if (!url || seen.has(url)) continue;
      const title = plainText(item.title, TITLE_MAX);
      if (!title) continue;
      seen.add(url);
      const image = httpUrl(item.imageUrl) ?? (images ? httpUrl(item.thumbnailUrl) : null) ?? undefined;
      // 12.1 — an image result must have its picture; its snippet is the site's name.
      if (images && !image) continue;
      results.push({ url, title, snippet: plainText(images ? item.source : item.snippet, SNIPPET_MAX), ...(image ? { image } : {}) });
    }
  }
  const box = isObj(json.answerBox) ? json.answerBox : null;
  const graph = isObj(json.knowledgeGraph) ? json.knowledgeGraph : null;
  const quick = plainText(box?.answer, QUICK_MAX) || plainText(box?.snippet, QUICK_MAX) || plainText(graph?.description, QUICK_MAX);
  const hero = httpUrl(graph?.imageUrl) ?? undefined;
  return { results, ...(quick ? { quick } : {}), ...(hero ? { hero } : {}) };
}

/** Does this answer mean "no more credits" (or a refused key)? Pure. */
export function creditsExhausted(status: number, body: string): boolean {
  if (status === 401 || status === 402 || status === 403 || status === 429) return true;
  return status === 400 && /credit|quota/i.test(body);
}

const COUNTRY = /^[a-z]{2}$/;
const LANG = /^[a-z]{2}$/;
export function serperCountry(c: unknown): string {
  const s = typeof c === 'string' ? c.trim().toLowerCase() : '';
  return COUNTRY.test(s) ? s : 'in';
}
export function serperLang(l: unknown): string {
  const s = typeof l === 'string' ? l.trim().toLowerCase().slice(0, 2) : '';
  return LANG.test(s) ? s : 'en';
}

/** The synthetic GET the edge cache stores a result under: endpoint + normalised query + gl. */
export function serperCacheKey(origin: string, news: boolean, query: string, gl: string, images = false): Request {
  const base = /^https?:\/\/[^/]+$/.test(origin) ? origin : DEFAULT_ORIGIN;
  return new Request(`${base}/__serper/${images ? 'images' : news ? 'news' : 'search'}?q=${encodeURIComponent(normaliseQuery(query))}&gl=${gl}`, { method: 'GET' });
}

// ---------------------------------------------------------------- query building

const FILE_BLOCK = '--- File:';
const QUERY_MAX = 300;
const REFERENCE_START = /^(?:it|its|it's|he|she|they|them|their|that|this|those|these|him|her)\b/i;
const REFERENCE_ANYWHERE = /\b(?:it|its|it's|they|them|their|he|she|him|her)\b/i;
const STOP = new Set(
  'a an the and or but if of to in on at for from by with about as is are was were be been being do does did have has had i me my we our you your he she it they them this that these those what when where who whom which why how can could would should will shall may might must please tell show give find search look up just also any some more most very so than then there here not no yes ok okay hey hi hello vinax ai'.split(' '),
);

/** One message as plain query text: attached file text and fenced code removed, links reduced to their host. Pure. */
export function cleanForQuery(text: string): string {
  let s = typeof text === 'string' ? text : '';
  const file = s.indexOf(FILE_BLOCK);
  if (file >= 0) s = s.slice(0, file);
  return s
    .replace(/```[\s\S]*?(?:```|$)/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    // 11.8.1 — a link becomes its site's name only: never a path or a query
    // string (they can carry ids or tokens), but "what is this site?" still searches.
    .replace(/\bhttps?:\/\/[^\s/?#]+\S*/gi, (u) => linkHost(u))
    .replace(/\bwww\.[^\s/?#]+\S*/gi, (u) => linkHost(`https://${u}`))
    .replace(/\s+/g, ' ')
    .trim();
}

function linkHost(u: string): string {
  try {
    const host = new URL(u).hostname.replace(/^www\./, '');
    return ` ${host} `;
  } catch {
    return ' ';
  }
}

/** 11.8.1 — a website named in the text: a link, or a bare domain on a common
 *  suffix ("sportsmart.com", "example.co.in"). Not an email address, not a
 *  file name (index.js). Pure. */
const SITE = /(?:^|[\s(<"'“‘])(?:https?:\/\/|www\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|in|io|co|ai|app|dev|me|info|online|site|store|shop|xyz|tech|edu|gov|uk|us|tv|biz|news|blog|live|today|world|page|link|so|gg|fm|ly|to)(?:\.[a-z]{2})?(?:[/?#][^\s]*)?(?=$|[\s)>"'”’,.!?:;])/i;
export function mentionsSite(text: string): boolean {
  return typeof text === 'string' && SITE.test(text);
}

function contentWords(text: string, max: number): string[] {
  const words = cleanForQuery(text)
    .split(' ')
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter((w) => w && !STOP.has(w.toLowerCase()));
  return words.slice(0, max);
}

/**
 * 11.8 — the search query for one chat turn. Built from the latest user
 * message ONLY (never taste, memory, project, profile or place text): attached
 * files and fenced code stripped, links cut to their host, whitespace collapsed, ≤ 300 chars. A
 * short or pronoun-led follow-up ("when is it releasing?") gets up to 8
 * content words of the previous user message in front. Pure.
 */
export function buildSearchQuery(latest: string, previous?: string | null): string {
  const clip = (s: string): string => (s.length > QUERY_MAX ? s.slice(0, QUERY_MAX).trim() : s);
  const q = clip(cleanForQuery(latest));
  if (!q) return '';
  const words = q.split(' ').filter(Boolean);
  // Short, pronoun-led, or a short question that leans on "it"/"they"/… ("when is it releasing?").
  // A message that names a website is about that site: no borrowed words.
  const needsContext = !mentionsSite(q) && (words.length < 4 || REFERENCE_START.test(q) || (words.length <= 8 && REFERENCE_ANYWHERE.test(q)));
  const extra = needsContext && previous ? contentWords(previous, 8) : [];
  const lowerQ = q.toLowerCase();
  const prefix = extra.filter((w) => !lowerQ.includes(w.toLowerCase()));
  return clip(prefix.length ? `${prefix.join(' ')} ${q}` : q);
}

// ---------------------------------------------------------------- edge cache

interface EdgeCache {
  match(key: Request): Promise<Response | undefined>;
  put(key: Request, res: Response): Promise<void>;
}
function edgeCache(): EdgeCache | null {
  const c = (globalThis as { caches?: { default?: EdgeCache } }).caches;
  return c?.default ?? null;
}

async function cacheRead(key: Request): Promise<SerperSearch | null> {
  const cache = edgeCache();
  if (!cache) return null;
  try {
    const hit = await cache.match(key);
    if (!hit) return null;
    const j = (await hit.json()) as unknown;
    if (!isObj(j) || !Array.isArray(j.results)) return null;
    const results = (j.results as unknown[])
      .filter(isObj)
      .map((r) => {
        const image = httpUrl(r.image) ?? undefined;
        return { url: String(r.url ?? ''), title: String(r.title ?? ''), snippet: String(r.snippet ?? ''), ...(image ? { image } : {}) };
      })
      .filter((r) => httpUrl(r.url) && r.title);
    const hero = httpUrl(j.hero) ?? undefined;
    return { results, ...(typeof j.quick === 'string' && j.quick ? { quick: j.quick } : {}), ...(hero ? { hero } : {}) };
  } catch {
    return null;
  }
}

function cacheWrite(key: Request, value: SerperSearch, ttl: number, waitUntil?: (p: Promise<unknown>) => void): void {
  const cache = edgeCache();
  if (!cache) return;
  const res = new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${ttl}` } });
  const put = cache.put(key, res).catch(() => undefined);
  if (waitUntil) waitUntil(put);
}

// ---------------------------------------------------------------- daily cap

const utcDay = (t: number): string => new Date(t).toISOString().slice(0, 10);

/** Successful non-cached Serper calls today (UTC): the logged rows, plus this isolate's since the last read. */
export async function serperCallsToday(env: SerperEnv, now = Date.now()): Promise<number> {
  const day = utcDay(now);
  if (countState && countState.day !== day) countState = null;
  if (!supabaseConfigured(env)) return countState?.local ?? 0;
  if (countState && now < countState.refreshAt) return countState.db + countState.local;
  const r = await sbCountResult(
    env,
    'vinax_ai_events',
    `feature=eq.web-search&model=eq.${SERPER_LOG_MODEL}&ok=eq.true&created_at=gte.${encodeURIComponent(`${day}T00:00:00.000Z`)}`,
    { timeoutMs: COUNT_READ_TIMEOUT_MS },
  ).catch(() => ({ ok: false as const }));
  if (r.ok) {
    // A row this isolate wrote moments ago may not be readable yet; never let the fresh count fall below what is known.
    const known = countState ? countState.db + countState.local : 0;
    countState = { day, db: Math.max(r.value, known), local: 0, refreshAt: now + COUNT_TTL_MS };
  } else {
    // A failed read keeps what is known (this isolate's own calls at least) and retries soon.
    countState = { day, db: countState?.db ?? 0, local: countState?.local ?? 0, refreshAt: now + COUNT_RETRY_MS };
  }
  return countState.db + countState.local;
}

function noteCall(now: number): void {
  const day = utcDay(now);
  if (!countState || countState.day !== day) countState = { day, db: 0, local: 0, refreshAt: 0 };
  countState.local += 1;
}

// ---------------------------------------------------------------- the call

/**
 * Search Google through Serper. Never throws; `{ results: [] }` on no key, an
 * empty query, the daily cap, the out-of-credits rest, a timeout, a non-2xx
 * answer or an unreadable body.
 */
export async function serperSearch(env: SerperEnv, query: string, opts: SerperOptions = {}): Promise<SerperSearch> {
  const empty: SerperSearch = { results: [] };
  try {
    const key = serperKey(env);
    const q = typeof query === 'string' ? query.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
    if (!key || !q) return empty;
    const images = opts.images === true;
    const news = !images && opts.news === true;
    const gl = serperCountry(opts.country);
    const hl = serperLang(opts.lang);
    const cacheKey = serperCacheKey(opts.cacheOrigin ?? DEFAULT_ORIGIN, news, q, gl, images);

    const cached = await cacheRead(cacheKey);
    if (cached) return cached;

    const now = Date.now();
    if (serperResting(now)) return empty;
    const limit = serperDailyLimit(env);
    const share = typeof opts.capShare === 'number' && opts.capShare >= 0 && opts.capShare <= 1 ? opts.capShare : 1;
    const allowed = Math.floor(limit * share);
    if (allowed <= 0 || (await serperCallsToday(env, now)) >= allowed) return empty;

    const t0 = Date.now();
    let status = 0;
    let error: string | null = null;
    let out: SerperSearch = empty;
    try {
      const res = await fetch(images ? SERPER_IMAGES_URL : news ? SERPER_NEWS_URL : SERPER_SEARCH_URL, {
        method: 'POST',
        headers: { 'X-API-KEY': key, 'content-type': 'application/json' },
        body: JSON.stringify({ q, gl, hl, num: SERPER_NUM }),
        signal: AbortSignal.timeout(SERPER_TIMEOUT_MS),
      });
      status = res.status;
      if (res.ok) {
        out = mapSerperResponse(await res.json(), news, images);
        noteCall(Date.now());
      } else {
        const body = (await res.text().catch(() => '')).slice(0, 2000);
        if (creditsExhausted(res.status, body)) {
          exhaustedUntil = Date.now() + EXHAUSTED_REST_MS;
          error = 'credits_exhausted';
          if (!exhaustedLogged) {
            exhaustedLogged = true;
            console.warn(`[serper] answered ${res.status}: out of credits or key refused — web search rests for 24 h in this isolate`);
          }
        } else {
          error = `http_${res.status}`;
        }
      }
    } catch (e) {
      error = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'timeout' : 'network';
    }
    const ok = error === null;
    const log = logAiEvent(env, { feature: 'web-search', model: SERPER_LOG_MODEL, ok, status, error, client: opts.client ?? 'web', latency_ms: Date.now() - t0 });
    if (opts.waitUntil) opts.waitUntil(log);
    if (ok) cacheWrite(cacheKey, out, out.results.length || out.quick ? (news ? NEWS_TTL_S : WEB_TTL_S) : EMPTY_TTL_S, opts.waitUntil);
    return out;
  } catch {
    return empty;
  }
}
