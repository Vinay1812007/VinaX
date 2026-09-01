/**
 * LRCLIB (lrclib.net) — open, keyless lyrics database with synced (LRC)
 * lyrics. Used as the "real lyrics" source with upstream-wrapper lyrics as
 * fallback. Public CORS-enabled API; we send only track title/artist/duration.
 */
export interface LrcLine {
  /** Seconds from track start. */
  t: number;
  text: string;
}

export interface LyricsResult {
  plain: string | null;
  synced: LrcLine[] | null;
  source: 'lrclib' | 'upstream';
}

const BASE = 'https://lrclib.net/api';

interface LrclibRecord {
  trackName?: string;
  artistName?: string;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
  instrumental?: boolean;
}

export function parseLrc(lrc: string): LrcLine[] {
  const out: LrcLine[] = [];
  for (const raw of lrc.split('\n')) {
    const matches = [...raw.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (!matches.length) continue;
    const text = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of matches) {
      const min = Number(m[1]);
      const sec = Number(m[2]);
      const frac = m[3] ? Number(m[3].padEnd(3, '0')) / 1000 : 0;
      out.push({ t: min * 60 + sec + frac, text });
    }
  }
  return out.sort((a, b) => a.t - b.t).filter((l, i, arr) => l.text || i === arr.length - 1 || arr[i + 1].t - l.t > 1);
}

async function getJson(url: string, timeoutMs = 8000): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

function toResult(rec: LrclibRecord | null): LyricsResult | null {
  if (!rec) return null;
  const synced = rec.syncedLyrics ? parseLrc(rec.syncedLyrics) : null;
  const plain = rec.plainLyrics?.trim() || null;
  if (!synced?.length && !plain) return null;
  return { plain, synced: synced?.length ? synced : null, source: 'lrclib' };
}

/** Strip film-soundtrack noise so titles like 'Chikiri Chikiri (From "Peddi")'
 *  match LRCLIB, which catalogs the plain song name. */
