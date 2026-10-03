/**
 * 9.1.0 — ONE live-web music-discovery path, shared by every surface that wants
 * current music: the AI DJ, queues, the AI Playlist, Radio and Home.
 *
 * Why it exists. Before 9.1 this codebase had two separate things and neither
 * reached the music:
 *
 *   - `_lib/websearch.ts` (the owner's metasearch instance) was called by
 *     exactly two routes: /api/vinaxai (the chat) and the admin health probe.
 *     No music-generation path used it at all.
 *   - `_lib/trends/*` ingests public charts properly, but its output only ever
 *     became a small SCORE BONUS on songs the catalogue had already returned
 *     (services/trends/signal.ts), so a current song the catalogue searches
 *     missed could never be recommended.
 *
 * What this adds: a bounded path that searches the live web for what is current
 * in a region and language, extracts song/artist pairs FROM THE RETRIEVED TEXT,
 * resolves each one against the real catalogue, and returns only the ones that
 * resolved — with their evidence attached.
 *
 * The honesty rules, which are the point of the module:
 *
 *   - Every item carries the source URL it came from, what KIND of source that
 *     is, when we observed it, and the publication date ONLY when the search
 *     engine reported one. Nothing is inferred.
 *   - A measured chart position is never confused with an editorial list, a
 *     release announcement or an ordinary search result: `sourceType` says
 *     which, and `rank` is set only for a chart-shaped source that stated one.
 *   - Chart rank, popularity growth, release date, stream counts and artist
 *     facts are NEVER invented or derived. If the evidence does not state it,
 *     the field is null.
 *   - An extraction that does not resolve to a real catalogue recording is
 *     DROPPED, not guessed at. So is one that cites a source index the search
 *     did not return — the model cannot smuggle in a song by inventing a
 *     citation.
 *   - Retrieved web text is UNTRUSTED DATA. It reaches the model only inside
 *     `fenceWebContext`, and nothing in it is ever treated as instructions.
 *
 * Boundedness: one deadline for the whole run, a hard cap on searches, a cap on
 * catalogue lookups, per-isolate request coalescing (two callers asking the same
 * question share one run), and a per-isolate quota so a hot path cannot spend
 * the instance's budget. Playback never waits on any of it — callers read a
 * CACHED answer and let a refresh happen behind them.
 */
import { chat, extractJson, type AiEnv } from './ai';
import { canonicalKey } from './identityCore';
import { resolveSuggestions, type Suggestion } from './playlistResolve';
import { fenceWebContext, type WebSearchEnv } from './websearch';
import { searxngConfigured, searxngQuery, type SearxngEnv, type SearxngResult } from './searxng';

export type DiscoveryEnv = AiEnv & WebSearchEnv & SearxngEnv;

/** What kind of page an item's evidence came from. */
export type DiscoverySourceType =
  /** A page that publishes a measured chart (positions, a chart week). */
  | 'chart'
  /** A hand-made list: "best new songs", a playlist write-up, a review round-up. */
  | 'editorial'
  /** A release announcement: a label, an artist's own page, a music-news release item. */
  | 'release'
  /** An ordinary search result that is none of the above. */
  | 'search-result';

export interface DiscoveryEvidence {
  url: string;
  title: string;
  sourceType: DiscoverySourceType;
  /** When WE ran the search (always known). */
  observedAt: string;
  /** What the search engine reported as the page's date. Null when it reported none. */
  publishedAt: string | null;
  /** A chart or coverage period the page's own text stated, e.g. "2026-W40". Null otherwise. */
  period: string | null;
}

export interface Discovery {
  /** The catalogue recording this resolved to. */
  catalogId: string;
  title: string;
  artist: string;
  language: string | null;
  /** How sure we are that the catalogue song IS the one the evidence named. */
  matchConfidence: number;
  /** The strongest kind of source behind it (chart > release > editorial > search-result). */
  sourceType: DiscoverySourceType;
  /**
   * A position the evidence ITSELF stated, on a chart-shaped source. Null in
   * every other case — including when the model offered a number.
   */
  rank: number | null;
  evidence: DiscoveryEvidence[];
}

