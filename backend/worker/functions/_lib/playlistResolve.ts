/**
 * 8.5.0 — map an AI playlist's { title, artist } suggestions onto catalogue
 * songs, on the server, so /api/ai/playlist returns only ids that exist.
 *
 * The rule is the app's `matchesProposal` (services/ai/dj.ts), kept in step:
 * a catalogue result IS the suggestion when its canonical title + primary
 * artist equal the suggestion's, or when its title holds every word of the
 * suggested title (or starts with it) AND its credits name the suggested
 * artist. Dialogue, BGM, jukebox and trailer cuts never match. A suggestion
 * with no matching result is DROPPED — never replaced by whatever the search
 * listed first.
 */
import { canonicalKey } from './identityCore';
import { searchCatalogSongs } from './trends/catalog';
import type { CatalogCandidate } from './trends/matcher';

const JUNK_TITLE = /\b(dialogue|dialogues|bgm|jukebox|trailer|teaser|promo|ringtone|commentary)\b/i;
const fold = (t: string): string => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function matchesSuggestion(c: CatalogCandidate, title: string, artist: string): boolean {
  if (JUNK_TITLE.test(c.title)) return false;
  if (canonicalKey(c.title, c.primaryArtists[0] ?? '') === canonicalKey(title, artist)) return true;
  const q = fold(title);
  const words = q.split(' ').filter((w) => w.length >= 2);
  const t = fold(c.title);
  if (!q || !(t === q || t.startsWith(q) || (words.length > 0 && words.every((w) => t.includes(w))))) return false;
  const wanted = fold(artist).split(' ').filter((w) => w.length >= 3);
  if (!wanted.length) return false;
  const credited = fold([...c.primaryArtists, ...c.featuredArtists, ...c.credits].join(' '));
  return wanted.some((w) => credited.includes(w));
}

export interface Suggestion {
  title: string;
  artist: string;
  reason?: string;
}

export interface ResolvedTrack {
  song: CatalogCandidate;
  suggestion: Suggestion;
}

export interface ResolveOptions {
  /** Keep only these languages (lower-case); empty keeps every language. */
  languages?: string[];
  limit?: number;
  /** Parallel catalogue searches per round. */
  batch?: number;
  /** Stop starting new rounds after this epoch ms (already-started searches finish). */
  deadlineAt?: number;
}

/**
 * Resolve suggestions in order, in bounded parallel rounds. Duplicates (the
 * same id, or the same canonical song under another id) are folded. A failed
 * search drops that suggestion only; CatalogUnavailable on EVERY search of a
 * round is rethrown so the caller can answer 502.
 */
export async function resolveSuggestions(suggestions: Suggestion[], opts: ResolveOptions = {}): Promise<ResolvedTrack[]> {
  const limit = opts.limit ?? 25;
  const batch = Math.max(1, opts.batch ?? 5);
  const langs = new Set((opts.languages ?? []).map((l) => l.toLowerCase()));
  const out: ResolvedTrack[] = [];
  const ids = new Set<string>();
  const keys = new Set<string>();
  let failures = 0;
  let attempts = 0;
  let lastError: unknown = null;
  for (let i = 0; i < suggestions.length && out.length < limit; i += batch) {
    if (opts.deadlineAt && Date.now() > opts.deadlineAt) break;
    const round = suggestions.slice(i, i + batch);
    const results = await Promise.allSettled(round.map((s) => searchCatalogSongs(`${s.title} ${s.artist}`.slice(0, 120), 5)));
    for (const [n, r] of results.entries()) {
      attempts += 1;
      if (r.status === 'rejected') {
        failures += 1;
        lastError = r.reason;
        continue;
      }
      if (out.length >= limit) break;
      const s = round[n];
      const hit = r.value.find((c) => matchesSuggestion(c, s.title, s.artist) && (!langs.size || (!!c.language && langs.has(c.language.toLowerCase()))));
      if (!hit || ids.has(hit.id)) continue;
      const key = canonicalKey(hit.title, hit.primaryArtists[0] ?? '');
      if (keys.has(key)) continue;
      ids.add(hit.id);
      keys.add(key);
      out.push({ song: hit, suggestion: s });
    }
  }
  if (attempts > 0 && failures === attempts && lastError) throw lastError;
  return out;
}
