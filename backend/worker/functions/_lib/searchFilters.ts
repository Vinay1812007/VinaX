/**
 * 8.5.0 — natural-language music search → structured filters.
 *
 * "sad songs from the 2000s", "upbeat Telugu songs", "songs like <a song>",
 * "songs similar to <a singer> but more upbeat", "slow acoustic songs".
 *
 * Two readers produce the same `SearchFilters` shape:
 *  - rules (`rulesFilters`) — deterministic, always available;
 *  - the AI model, whose JSON is UNTRUSTED: `sanitizeFilters` keeps only
 *    values from the fixed vocabularies below, clips every string and drops
 *    anything else. The model never names songs here; it only fills filters.
 * `mergeFilters` lets what the rules read literally win and the model fill
 * the gaps (a mood or a seed the word lists missed).
 *
 * `catalogueQueries` turns filters into the short phrasings the catalogue
 * answers. Each was probed live on 2026-09-30 (20/20 results, in-language):
 * "<lang> instrumental", "<lang> acoustic songs", "<lang> unplugged",
 * "<lang> melody songs", plus the phrasings the app already relies on
 * ("<lang> dance songs", "<lang> mass songs", "<lang> sad songs",
 * "<lang> romantic songs", "<lang> devotional songs", "<lang> evergreen hits").
 * "<lang> slow songs" is NOT used: the catalogue matches it to titles such
 * as "Slow Motion".
 */
import { detectStyle, readRequest } from '../api/playlist';

export const FILTER_LANGUAGES = [
  'hindi', 'telugu', 'tamil', 'kannada', 'malayalam', 'punjabi', 'marathi', 'bengali', 'gujarati',
  'english', 'bhojpuri', 'haryanvi', 'urdu', 'odia', 'assamese', 'rajasthani',
] as const;
export const FILTER_MOODS = ['romantic', 'energetic', 'chill', 'melancholy', 'devotional'] as const;
export const FILTER_ACTIVITIES = ['workout', 'party', 'wedding', 'drive', 'focus', 'sleep', 'rain', 'travel'] as const;
export type FilterMood = (typeof FILTER_MOODS)[number];

export interface SearchSeed {
  /** The song or artist the listener named, as written (clipped). */
  text: string;
  /** What the reader thinks it is; retrieval decides from the catalogue. */
  kind: 'song' | 'artist' | 'unknown';
}

export interface SearchFilters {
  languages: string[];
  moods: FilterMood[];
  activity: (typeof FILTER_ACTIVITIES)[number] | null;
  energy: 'high' | 'low' | null;
  tempo: 'slow' | 'fast' | null;
  /** Inclusive year range ("2000s" → 2000–2009); null when not asked. */
  yearFrom: number | null;
  yearTo: number | null;
  seed: SearchSeed | null;
  instrumental: boolean;
  style: 'dj' | 'folk' | 'devotional' | null;
  /** Other content words (a film, a composer), at most five. */
  keywords: string[];
}

export const EMPTY_FILTERS: SearchFilters = {
  languages: [], moods: [], activity: null, energy: null, tempo: null, yearFrom: null, yearTo: null, seed: null, instrumental: false, style: null, keywords: [],
};

const MIN_YEAR = 1940;
const MAX_YEAR = new Date().getUTCFullYear();

const MOOD_WORDS: Array<[FilterMood, RegExp]> = [
  ['melancholy', /\b(sad|heartbreak|heartbroken|breakup|lonely|emotional|pathos|crying|melancholy)\b/],
  ['romantic', /\b(romantic|romance|love|date|valentine)\b/],
  ['energetic', /\b(upbeat|energetic|happy|dance|dancing|party|hype|peppy|mass|pump(?:ing)?|gym|workout)\b/],
  ['chill', /\b(chill|calm|relax(?:ing)?|soothing|mellow|soft|peaceful|lofi|acoustic|slow|study(?:ing)?|sleep)\b/],
  ['devotional', /\b(devotional|bhakti|bhajans?|prayer|spiritual)\b/],
];

// eslint-disable-next-line no-control-regex
const clipText = (v: unknown, n: number): string => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n) : '');

