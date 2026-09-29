/**
 * 8.3.0 — new songs the open web is talking about, found through the owner's
 * self-hosted SearXNG instance (_lib/searxng.ts). Adapter id `web`.
 *
 * What it reads: per language, two searches in the video category narrowed
 * to the last week — "new <language> songs" and "trending <language> songs
 * this week". A live probe (2026-09-28) showed why the video category: its
 * results are the song uploads themselves, titled the way the video-chart
 * matcher already understands ("Song | Film | Cast | Composer | Label"),
 * while news results were box-office stories and music-category results were
 * mostly unrelated catalogue pages.
 *
 * How titles are extracted: a HEURISTIC, not a model. Song uploads already
 * carry the song's own title, so the job is only to throw away what is not
 * one song — playlists, jukeboxes, "top 10", mashups, generic "new songs"
 * pages, trailers — and to rank what is left by how strongly the searches
 * agree on it (SearXNG's merged score, summed across queries). A model would
 * add cost and a chance to invent a title that no page contains, and every
 * item is checked twice after this anyway.
 *
 * The checks after extraction:
 *   1. the shared matcher (matcher.ts) maps each title to at most one
 *      catalogue recording, with the same thresholds as every source;
 *   2. `requiresReview`: a web mention is not a verified chart, so even a
 *      confident match is filed for the owner's review (ingest.ts) and is
 *      never shown to listeners until a person accepts it.
 *
 * Kind `web` (8.3.1; `editorial` in 8.3.0): no rank semantics and no
 * momentum — its order is search agreement, not an observed chart position —
 * and listeners see it as "found on the web, checked by VinaX", never as an
 * editor's pick. Clients older than 8.3.1 do not know the kind and skip these
 * items.
 */
import { searxngConfigured, searxngLastFailure, searxngQuery, type SearxngResponse, type SearxngStatus } from '../searxng';
import { normalizeIdentityText } from '../identityCore';
import { IMPORT_LANGUAGES } from './importer';
import { parseSourceTitle, scriptLanguage } from './matcher';
import { envList, TrendFetchError, type FetchOptions, type RawTrendItem, type TrendProvider, type TrendsEnv } from './types';

export const WEB_DEFAULT_LABEL = 'New on the web';
export const WEB_DEFAULT_LANGUAGES = ['telugu', 'hindi', 'tamil'];
/** Items kept per language, and per run. */
const PER_LANGUAGE = 12;
const PER_RUN = 30;

/** The languages this source searches (TRENDS_WEB_LANGUAGES, default telugu, hindi, tamil), at most five. */
export function webLanguages(env: TrendsEnv): string[] {
  const list = envList(env.TRENDS_WEB_LANGUAGES).filter((l) => IMPORT_LANGUAGES.includes(l));
  return (list.length ? [...new Set(list)] : WEB_DEFAULT_LANGUAGES).slice(0, 5);
}

export function webQueries(language: string): string[] {
  return [`new ${language} songs`, `trending ${language} songs this week`];
}

/** Pages that list many songs, are about songs, or are not music at all. */
const NOT_ONE_SONG_RE =
  /\b(playlists?|jukebox|mashup|medley|non[\s-]?stop|back\s+to\s+back|all\s+songs|top\s*\d+|\d+\s+(?:best\s+)?songs|hits\s+(?:of|20\d\d)|collection|compilation|trailer|teaser|glimpse|promo|review|reaction|interview|making|bgm|ringtone|whats\s?app|status|shorts?|reels?|karaoke|full\s+movie|news|box\s+office|lyrics?\s+in\s+english|edits?|fashion|shootout|explained|tutorial|vlog|podcast|documentary|documentation|announcement|comedy|prank|funny)\b/i;
/** Generic headline phrasing: "Latest Telugu Romantic Songs", "New Telugu Songs 2026". */
const GENERIC_RE = /\b(?:new|latest|trending|top|best|romantic|sad|love|melody|hit|superhit|super\s+hit|old|dj|folk|devotional)\s+(?:[a-z]+\s+){0,2}songs\b/i;
/** A song upload says it is music: "Full Song", "Lyric Video", "Music Video", "Audio", a named language… */
const MUSIC_WORD_RE = /\b(?:songs?|lyric(?:al)?|lyrics|audio|music\s+video|remix|ost|single|telugu|hindi|tamil|kannada|malayalam|punjabi|marathi|bengali|gujarati|bhojpuri|haryanvi|urdu|odia|assamese|rajasthani|tollywood|bollywood|kollywood)\b/i;
/** …and uses the "Title | Film | …" or "Title - Film" shape. */
const SONG_SHAPE_RE = /\|| [-–—] /;