export type DiscoveryState =
  /** Fresh evidence, resolved items. */
  | 'ok'
  /** We have items, but the evidence behind them is older than FRESH_MS. */
  | 'stale'
  /** The search instance is not configured on this deployment. */
  | 'not_configured'
  /** The instance is resting after failures, or the quota for this isolate is spent. */
  | 'resting'
  /** Searching worked but nothing resolved to a real recording. */
  | 'empty'
  /** No AI lane is configured, so retrieved text cannot be read into song names. */
  | 'no_reader'
  /** The search or the read failed. */
  | 'failed';

export interface DiscoveryResult {
  state: DiscoveryState;
  items: Discovery[];
  /** When the evidence behind `items` was observed. Null when there is none. */
  evidenceAt: string | null;
  /** Searches actually issued for this answer. */
  searches: number;
  /** Plain words an owner (or a shelf) can show. Never claims success. */
  note: string;
}

export interface DiscoveryQuery {
  /** ISO 3166-1 alpha-2, uppercase. */
  region: string;
  /** Catalogue language id ("telugu"), lower-case. Null = no language named. */
  language: string | null;
  /** What the caller wants: new releases, what is charting, or a free-text mood. */
  intent: DiscoveryIntent;
  /** The clock, so the queries name today's date. */
  now?: number;
}

export type DiscoveryIntent = 'new-releases' | 'charting' | 'trending-songs';

/* ---------------- budgets ---------------- */

/** Searches one run may issue. */
export const MAX_SEARCHES = 3;
/** Results kept per search. */
const RESULTS_PER_SEARCH = 8;
/** Song/artist pairs the reader may extract. */
const MAX_EXTRACTIONS = 18;
/** Catalogue resolutions one run may spend. */
const MAX_RESOLVES = 14;
/** Whole-run wall clock. */
export const RUN_BUDGET_MS = 14_000;
/** One search's leash. */
const SEARCH_TIMEOUT_MS = 6_000;
/** The reader's leash. */
const READ_TIMEOUT_MS = 7_000;
/** Evidence older than this is `stale`: still useful, but labelled. */
export const FRESH_MS = 6 * 3_600_000;
/**
 * The time window a cached answer belongs to: one UTC day. "What is current in
 * Telugu music" is a question about a day, so yesterday's evidence is a
 * different question, not a stale answer to this one. Inside the day the AGE
 * checks decide whether an answer is `ok` or `stale`.
 */
export const CACHE_WINDOW_MS = 86_400_000;
/** A cached entry older than this is dropped outright. */
export const CACHE_MAX_AGE_MS = 86_400_000;
/** How long an answer is worth serving before a refresh is worth starting (edge cache-control). */
export const CACHE_TTL_MS = 60 * 60_000;
/** Runs one isolate may perform per hour, whatever the cache says. */
export const QUOTA_PER_HOUR = 12;
/** After this many consecutive failures the breaker opens for BREAKER_REST_MS. */
const BREAKER_TRIP = 3;
const BREAKER_REST_MS = 15 * 60_000;

/* ---------------- source classification ---------------- */

/**
 * What kind of page a result is, from its URL and its own words. Deliberately
 * conservative: anything we cannot place is a plain `search-result`, which is
 * the weakest kind, so a misread can only ever UNDERSTATE the evidence.
 */
const CHART_WORDS = /\b(chart|charts|top\s?\d{1,3}|hot\s?\d{1,3}|billboard|countdown|most[- ]streamed|weekly\s+top)\b/i;
const EDITORIAL_WORDS = /\b(best|greatest|must[- ]hear|playlist|picks|recommend\w*|round[- ]?up|review|essential)\b/i;
const RELEASE_WORDS = /\b(released?|release\s+date|out\s+now|drops?|premiere|new\s+(?:single|album|song|track|ep)|announce\w*|unveil\w*)\b/i;

