import { LANGUAGES } from '@/constants/languages';
import { styleFromText, styleQueries, type MusicStyle } from '@/services/recommendation/style';

/**
 * 8.2.0 — what a free-text music request is asking for.
 *
 * "Make me a Telugu workout playlist with high-energy songs" →
 * { languages: ['telugu'], activity: 'workout', energy: 'high', moods: ['energetic'] }.
 *
 * Shared by natural-language search, the AI playlist builder and the
 * on-device vectors (localVectors.ts), so all three read a request the same
 * way. Deterministic, dependency-free and cheap enough to run per keystroke.
 */

export type IntentMood = 'romantic' | 'energetic' | 'chill' | 'melancholy' | 'devotional';
export type IntentActivity = 'workout' | 'party' | 'drive' | 'focus' | 'sleep' | 'rain' | 'wedding' | 'travel';
export type IntentEnergy = 'high' | 'low';

export interface MusicIntent {
  /** Languages the text names ("telugu", "hindi"), in the order written. */
  languages: string[];
  moods: IntentMood[];
  activity: IntentActivity | null;
  energy: IntentEnergy | null;
  /** First year of a named decade ("90s" → 1990), else null. */
  decade: number | null;
  /** Old songs ("classic", "evergreen", "retro") or new ones ("latest", "new"). */
  era: 'classic' | 'fresh' | null;
  /**
   * 8.3.0 — a style the text names: DJ remixes ("telugu dj songs", "remix"),
   * folk ("folk songs", "janapadalu", "palle patalu", "lok geet") or
   * devotional ("bhajans"). See services/recommendation/style.ts.
   */
  style: MusicStyle | null;
  /** Content words left after the recognised cues and filler are removed. */
  keywords: string[];
  /** How many cues were recognised (language, mood, activity, energy, era). */
  cues: number;
  /**
   * 8.5.0 — "songs like <name>" / "similar to <name> but more upbeat": the
   * song or artist named (as written; the catalogue decides which it is).
   * Optional so intents built elsewhere keep type-checking.
   */
  seed?: { text: string } | null;
  /** 8.5.0 — "slow" / "fast", separate from energy (a slow song can still be intense). */
  tempo?: 'slow' | 'fast' | null;
  /** 8.5.0 — music without vocals ("instrumental", "no lyrics"). */
  instrumental?: boolean;
}

/** Pronouns are never a seed: "more like this" and "something like that" name nothing. */
const NOT_A_SEED = new Set(['this', 'that', 'it', 'me', 'you', 'us', 'them', 'these', 'those', 'him', 'her', 'mine', 'yours']);

/**
 * 8.5.0 — the name after "songs like" / "similar to" / "in the style of",
 * without a trailing "but …" modifier. Same reading as the server's
 * _lib/searchFilters.ts `seedOf`. Null when the text asks for no seed.
 */