function cleanSongTitle(t: string): string {
  return t
    .replace(/\s*\((?:from|from the|from movie|from\s+the\s+movie)\b[^)]*\)/gi, '')
    .replace(/\s*\[[^\]]*\]/g, '')
    .replace(/\s*[-–—]\s*from\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalize a title/artist for matching: strip film noise, diacritics and
 *  punctuation, lowercase, collapse spaces. */
function normMatch(s: string): string {
  return cleanSongTitle(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Words that carry no song identity — ignored when comparing titles. */
const NOISE_WORDS = new Set(['from', 'the', 'a', 'an', 'feat', 'ft', 'film', 'movie', 'version']);

/**
 * v5.7.2 — how much a candidate's title looks like the requested one. The
 * ranker used to score ONLY synced-ness and duration, so a title-only search
 * for "Killi Killi" crowned "Badman Mood (feat. Killi)" — confident,
 * wrong-language lyrics on a Telugu song. Titles now gate: a candidate whose
 * name doesn't resemble the request can never win, whatever else it offers.
 */
function titleAffinity(want: string, got: string): number {
  const w = normMatch(want);
  const g = normMatch(got);
  if (!w || !g) return -1000;
  if (w === g) return 60;
  if (w.includes(g) || g.includes(w)) return 40;
  const a = new Set(w.split(' ').filter((t) => !NOISE_WORDS.has(t)));
  const b = new Set(g.split(' ').filter((t) => !NOISE_WORDS.has(t)));
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  const union = a.size + b.size - inter;
  return union > 0 && inter / union >= 0.5 ? 25 : -1000;
}

/** Rank search candidates: the title must match; then synced beats plain,
 *  duration proximity beats position, and a shared artist word helps.
 *  (Artist is a bonus, never a gate — our catalog credits actors and
 *  composers where LRCLIB credits singers, so mismatches are routine.) */
function pickBest(list: LrclibRecord[], track: string, artist: string, duration: number | null): LrclibRecord | null {
  if (!list.length) return null;
  const artistTokens = normMatch(artist).split(' ').filter((t) => t.length > 1 && !NOISE_WORDS.has(t));
  const score = (r: LrclibRecord): number => {
    let s = r.syncedLyrics ? 100 : r.plainLyrics ? 40 : -1000;
    s += titleAffinity(track, r.trackName ?? '');
    const candArtist = normMatch(r.artistName ?? '');
    if (candArtist && artistTokens.some((t) => candArtist.includes(t))) s += 15;
    const d = (r as { duration?: unknown }).duration;
    if (duration && typeof d === 'number') {
      const dd = Math.abs(d - duration);
      s += dd <= 3 ? 40 : dd <= 8 ? 20 : dd <= 20 ? 0 : -60;
    }
    return s;
  };
  const best = [...list].sort((a, b) => score(b) - score(a))[0];
  return best && score(best) > 0 ? best : null;
}

async function lookupOnce(track: string, artist: string, duration: number | null): Promise<LyricsResult | null> {
  const params = new URLSearchParams({ track_name: track, artist_name: artist });
  if (duration) params.set('duration', String(Math.round(duration)));
  const exact = toResult((await getJson(`${BASE}/get?${params}`)) as LrclibRecord | null);
  if (exact) return exact;
  const q = new URLSearchParams({ track_name: track, artist_name: artist });
  const list = (await getJson(`${BASE}/search?${q}`)) as LrclibRecord[] | null;
  if (Array.isArray(list)) {
    const r = toResult(pickBest(list, track, artist, duration));
    if (r) return r;
  }
  return null;
}

async function runLookup(
  track: string,
  artist: string,
  duration: number | null,
): Promise<LyricsResult | null> {
  // Try the exact title, then a cleaned (no '(From ...)' ) title.
  const cleaned = cleanSongTitle(track);
  for (const t of cleaned && cleaned !== track ? [track, cleaned] : [track]) {
    const r = await lookupOnce(t, artist, duration);
    if (r) return r;
  }

  // Last resort: a general title-only search (helps regional / film tracks).
  const finalTitle = cleaned || track;
  const list = (await getJson(`${BASE}/search?${new URLSearchParams({ q: finalTitle })}`)) as LrclibRecord[] | null;
  if (Array.isArray(list)) {
    return toResult(pickBest(list, finalTitle, artist, duration));
  }
  return null;
}

/**
 * Cached, de-duplicated entry point. Without this, a caller that re-runs on
 * every render (or a player that briefly oscillates between tracks) can fire
 * the same lookup hundreds of times — and because LRCLIB answers 503 under
 * load, a failed lookup would otherwise retry forever. We therefore:
 *   - share a single in-flight promise per (track, artist) key, and
 *   - remember a miss/failure for NEGATIVE_TTL_MS before trying again.
 * A successful result is cached for the lifetime of the session.
 */
interface LyricsCacheEntry {
  at: number;
  result: LyricsResult | null;
  pending?: Promise<LyricsResult | null>;
}
const lyricsCache = new Map<string, LyricsCacheEntry>();
const NEGATIVE_TTL_MS = 3 * 60_000;
const LYRICS_CACHE_MAX = 200;

/** Small LRU: evict the oldest insertion once the cache passes 200 entries.
 *  A long listening session could otherwise accumulate thousands of results. */
function lruSetCache(key: string, entry: LyricsCacheEntry): void {
  if (lyricsCache.has(key)) lyricsCache.delete(key); // re-insert at end
  lyricsCache.set(key, entry);
  if (lyricsCache.size > LYRICS_CACHE_MAX) {
    const oldest = lyricsCache.keys().next().value;
    if (oldest !== undefined) lyricsCache.delete(oldest);
  }
}

export async function fetchLrclibLyrics(
  track: string,
  artist: string,
  duration: number | null,
): Promise<LyricsResult | null> {
  const key = `${track.toLowerCase()}\u0000${(artist || '').toLowerCase()}`;
  const now = Date.now();
  const hit = lyricsCache.get(key);
  if (hit) {
    if (hit.pending) return hit.pending; // collapse concurrent callers
    if (hit.result) return hit.result; // positive cache
    if (now - hit.at < NEGATIVE_TTL_MS) return null; // cooldown after a miss/failure
  }
  const pending = runLookup(track, artist, duration);
  lruSetCache(key, { at: now, result: null, pending });
  let result: LyricsResult | null = null;
  try {
    result = await pending;
  } finally {
    lruSetCache(key, { at: Date.now(), result });
  }
  return result;
}