export function classifySource(result: Pick<SearxngResult, 'title' | 'content' | 'url'>): DiscoverySourceType {
  const text = `${result.title} ${result.content}`;
  // A URL we cannot parse contributes nothing (and must not throw).
  const path = ((): string => {
    try {
      return new URL(result.url).pathname;
    } catch {
      return '';
    }
  })();
  const haystack = `${text} ${path}`;
  // Order matters: a chart page that also says "best" is still a chart.
  if (CHART_WORDS.test(haystack)) return 'chart';
  if (RELEASE_WORDS.test(haystack)) return 'release';
  if (EDITORIAL_WORDS.test(haystack)) return 'editorial';
  return 'search-result';
}

const TYPE_RANK: Record<DiscoverySourceType, number> = { chart: 3, release: 2, editorial: 1, 'search-result': 0 };

/** A chart or coverage period the text states, as an ISO-ish string. Null otherwise. */
export function readPeriod(text: string): string | null {
  const week = /\b(20\d{2})[-\s]?W(\d{1,2})\b/i.exec(text);
  if (week) return `${week[1]}-W${week[2].padStart(2, '0')}`;
  const month = /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(20\d{2})\b/i.exec(text);
  if (month) {
    const n = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'].indexOf(month[1].toLowerCase()) + 1;
    return `${month[2]}-${String(n).padStart(2, '0')}`;
  }
  const day = /\b(20\d{2})-(\d{2})-(\d{2})\b/.exec(text);
  return day ? day[0] : null;
}

/* ---------------- queries ---------------- */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * The searches one run issues: today's date, the region, the language and the
 * intent, in the words these pages actually use. Capped at MAX_SEARCHES.
 *
 * The region is named as a country code only when no language was given — a
 * language is the far stronger signal for this catalogue, and naming both tends
 * to return travel pages.
 */
export function discoveryQueries(q: DiscoveryQuery): string[] {
  const now = new Date(q.now ?? Date.now());
  const month = `${MONTHS[now.getUTCMonth()]} ${now.getUTCFullYear()}`;
  const year = String(now.getUTCFullYear());
  const lang = q.language ? q.language.replace(/[^a-z ]/gi, '').trim() : '';
  const where = lang || (/^[A-Z]{2}$/.test(q.region) ? q.region : '');
  const out: string[] = [];
  const add = (text: string): void => {
    const query = text.replace(/\s+/g, ' ').trim();
    if (query && !out.includes(query) && out.length < MAX_SEARCHES) out.push(query);
  };
  if (q.intent === 'charting') {
    add(`${where} songs chart ${month}`);
    add(`top ${where} songs this week ${year}`);
    add(`most streamed ${where} songs ${month}`);
  } else if (q.intent === 'new-releases') {
    add(`new ${where} songs released ${month}`);
    add(`${where} new song releases ${month}`);
    add(`latest ${where} music ${year}`);
  } else {
    add(`trending ${where} songs ${month}`);
    add(`popular ${where} songs right now ${year}`);
    add(`${where} music ${month} new and trending`);
  }
  return out;
}

/* ---------------- the reader ---------------- */

const READER_SYSTEM =
  'You read supplied web search results and list the songs they name. You never add a song that is not named in the results, and you never state a fact the results do not state. Reply with JSON only.';

const READER_RULES = `From the WEB RESULTS above, list every SONG the results name, with its artist.

Rules:
- Only songs the results actually name. If the results name no songs, return an empty list.
- "source" is the [n] number of the result you took the song from. Use one you were given.
- "rank" ONLY when that result states a numbered chart position for the song. Otherwise null. Never guess, never count list order as a rank.
- Do not output release dates, stream counts, chart movement or any claim about the artist.
- Do not output film names, album names, playlist names or channel names as songs.
Return ONLY {"songs":[{"title":"...","artist":"...","source":1,"rank":null}]} with at most ${MAX_EXTRACTIONS} songs.`;