export function seedOf(text: string): { text: string } | null {
  const m = /(?:^|\b(?:songs?|music|tracks?|something|anything|more)\s+)(?:like|similar to|such as|in the style of|along the lines of)\s+(.+)$/i.exec(text.trim());
  if (!m) return null;
  let name = m[1].split(/\s+(?:but|except|only|and make|with more|with less)\b|[,;]/i)[0];
  name = name.replace(/\s+(?:songs?|music|tracks?|type|style|vibes?)$/i, '').replace(/^["“'‘]|["”'’]$/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (name.length < 2 || NOT_A_SEED.has(name.toLowerCase())) return null;
  return { text: name };
}

const LANGUAGE_WORDS: Record<string, string> = Object.fromEntries(LANGUAGES.map((l) => [l.id, l.id]));
// Common spellings and names people type for a language.
Object.assign(LANGUAGE_WORDS, { tollywood: 'telugu', bollywood: 'hindi', kollywood: 'tamil', mollywood: 'malayalam', sandalwood: 'kannada', telgu: 'telugu', tamizh: 'tamil', hindustani: 'hindi', panjabi: 'punjabi', oriya: 'odia', bangla: 'bengali' });

const MOOD_WORDS: Record<string, IntentMood> = {
  sad: 'melancholy', heartbreak: 'melancholy', heartbroken: 'melancholy', breakup: 'melancholy', lonely: 'melancholy', emotional: 'melancholy', pathos: 'melancholy', crying: 'melancholy', cry: 'melancholy', missing: 'melancholy', melancholy: 'melancholy',
  romantic: 'romantic', romance: 'romantic', love: 'romantic', lovely: 'romantic', date: 'romantic',
  happy: 'energetic', energetic: 'energetic', upbeat: 'energetic', dance: 'energetic', dancing: 'energetic', mass: 'energetic', hype: 'energetic', pump: 'energetic', peppy: 'energetic', celebration: 'energetic', festive: 'energetic',
  chill: 'chill', calm: 'chill', relax: 'chill', relaxing: 'chill', soothing: 'chill', mellow: 'chill', soft: 'chill', peaceful: 'chill', lofi: 'chill', melody: 'chill', melodies: 'chill', slow: 'chill', acoustic: 'chill',
  devotional: 'devotional', bhakti: 'devotional', god: 'devotional', prayer: 'devotional', spiritual: 'devotional', temple: 'devotional', bhajan: 'devotional', bhajans: 'devotional',
};

const ACTIVITY_WORDS: Record<string, IntentActivity> = {
  workout: 'workout', gym: 'workout', exercise: 'workout', running: 'workout', run: 'workout', jog: 'workout', jogging: 'workout', cardio: 'workout', training: 'workout', lifting: 'workout',
  party: 'party', club: 'party', dj: 'party',
  drive: 'drive', driving: 'drive', road: 'drive', roadtrip: 'drive', car: 'drive',
  focus: 'focus', study: 'focus', studying: 'focus', work: 'focus', coding: 'focus', concentration: 'focus',
  sleep: 'sleep', sleeping: 'sleep', bedtime: 'sleep', lullaby: 'sleep',
  rain: 'rain', rainy: 'rain', monsoon: 'rain', rains: 'rain',
  wedding: 'wedding', sangeet: 'wedding', marriage: 'wedding', baraat: 'wedding',
  travel: 'travel', trip: 'travel', journey: 'travel', vacation: 'travel',
};

/** Activities that imply an energy when the text does not say one. */
const ACTIVITY_ENERGY: Partial<Record<IntentActivity, IntentEnergy>> = { workout: 'high', party: 'high', wedding: 'high', sleep: 'low', focus: 'low', rain: 'low' };
const ACTIVITY_MOOD: Partial<Record<IntentActivity, IntentMood>> = { workout: 'energetic', party: 'energetic', wedding: 'energetic', sleep: 'chill', focus: 'chill', rain: 'chill' };

const HIGH_ENERGY = /\b(high[\s-]?energy|high[\s-]?tempo|energetic|upbeat|fast|pumping|power|intense|beats?|banger|bangers|hype|loud|peppy)\b/;
const LOW_ENERGY = /\b(low[\s-]?energy|slow|calm|soft|quiet|gentle|mellow|soothing|relaxing|chill)\b/;
const CLASSIC = /\b(old|oldies|classic|classics|evergreen|retro|vintage|golden)\b/;
const FRESH = /\b(new|latest|recent|fresh|trending|this year)\b/;

/** Words that carry no musical meaning in a request. */
const FILLER = new Set(
  'a an and the of for to in on with my me i some any make give play create build want need songs song music tracks track playlist mix list please that are is be like from by best top good great hits hit vibes vibe feel feeling kind type sort style mood moods energy high low tempo about who which can you get find show just really very more most something few lot lots all its it this these those when while during at or but so'.split(' '),
);

/** Lower-case, punctuation-free word list (Indic letters and marks kept). */
export function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKC')
    .replace(/['‘’]/g, '')
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

/**
 * 8.3.1 — "dj" is the party activity only when the words ask for the DJ
 * sound ("telugu dj songs", "dj remix"); in "DJ Tillu" it is part of a name.
 */
const djIsName = (text: string): boolean => styleFromText(text) !== 'dj';

export function parseMusicIntent(input: string): MusicIntent {
  // 8.5.0 — the words of a named seed are a name, not cues: "songs like Love Story" is not a romance request.
  const seed = seedOf(input);
  const text = seed ? input.replace(seed.text, ' ') : input;
  const lower = ` ${text.toLowerCase()} `;
  const list = words(text);
  const style = styleFromText(text);
  const djName = style !== 'dj';
  const languages: string[] = [];
  const moods: IntentMood[] = [];
  let activity: IntentActivity | null = null;
  const keywords: string[] = [];
  let decade: number | null = null;
  for (const w of list) {
    const lang = LANGUAGE_WORDS[w];
    if (lang) {
      if (!languages.includes(lang)) languages.push(lang);
      continue;
    }
    const mood = MOOD_WORDS[w];
    if (mood && !moods.includes(mood)) moods.push(mood);
    const act = w === 'dj' && djName ? undefined : ACTIVITY_WORDS[w];
    if (act && !activity) activity = act;
    const dec = /^(?:19|20)?(\d)0s$/.exec(w);
    if (dec && !decade) {
      const d = Number(dec[1]);
      decade = w.length >= 5 ? Number(w.slice(0, 4)) : d >= 5 ? 1900 + d * 10 : 2000 + d * 10;
      continue;
    }
    if (!mood && !act && !FILLER.has(w) && w.length > 1) keywords.push(w);
  }
  let energy: IntentEnergy | null = HIGH_ENERGY.test(lower) ? 'high' : LOW_ENERGY.test(lower) ? 'low' : null;
  if (!energy && activity) energy = ACTIVITY_ENERGY[activity] ?? null;
  if (activity && !moods.length && ACTIVITY_MOOD[activity]) moods.push(ACTIVITY_MOOD[activity] as IntentMood);
  if (energy === 'high' && !moods.includes('energetic') && !moods.includes('melancholy')) moods.push('energetic');
  const era = CLASSIC.test(lower) || (decade !== null && decade < 2010) ? 'classic' : FRESH.test(lower) ? 'fresh' : null;
  if (!energy && /\bmore (?:upbeat|energy|energetic)\b/.test(lower)) energy = 'high';
  const tempo = /\b(slow(?:er)?|slowed)\b/.test(lower) ? 'slow' : /\b(fast(?:er)?|up-?tempo|high[\s-]?tempo)\b/.test(lower) ? 'fast' : null;
  const instrumental = /\b(instrumental|instrumentals|no vocals|without (?:vocals|lyrics|words)|no lyrics)\b/.test(lower);
  const cues = languages.length + moods.length + (activity ? 1 : 0) + (energy ? 1 : 0) + (era ? 1 : 0) + (style ? 1 : 0) + (seed ? 1 : 0) + (instrumental ? 1 : 0);
  return { languages, moods, activity, energy, decade, era, style, keywords, cues, seed, tempo, instrumental };
}

/** Words that mark a description of music rather than a title. */
const DESCRIBING = new Set(['songs', 'song', 'music', 'playlist', 'tracks', 'mix', 'vibes', 'for', 'to']);

/**
 * True when a search reads like a description ("sad telugu songs for rain",
 * "high energy workout hindi") rather than a title or a name. Needs three or
 * more words and a mood, activity, energy or era cue, plus either a second
 * cue (a language counts) or a describing word ("songs", "for", "playlist").
 * A language alone ("telugu songs"), a name ("arijit singh") or a title that
 * happens to hold a mood word ("love me like you do", "party all night") is
 * an ordinary search.
 */
export function looksLikeNaturalLanguage(query: string): boolean {
  const list = words(query);
  if (list.length < 3 || list.length > 20) return false;
  // 8.5.0 — "songs like <name>" always describes; the name alone would be an ordinary search.
  if (seedOf(query)) return true;
  // Cue WORDS actually typed (an activity's implied energy does not count twice).
  const lower = ` ${list.join(' ')} `;
  const djName = djIsName(query);
  const typed =
    list.filter((w) => MOOD_WORDS[w] || (ACTIVITY_WORDS[w] && !(w === 'dj' && djName)) || /^(?:19|20)?\d0s$/.test(w)).length +
    (HIGH_ENERGY.test(lower) || LOW_ENERGY.test(lower) ? 1 : 0) +
    (CLASSIC.test(lower) || FRESH.test(lower) ? 1 : 0);
  if (typed < 1) return false;
  const languages = list.filter((w) => LANGUAGE_WORDS[w]).length;
  return typed + languages >= 2 || list.some((w) => DESCRIBING.has(w));
}

const CURRENT_YEAR = new Date().getFullYear();

/**
 * Catalogue searches that fetch candidates for an intent.
 *
 * Only phrasings probed to work are used ("<language> dance songs",
 * "<language> mass songs", "<language> melody songs", "<language> sad songs",
 * "<language> romantic songs", "<language> devotional songs",
 * "<language> evergreen hits"): the catalogue answers a longer description
 * such as "telugu high energy workout songs" with nothing at all.
 *
 * 8.3.0 — a named style leads with the style's own phrases ("<language> dj
 * remix", "<language> remix songs", "<language> folk songs"), and the
 * activity a word like "dj" implies (party) adds nothing generic after them:
 * "telugu dj songs" asks for DJ remixes, not film dance numbers.
 */
export function catalogQueries(intent: MusicIntent, fallbackLanguages: readonly string[] = [], max = 4): string[] {
  if (intent.style) return styleCatalogQueries(intent, intent.style, intent.languages.length ? intent.languages : fallbackLanguages.slice(0, 2), max);
  // 8.3.1 — words and a language but no mood, activity, energy or era ("telugu dj tillu movie songs"):
  // the words are a name, and the catalogue is asked for them first.
  const named = intent.cues === intent.languages.length ? keywordQuery(intent) : null;
  if (named) return [named, ...catalogQueries({ ...intent, keywords: [] }, fallbackLanguages, max)].filter((q, i, all) => all.indexOf(q) === i).slice(0, max);
  const terms: string[] = [];
  const add = (...t: string[]) => {
    for (const x of t) if (!terms.includes(x)) terms.push(x);
  };
  // 8.5.0 — probed live 2026-09-30: "<lang> instrumental", "<lang> acoustic songs" and
  // "<lang> unplugged" answer 20/20 in-language; "<lang> slow songs" matches titles like "Slow Motion".
  if (intent.instrumental) add('instrumental');
  if (intent.tempo === 'slow') add('acoustic songs', 'unplugged');
  if (intent.era === 'classic') add('evergreen hits');
  switch (intent.activity) {
    case 'workout':
    case 'party':
    case 'wedding':
      add('dance songs', 'mass songs');
      break;
    case 'drive':
    case 'travel':
      add('dance songs', 'melody songs');
      break;
    case 'focus':
    case 'sleep':
      add('melody songs');
      break;
    case 'rain':
      add(intent.moods.includes('melancholy') ? 'sad songs' : 'melody songs', 'melody songs');
      break;
    default:
      break;
  }
  for (const mood of intent.moods) {
    if (mood === 'energetic') add('dance songs', 'mass songs');
    else if (mood === 'melancholy') add('sad songs');
    else if (mood === 'romantic') add('romantic songs');
    else if (mood === 'devotional') add('devotional songs');
    else if (mood === 'chill') add('melody songs');
  }
  if (intent.energy === 'high') add('dance songs');
  if (intent.energy === 'low') add('melody songs');
  const langs = intent.languages.length ? intent.languages : fallbackLanguages.slice(0, 2);
  if (intent.era === 'fresh') {
    return (langs.length ? langs : ['']).map((l) => `latest ${l ? `${l} ` : ''}songs ${CURRENT_YEAR}`).concat(terms.map((t) => (langs[0] ? `${langs[0]} ${t}` : t))).slice(0, max);
  }
  if (!terms.length) add('melody songs', 'dance songs');
  const out: string[] = [];
  // Interleave languages so a two-language request gets both early.
  for (const t of terms) for (const l of langs.length ? langs : ['']) out.push(l ? `${l} ${t}` : t);
  return [...new Set(out)].slice(0, max);
}

const MOOD_TERM: Record<IntentMood, string> = { energetic: 'dance songs', melancholy: 'sad songs', romantic: 'romantic songs', devotional: 'devotional songs', chill: 'melody songs' };

/** Words that name nothing the catalogue can search for ("movie songs", "film songs"). */
const QUERY_NOISE = new Set(['movie', 'movies', 'film', 'films', 'cinema', 'album', 'albums', 'soundtrack', 'ost', 'tonight', 'today', 'now']);
const STYLE_WORD: Record<MusicStyle, string> = { dj: 'remix', folk: 'folk', devotional: 'devotional' };

/** The request's own words (a singer, a film, a song), without noise and — in a style request — the style's words; null when there are none. */
function keywordQuery(intent: MusicIntent): string | null {
  const styleWord = (w: string): boolean => !!intent.style && (w === 'mix' || !!styleFromText(w));
  const kw = intent.keywords.filter((w) => !QUERY_NOISE.has(w) && !styleWord(w)).slice(0, 4).join(' ');
  return kw.length >= 3 ? kw : null;
}

/**
 * The style's phrases in each language (interleaved), with the request's own
 * words in the style second ("arijit singh remix" for "arijit singh dj
 * remix"), then the moods the text also names, in the first language.
 */
function styleCatalogQueries(intent: MusicIntent, style: MusicStyle, langs: readonly string[], max: number): string[] {
  const out: string[] = [];
  const list = langs.length ? langs : [''];
  const phrases = list.map((l) => styleQueries(style, l || null, 0).map((q) => q.query));
  for (let i = 0; i < 2; i += 1) for (const p of phrases) if (p[i]) out.push(p[i]);
  const own = keywordQuery(intent);
  if (own) out.splice(1, 0, `${own} ${STYLE_WORD[style]}`);
  const lead = list[0] ? `${list[0]} ` : '';
  for (const mood of intent.moods) if (!(style === 'devotional' && mood === 'devotional') && !(style === 'dj' && mood === 'energetic')) out.push(`${lead}${MOOD_TERM[mood]}`);
  return [...new Set(out)].slice(0, max);
}

/** A short title for a playlist built from an intent ("Telugu Workout Mix"). */
export function intentTitle(intent: MusicIntent): string {
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const lang = intent.languages[0] ? cap(intent.languages[0]) + ' ' : '';
  if (intent.style) return `${lang}${intent.style === 'dj' ? 'DJ Remix' : cap(intent.style)} Mix`;
  if (intent.activity) return `${lang}${cap(intent.activity)} Mix`;
  const mood = intent.moods[0];
  const moodName: Record<IntentMood, string> = { romantic: 'Romance', energetic: 'Energy', chill: 'Chill', melancholy: 'Heartbreak', devotional: 'Devotion' };
  if (mood) return `${lang}${moodName[mood]} Mix`;
  if (intent.era === 'classic') return `${lang}Evergreen Mix`;
  return `${lang}Mix`.trim();
}