/** "90s" → 1990, "2000s" → 2000, "the 80's" → 1980; null otherwise. */
export function decadeOf(text: string): number | null {
  const m = /\b(?:(19|20)(\d)0|(\d)0)['’]?s\b/i.exec(text);
  if (!m) return null;
  if (m[1]) return Number(`${m[1]}${m[2]}0`);
  const d = Number(m[3]);
  return d >= 4 ? 1900 + d * 10 : 2000 + d * 10;
}

/** Pronouns are never a seed: "more like this" and "something like that" name nothing. */
const NOT_A_SEED = new Set(['this', 'that', 'it', 'me', 'you', 'us', 'them', 'these', 'those', 'him', 'her', 'mine', 'yours']);

/**
 * The song or artist after "songs like" / "similar to" / "in the style of",
 * with what follows "but …" treated as a modifier, not part of the name.
 */
export function seedOf(text: string): SearchSeed | null {
  const m = /(?:^|\b(?:songs?|music|tracks?|something|anything|more)\s+)(?:like|similar to|such as|in the style of|along the lines of)\s+(.+)$/i.exec(text.trim());
  if (!m) return null;
  let name = m[1].split(/\s+(?:but|except|only|and make|with more|with less)\b|[,;]/i)[0];
  name = name.replace(/\s+(?:songs?|music|tracks?|type|style|vibes?)$/i, '').replace(/^["“'‘]|["”'’]$/g, '').trim();
  const clean = clipText(name, 80);
  if (clean.length < 2 || NOT_A_SEED.has(clean.toLowerCase())) return null;
  // "songs of <a singer>" reads as an artist; everything else is left to the catalogue.
  return { text: clean, kind: /\b(songs?|voice|singer|singing)\s+(?:of|by)\b/i.test(m[0]) ? 'artist' : 'unknown' };
}

/** Deterministic reading — always available, and what an AI failure falls back to. */
export function rulesFilters(query: string): SearchFilters {
  const text = clipText(query, 300);
  const lower = text.toLowerCase();
  const seed = seedOf(text);
  // Words inside the seed name are not cues ("songs like Love Story" is not a romance request).
  const cueText = seed ? lower.replace(seed.text.toLowerCase(), ' ') : lower;
  const reading = readRequest(cueText);
  const moods: FilterMood[] = [];
  for (const [mood, re] of MOOD_WORDS) if (re.test(cueText) && moods.length < 3) moods.push(mood);
  const tempo = /\b(slow(?:er)?|slowed)\b/.test(cueText) ? 'slow' : /\b(fast(?:er)?|up-?tempo|high[\s-]?tempo)\b/.test(cueText) ? 'fast' : null;
  const decade = decadeOf(cueText);
  const activity = (FILTER_ACTIVITIES as readonly string[]).includes(reading.activity ?? '') ? (reading.activity as SearchFilters['activity']) : null;
  const energy = /\bmore upbeat|more energy|more energetic|faster\b/.test(cueText) ? 'high' : reading.energy;
  return {
    languages: reading.languages.filter((l) => (FILTER_LANGUAGES as readonly string[]).includes(l)),
    moods,
    activity,
    energy,
    tempo,
    yearFrom: decade,
    yearTo: decade == null ? null : decade + 9,
    seed,
    instrumental: /\b(instrumental|no vocals|without (?:vocals|lyrics|words)|no lyrics)\b/.test(cueText),
    style: detectStyle(cueText),
    keywords: [],
  };
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v.toLowerCase()) ? (v.toLowerCase() as T) : null;
}

function year(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d{4}$/.test(v.trim()) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= MIN_YEAR && n <= MAX_YEAR ? n : null;
}

/**
 * The model's filters, reduced to what the vocabulary allows. Null when the
 * answer is not an object at all (so the caller can ask the next engine).
 */
export function sanitizeFilters(raw: unknown): SearchFilters | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const languages = [...new Set(list(o.languages).map((l) => oneOf(l, FILTER_LANGUAGES)).filter((l): l is (typeof FILTER_LANGUAGES)[number] => !!l))].slice(0, 3);
  const moods = [...new Set(list(o.moods).map((m) => oneOf(m, FILTER_MOODS)).filter((m): m is FilterMood => !!m))].slice(0, 3);
  let yearFrom = year(o.yearFrom);
  let yearTo = year(o.yearTo);
  if (yearFrom != null && yearTo != null && yearTo < yearFrom) [yearFrom, yearTo] = [yearTo, yearFrom];
  // A range over thirty years is no filter at all.
  if (yearFrom != null && yearTo != null && yearTo - yearFrom > 30) yearFrom = yearTo = null;
  const seedRaw = o.seed && typeof o.seed === 'object' && !Array.isArray(o.seed) ? (o.seed as Record<string, unknown>) : null;
  const seedText = clipText(seedRaw?.text, 80);
  const seed: SearchSeed | null = seedText.length >= 2 ? { text: seedText, kind: oneOf(seedRaw?.kind, ['song', 'artist'] as const) ?? 'unknown' } : null;
  const keywords = [...new Set(list(o.keywords).map((k) => clipText(k, 30).toLowerCase()).filter((k) => k.length >= 2))].slice(0, 5);
  return {
    languages,
    moods,
    activity: oneOf(o.activity, FILTER_ACTIVITIES),
    energy: oneOf(o.energy, ['high', 'low'] as const),
    tempo: oneOf(o.tempo, ['slow', 'fast'] as const),
    yearFrom,
    yearTo,
    seed,
    instrumental: o.instrumental === true,
    style: oneOf(o.style, ['dj', 'folk', 'devotional'] as const),
    keywords,
  };
}

/** What the rules read literally wins; the model fills the gaps. */
export function mergeFilters(rules: SearchFilters, ai: SearchFilters | null): SearchFilters {
  if (!ai) return rules;
  return {
    languages: rules.languages.length ? rules.languages : ai.languages,
    moods: [...new Set([...rules.moods, ...ai.moods])].slice(0, 3),
    activity: rules.activity ?? ai.activity,
    energy: rules.energy ?? ai.energy,
    tempo: rules.tempo ?? ai.tempo,
    yearFrom: rules.yearFrom ?? ai.yearFrom,
    yearTo: rules.yearFrom != null ? rules.yearTo : ai.yearTo,
    seed: rules.seed ?? ai.seed,
    instrumental: rules.instrumental || ai.instrumental,
    style: rules.style ?? ai.style,
    keywords: ai.keywords,
  };
}

const MOOD_PHRASE: Record<FilterMood, string[]> = {
  energetic: ['dance songs', 'mass songs'],
  melancholy: ['sad songs'],
  romantic: ['romantic songs'],
  devotional: ['devotional songs'],
  chill: ['melody songs', 'acoustic songs'],
};
const ACTIVITY_PHRASE: Partial<Record<NonNullable<SearchFilters['activity']>, string[]>> = {
  workout: ['dance songs', 'mass songs'],
  party: ['dance songs', 'mass songs'],
  wedding: ['dance songs'],
  drive: ['melody songs', 'dance songs'],
  travel: ['melody songs', 'dance songs'],
  focus: ['instrumental', 'melody songs'],
  sleep: ['melody songs', 'unplugged'],
  rain: ['melody songs'],
};
const STYLE_PHRASE: Record<NonNullable<SearchFilters['style']>, string> = { dj: 'dj remix', folk: 'folk songs', devotional: 'devotional songs' };

/** Catalogue phrasings for filters without a seed, first language first, at most `max`. */
export function catalogueQueries(f: SearchFilters, fallbackLanguages: readonly string[] = [], max = 3): string[] {
  const terms: string[] = [];
  const add = (...t: string[]) => {
    for (const x of t) if (!terms.includes(x)) terms.push(x);
  };
  if (f.style) add(STYLE_PHRASE[f.style]);
  if (f.instrumental) add('instrumental');
  if (f.tempo === 'slow' || f.energy === 'low') add('acoustic songs', 'unplugged');
  // "Evergreen" is the catalogue's word for pre-2000 film hits; a 2000s request filters by year instead.
  if (f.yearFrom != null && f.yearFrom < 2000) add('evergreen hits');
  for (const m of f.moods) add(...MOOD_PHRASE[m]);
  if (f.activity) add(...(ACTIVITY_PHRASE[f.activity] ?? []));
  if (f.tempo === 'fast' || f.energy === 'high') add('dance songs');
  const named = f.keywords.slice(0, 3).join(' ');
  if (!terms.length && named) return [named];
  if (!terms.length) add('melody songs', 'dance songs');
  const langs = f.languages.length ? f.languages : fallbackLanguages.slice(0, 2);
  const out: string[] = [];
  for (const t of terms) for (const l of langs.length ? langs : ['']) out.push(l ? `${l} ${t}` : t);
  return [...new Set(out)].slice(0, max);
}

/** Plain words for the filters, built only from the filters themselves. */
export function describeFilters(f: SearchFilters): string {
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const moodName: Record<FilterMood, string> = { romantic: 'romantic', energetic: 'upbeat', chill: 'calm', melancholy: 'sad', devotional: 'devotional' };
  const parts: string[] = [];
  if (f.languages.length) parts.push(f.languages.map(cap).join(' / '));
  if (f.moods.length) parts.push(f.moods.map((m) => moodName[m]).join(', '));
  if (f.tempo) parts.push(f.tempo);
  if (f.instrumental) parts.push('instrumental');
  if (f.yearFrom != null) parts.push(f.yearTo != null && f.yearTo !== f.yearFrom ? `${f.yearFrom}–${f.yearTo}` : String(f.yearFrom));
  return parts.join(' · ');
}