interface RawExtraction {
  title: string;
  artist: string;
  /** 1-based index into the results we supplied. */
  source: number;
  rank: number | null;
}

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  return t && t.length <= max ? t : null;
};

/**
 * Validate the reader's answer against the results we actually supplied.
 * Anything citing a source we did not give it is dropped — that is the check
 * that stops an invented song arriving with a plausible-looking citation.
 */
export function readExtractions(raw: unknown, resultCount: number): RawExtraction[] {
  const list = raw && typeof raw === 'object' && Array.isArray((raw as { songs?: unknown }).songs) ? (raw as { songs: unknown[] }).songs : Array.isArray(raw) ? raw : [];
  const out: RawExtraction[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (out.length >= MAX_EXTRACTIONS) break;
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const title = text(r.title, 120);
    const artist = text(r.artist, 120);
    const source = Number(r.source);
    if (!title || !artist) continue;
    if (!Number.isInteger(source) || source < 1 || source > resultCount) continue;
    const key = canonicalKey(title, artist);
    if (!key || key === '|' || seen.has(key)) continue;
    seen.add(key);
    const rankRaw = Number(r.rank);
    const rank = Number.isInteger(rankRaw) && rankRaw >= 1 && rankRaw <= 200 ? rankRaw : null;
    out.push({ title, artist, source, rank });
  }
  return out;
}

/* ---------------- breaker, quota, coalescing ---------------- */

let failures = 0;
let breakerUntil = 0;
let quotaWindowStart = 0;
let quotaUsed = 0;
const inFlight = new Map<string, Promise<DiscoveryResult>>();
const cache = new Map<string, { at: number; result: DiscoveryResult }>();
const CACHE_CAP = 24;

/** Tests, and the admin console's "clear": forget the breaker, quota and cache. */
export function resetDiscoveryState(): void {
  failures = 0;
  breakerUntil = 0;
  quotaWindowStart = 0;
  quotaUsed = 0;
  inFlight.clear();
  cache.clear();
}

export function discoveryCacheKey(q: DiscoveryQuery, now = Date.now()): string {
  // Region, language, intent AND the time window the evidence describes: a
  // shared key would hand yesterday's chart back as today's answer.
  const window = Math.floor(now / CACHE_WINDOW_MS);
  return `${q.region}|${q.language ?? ''}|${q.intent}|${window}`;
}

function quotaSpent(now: number): boolean {
  if (now - quotaWindowStart >= 3_600_000) {
    quotaWindowStart = now;
    quotaUsed = 0;
  }
  return quotaUsed >= QUOTA_PER_HOUR;
}

export interface DiscoveryHealth {
  configured: boolean;
  breakerOpen: boolean;
  breakerRestMs: number;
  consecutiveFailures: number;
  quotaUsed: number;
  quotaPerHour: number;
  cached: number;
}

export function discoveryHealth(env: DiscoveryEnv, now = Date.now()): DiscoveryHealth {
  return {
    configured: searxngConfigured(env),
    breakerOpen: now < breakerUntil,
    breakerRestMs: Math.max(0, breakerUntil - now),
    consecutiveFailures: failures,
    quotaUsed: now - quotaWindowStart >= 3_600_000 ? 0 : quotaUsed,
    quotaPerHour: QUOTA_PER_HOUR,
    cached: cache.size,
  };
}

const fail = (state: DiscoveryState, note: string, searches = 0): DiscoveryResult => ({ state, items: [], evidenceAt: null, searches, note });

/**
 * A cached answer for this question, when there is one. Never searches. This is
 * what a playback path reads: a song transition must never wait on the web.
 */