export interface WebCandidate {
  title: string;
  url: string | null;
  author: string | null;
  /** Search languages that found it, first = strongest. */
  languages: string[];
  score: number;
  engines: string[];
  queries: string[];
  publishedDate: string | null;
  key: string;
}

/** Is this search result one song's upload? Pure; exported for tests. */
export function looksLikeOneSong(title: string): boolean {
  const t = title.trim();
  if (t.length < 4 || t.length > 200) return false;
  if (NOT_ONE_SONG_RE.test(t) || !SONG_SHAPE_RE.test(t) || !MUSIC_WORD_RE.test(t)) return false;
  const parsed = parseSourceTitle(t);
  if (parsed.notASong || parsed.shortForm || !parsed.titles.length) return false;
  // Generic phrasing counts only at the head: "… | Folk Songs Telugu | Label"
  // is a folk song's upload, "Latest Telugu Romantic Songs | …" is a list.
  const heads = [parsed.titles[0], parsed.segments[0] ?? ''];
  if (heads.some((h) => GENERIC_RE.test(h))) return false;
  const lead = parsed.titles[0].trim();
  // A lead that is only a language or a generic word is not a song title.
  return lead.length >= 2 && !/^(?:new|latest|trending|songs?|music|video|audio|[a-z]+ songs?)$/i.test(lead);
}

/**
 * The identity of a mention across runs and languages — and so its
 * `sourceItemId`, which a reviewed mapping is reused by. 8.3.1: every part
 * that tells two songs or two versions apart is in it: the lead title, the
 * film (named "(From X)" or the segment after the title), the version tag
 * (a DJ remix is not the original), a language the title names and, when the
 * title names no film, the uploader. Two uploads of one song with the same
 * film still merge ("Lyrical Video" and "Full Video Song"); "Chuttamalle (DJ
 * Remix) | Devara" and "Chuttamalle Lyrical | Devara" never do. Pure.
 */
export function mentionKey(title: string, author?: string | null): string {
  const p = parseSourceTitle(title);
  const lead = p.titles[0] ?? title;
  const film = p.movie ?? p.segments[1] ?? '';
  const who = film ? '' : normalizeIdentityText(author ?? '');
  return [normalizeIdentityText(lead), normalizeIdentityText(film), p.versionTag, p.languageHint ?? '', who].join('|');
}

/**
 * Merge every search into ranked song candidates: one entry per song (its
 * first upload seen), scored by the sum of SearXNG's merged scores across
 * queries plus a little for every extra engine that agreed, at most
 * PER_LANGUAGE per leading language. Pure; exported for tests.
 */
export function extractWebCandidates(responses: Array<{ language: string; query: string; res: SearxngResponse }>): WebCandidate[] {
  const byKey = new Map<string, WebCandidate>();
  for (const { language, query, res } of responses) {
    for (const r of res.results) {
      if (!looksLikeOneSong(r.title)) continue;
      const key = mentionKey(r.title, r.author);
      const gain = Math.max(0.1, r.score) + 0.25 * Math.max(0, r.engines.length - 1);
      const had = byKey.get(key);
      if (had) {
        had.score += gain;
        if (!had.queries.includes(query)) had.queries.push(query);
        if (!had.languages.includes(language)) had.languages.push(language);
        for (const e of r.engines) if (!had.engines.includes(e)) had.engines.push(e);
        continue;
      }
      byKey.set(key, {
        title: r.title,
        url: r.url.startsWith('https://') ? r.url : null,
        author: r.author,
        languages: [language],
        score: gain,
        engines: [...r.engines],
        queries: [query],
        publishedDate: r.publishedDate,
        key,
      });
    }
  }
  const perLanguage = new Map<string, number>();
  return [...byKey.values()]
    .sort((a, b) => b.score - a.score)
    .filter((c) => {
      const n = perLanguage.get(c.languages[0]) ?? 0;
      perLanguage.set(c.languages[0], n + 1);
      return n < PER_LANGUAGE;
    });
}