export function cachedDiscovery(q: DiscoveryQuery, now = Date.now()): DiscoveryResult | null {
  const hit = cache.get(discoveryCacheKey(q, now));
  if (!hit) return null;
  const age = now - hit.at;
  if (age > CACHE_MAX_AGE_MS) return null;
  const evidenceAge = hit.result.evidenceAt ? now - Date.parse(hit.result.evidenceAt) : Infinity;
  if (hit.result.state === 'ok' && evidenceAge > FRESH_MS) {
    return { ...hit.result, state: 'stale', note: 'Evidence is more than six hours old.' };
  }
  return hit.result;
}

/**
 * Discover current music for one question. Coalesced (two callers asking the
 * same thing share one run) and cached. Never throws.
 */
export async function discoverMusic(env: DiscoveryEnv, q: DiscoveryQuery): Promise<DiscoveryResult> {
  const now = q.now ?? Date.now();
  const key = discoveryCacheKey(q, now);
  const cachedResult = cachedDiscovery(q, now);
  if (cachedResult && cachedResult.state !== 'failed') return cachedResult;
  const running = inFlight.get(key);
  if (running) return running;
  const run = runDiscovery(env, q, now)
    .then((result) => {
      if (result.state === 'ok' || result.state === 'empty') {
        failures = 0;
        cache.delete(key);
        cache.set(key, { at: now, result });
        if (cache.size > CACHE_CAP) cache.delete(cache.keys().next().value as string);
      } else if (result.state === 'failed') {
        failures += 1;
        if (failures >= BREAKER_TRIP) {
          // Operational state runs on the real clock, never the logical one.
          breakerUntil = Date.now() + BREAKER_REST_MS;
          failures = 0;
        }
      }
      return result;
    })
    .catch(() => fail('failed', 'The discovery run did not complete.'))
    .finally(() => inFlight.delete(key));
  inFlight.set(key, run);
  return run;
}

/**
 * `stamp` is the LOGICAL clock: it decides the dates the queries name, the
 * `observedAt` we record and which cache window the answer belongs to. Timing —
 * the run deadline, the breaker and the quota — always uses the real clock, so
 * a caller that passes a fixed `stamp` (a test, a replay) cannot accidentally
 * put the deadline in the past.
 */
async function runDiscovery(env: DiscoveryEnv, q: DiscoveryQuery, stamp: number): Promise<DiscoveryResult> {
  if (!searxngConfigured(env)) return fail('not_configured', 'No web search instance is configured on this deployment.');
  const startedAt = Date.now();
  if (startedAt < breakerUntil) return fail('resting', 'Web discovery is resting after repeated failures.');
  if (quotaSpent(startedAt)) return fail('resting', 'This instance has used its discovery budget for the hour.');
  quotaUsed += 1;
  const now = stamp;
  const deadlineAt = startedAt + RUN_BUDGET_MS;

  // 1 — search. Untrusted text from arbitrary pages.
  const queries = discoveryQueries({ ...q, now });
  const searched = await Promise.all(
    queries.map((query) => searxngQuery(env, query, { categories: 'general', limit: RESULTS_PER_SEARCH, timeoutMs: SEARCH_TIMEOUT_MS, tag: 'discovery' })),
  );
  const observedAt = new Date(now).toISOString();
  const results: SearxngResult[] = [];
  const seenUrl = new Set<string>();
  let anyOk = false;
  for (const res of searched) {
    if (res.ok) anyOk = true;
    if (!res.ok) continue;
    for (const r of res.results) {
      if (!r.url || !r.title || seenUrl.has(r.url)) continue;
      seenUrl.add(r.url);
      results.push(r);
    }
  }
  if (!anyOk) return fail('failed', 'The web search instance did not answer.', queries.length);
  if (!results.length) return fail('empty', 'The web search returned no usable results.', queries.length);

  // 2 — read the retrieved text into song names. Fenced: data, never instructions.
  if (Date.now() > deadlineAt) return fail('failed', 'The discovery run ran out of time before reading the results.', queries.length);
  const numbered = results
    .map((r, i) => [`[${i + 1}] ${r.title}`, r.content, r.publishedDate ? `(dated ${r.publishedDate.slice(0, 10)})` : '', r.url].filter(Boolean).join('\n'))
    .join('\n\n');
  const fenced = fenceWebContext('WEB RESULTS', numbered, { purpose: 'list the songs these pages name' });
  let answer: Awaited<ReturnType<typeof chat>>;
  try {
    answer = await chat(
      env,
      [
        { role: 'system', content: READER_SYSTEM },
        { role: 'user', content: `${fenced}\n\n${READER_RULES}` },
      ],
      { lane: 'scholar', ladder: ['scholar', 'fast', 'chat'], json: true, temperature: 0, maxTokens: 900, timeoutMs: READ_TIMEOUT_MS, deadlineAt },
    );
  } catch {
    return fail('failed', 'The reader could not be reached.', queries.length);
  }
  if (!answer.content) {
    return answer.error === 'not_configured'
      ? fail('no_reader', 'No AI engine is configured, so web results cannot be read into song names.', queries.length)
      : fail('failed', 'The reader did not answer.', queries.length);
  }
  const extracted = readExtractions(extractJson(answer.content), results.length);
  if (!extracted.length) return fail('empty', 'The web results named no songs we could use.', queries.length);

  // 3 — resolve every extraction against the real catalogue. An unresolved
  // extraction is DROPPED: a title nobody can play is not a recommendation.
  const suggestions: Suggestion[] = extracted.slice(0, MAX_RESOLVES).map((x) => ({ title: x.title, artist: x.artist }));
  let resolved: Awaited<ReturnType<typeof resolveSuggestions>>;
  try {
    resolved = await resolveSuggestions(suggestions, {
      languages: q.language ? [q.language] : [],
      limit: MAX_RESOLVES,
      batch: 5,
      deadlineAt,
    });
  } catch {
    return fail('failed', 'The catalogue could not be reached to verify the discoveries.', queries.length);
  }
  if (!resolved.length) return fail('empty', 'None of the songs the web named exist in the catalogue.', queries.length);

  // 4 — attach the evidence each one actually came from.
  const byKey = new Map(extracted.map((x) => [canonicalKey(x.title, x.artist), x]));
  const items: Discovery[] = [];
  for (const row of resolved) {
    const found = byKey.get(canonicalKey(row.suggestion.title, row.suggestion.artist));
    const result = found ? results[found.source - 1] : undefined;
    if (!found || !result) continue;
    const sourceType = classifySource(result);
    items.push({
      catalogId: row.song.id,
      title: row.song.title,
      artist: row.song.primaryArtists[0] ?? row.suggestion.artist,
      language: row.song.language ?? null,
      // The catalogue match is exact by construction (playlistResolve only
      // accepts a result that IS the suggestion), so this is the confidence in
      // the MATCH, not in the evidence.
      matchConfidence: canonicalKey(row.song.title, row.song.primaryArtists[0] ?? '') === canonicalKey(found.title, found.artist) ? 1 : 0.85,
      sourceType,
      // A rank only survives from a chart-shaped page that stated one.
      rank: sourceType === 'chart' ? found.rank : null,
      evidence: [
        {
          url: result.url,
          title: result.title,
          sourceType,
          observedAt,
          publishedAt: result.publishedDate,
          period: readPeriod(`${result.title} ${result.content}`),
        },
      ],
    });
  }
  if (!items.length) return fail('empty', 'Nothing could be tied back to a source.', queries.length);
  // Strongest evidence first: a stated chart position, then the source kind.
  items.sort((a, b) => TYPE_RANK[b.sourceType] - TYPE_RANK[a.sourceType] || (a.rank ?? 999) - (b.rank ?? 999));
  return {
    state: 'ok',
    items,
    evidenceAt: observedAt,
    searches: queries.length,
    note: `${items.length} song${items.length === 1 ? '' : 's'} verified against the catalogue from ${seenUrl.size} web result${seenUrl.size === 1 ? '' : 's'}.`,
  };
}