async function hashId(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function toRawItems(candidates: WebCandidate[], region: string, observedAt: string): Promise<RawTrendItem[]> {
  const ranked = [...candidates].sort((a, b) => b.score - a.score).slice(0, PER_RUN);
  return Promise.all(
    ranked.map(async (c, i) => {
      const script = scriptLanguage(c.title);
      return {
        source: 'web',
        sourceItemId: `web-${await hashId(c.key)}`,
        sourceUrl: c.url,
        title: c.title,
        credit: c.author,
        region,
        sourceRank: i + 1,
        observedAt,
        languageEvidence: { searchLanguage: c.languages.join(','), ...(script ? { titleScript: script } : {}) },
        statistics: null,
        provenance: { kind: 'web-search', queries: c.queries, engines: c.engines.slice(0, 6), score: Math.round(c.score * 100) / 100, publishedDate: c.publishedDate },
        expiresAt: null,
      } satisfies RawTrendItem;
    }),
  );
}

/** Plain words for a search failure, for the run record. */
function failureText(status: SearxngStatus | string, httpStatus: number | null): string {
  return `${status}${httpStatus ? `, HTTP ${httpStatus}` : ''}`;
}

/** Failures a retry a few seconds later can fix: an overloaded or unreachable instance. */
function retryableFailure(status: SearxngStatus, httpStatus: number | null): boolean {
  if (status === 'timeout' || status === 'network') return true;
  return status === 'http_error' && httpStatus !== null && (httpStatus === 429 || httpStatus >= 500);
}

/**
 * Why a run found nothing usable, as a TrendFetchError — never an empty list:
 * an empty snapshot would be stored as this source's newest and hide every
 * item the owner already accepted. Null when there are songs to store.
 * Exported for tests.
 */
export function webRunFailure(answers: Array<{ res: SearxngResponse }>, candidates: number): TrendFetchError | null {
  const responses = answers.map((a) => a.res);
  if (!responses.some((r) => r.ok)) {
    // A call that found the instance resting says nothing new: report the
    // failure that started the rest, and do not retry into the same rest.
    const real = responses.find((r) => r.status !== 'cooling');
    if (!real) {
      const cause = searxngLastFailure();
      const why = cause ? failureText(cause.status, cause.httpStatus) : 'an earlier failure';
      return new TrendFetchError('searxng_cooling', `The web search instance is resting after a recent failure (${why}); the next run tries again.`, { retryable: false, httpStatus: cause?.httpStatus ?? null });
    }
    return new TrendFetchError(`searxng_${real.status}`, `The web search instance did not answer (${failureText(real.status, real.httpStatus)}).`, {
      retryable: retryableFailure(real.status, real.httpStatus),
      httpStatus: real.httpStatus,
    });
  }
  const found = responses.reduce((n, r) => n + r.results.length, 0);
  if (!found) {
    const down = [...new Set(responses.flatMap((r) => r.unresponsive))].slice(0, 6);
    return new TrendFetchError('web_no_results', `No search returned any result${down.length ? ` (engines not answering: ${down.join(', ')})` : ''}.`, { retryable: true });
  }
  if (!candidates) {
    // The instance works; this week's results just held no single-song upload. Keep the last snapshot.
    return new TrendFetchError('web_no_songs', `The searches returned ${found} results but none looked like one song's upload.`, { retryable: false, skip: true });
  }
  return null;
}

export const webSignalProvider: TrendProvider = {
  id: 'web',
  kind: 'web',
  chart: 'web-new-songs',
  snapshotPolicy: 'hourly',
  displayHours: 72,
  requiresReview: true,
  // Last in the registry, and at most a third of a run's catalogue calls, so the editorial source is never starved.
  maxMatchShare: 1 / 3,
  // Up to ten searches in parallel, each on a 6 s leash, inside one attempt.
  attemptTimeoutMs: 15_000,
  label(env) {
    return (env.TRENDS_WEB_LABEL ?? '').trim().slice(0, 40) || WEB_DEFAULT_LABEL;
  },
  status(env) {
    if (envList(env.TRENDS_DISABLED_SOURCES).includes('web')) return 'disabled';
    return searxngConfigured(env) ? 'ok' : 'not_configured';
  },
  statusReason(env) {
    if (envList(env.TRENDS_DISABLED_SOURCES).includes('web')) return 'Switched off by the owner (TRENDS_DISABLED_SOURCES).';
    return searxngConfigured(env) ? null : 'The web search instance is not configured (SEARXNG_URL is unset or not an https address).';
  },
  maxUnitsPerRun() {
    return 0;
  },
  dailyUnitBudget() {
    return null;
  },
  derivedMetricsAllowed() {
    return false;
  },
  async fetch(env: TrendsEnv, opts: FetchOptions): Promise<RawTrendItem[]> {
    const observedAt = (opts.now ?? new Date()).toISOString();
    const plan = webLanguages(env).flatMap((language) => webQueries(language).map((query) => ({ language, query })));
    const answers = await Promise.all(
      plan.map(async (p) => ({ ...p, res: await searxngQuery(env, p.query, { categories: 'videos', timeRange: 'week', limit: 30, timeoutMs: 6_000, signal: opts.signal, tag: 'trends' }) })),
    );
    const candidates = extractWebCandidates(answers.filter((a) => a.res.ok));
    const failure = webRunFailure(answers, candidates.length);
    if (failure) throw failure;
    return toRawItems(candidates, opts.region, observedAt);
  },
};
