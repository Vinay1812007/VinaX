import type { Song } from '@/types';
import { canonicalKey } from './identityCore';

/**
 * 8.3.0 — the listener's STYLE: DJ remixes, folk songs or devotional songs.
 *
 * A style is not a mood. A Telugu DJ remix, a Telangana janapada song and a
 * film love song can all be "energetic", yet a listener who is playing DJ
 * remixes wants more DJ remixes next — not the film songs a mood match would
 * bring. So the next-song engine keeps a style going on purpose: a candidate
 * source that asks the catalogue for the style (`styleQueries`), a boost for
 * songs in the style and a cost for songs outside it (weights.ts,
 * STYLE_WEIGHTS), and a validation rule that most of each stretch stays in
 * the style while the pool allows it.
 *
 * How a song's style is read (`styleEvidence`):
 *   text  — the title, the album name (or, when a row has none, the album
 *           part of its "Artist - Album" subtitle; 8.3.1 — never the
 *           artists' names, so a singer called Aarti is not an aarti) and
 *           the credited artists (a "DJ …" artist). Folk songs
 *           rarely say so in their title; their ALBUM does ("Telugu Folk
 *           Songs Telangana Janapadalu Vol - 6"). DJ remixes say it in the
 *           title ("Nadakallo Nadaka (DJ Remix Song Version 5)"). An album
 *           counts as DJ only with a phrase ("DJ Songs", "DJ Remix",
 *           "Remix"), so a film called "DJ Tillu" does not make its whole
 *           soundtrack a DJ set — nor does `(From "DJ Tillu")` in a title
 *           (8.3.1); a credited "DJ" artist does count.
 *   meta  — the catalogue's or the classifier's genre, genres and mood
 *           ("folk", "devotional"): a weaker signal, and a guess when the
 *           classifier made it. It counts when scoring a candidate, but it
 *           starts a style session only when the last plays SAY the style in
 *           their words (`sessionStyle`).
 *
 * Every match is on word boundaries, so "Folkshake" is not folk and
 * "Remixed Feelings" is a remix only because it says "remixed".
 */
export type MusicStyle = 'dj' | 'folk' | 'devotional';

export const MUSIC_STYLES: readonly MusicStyle[] = ['dj', 'folk', 'devotional'];

/** How strongly a song shows a style: in its words (title, album, credits) or only in genre/mood metadata. */
export type StyleStrength = 'text' | 'meta';

/** Remix words: in a title or album they make a song a DJ remix on their own. */
const REMIX = /\bremix(?:es|ed)?\b/;
/** Regional words that name the DJ sound when they stand right before "dj" ("Telugu DJ", "Banjara Folk DJ Songs"). */
const DJ_LEAD = 'folk|telugu|telangana|banjara|hindi|tamil|kannada|marathi|bhojpuri|punjabi|malayalam|gujarati|bengali|odia|rajasthani|haryanvi|bonalu|dappu|nonstop|non stop';
/** In an album name: a DJ PHRASE, never a bare "DJ" (a film can be called that). */
const DJ_ALBUM = new RegExp(String.raw`\bdj\s+(?:songs?|remix(?:es)?|mix(?:es)?|hits|beats?|version|special)\b|\bremix(?:es|ed)?\b|\b(?:${DJ_LEAD})\s+dj\b`);
/**
 * 8.3.1 — a bare "DJ" in a TITLE counts only with a cue that it is the DJ
 * version: a DJ phrase ("DJ Song", "DJ Mix", "Folk DJ"), a mix / version /
 * beats / hits / nonstop word elsewhere in the title ("DJ Wale Babu (Hip Hop
 * Mix)"), a leading "DJ" on a devotional song ("DJ Hanuman Chalisa"),
 * a DJ credit in brackets or after a dash ("(Dj Kamlesh)", "- Dj John"), or a
 * trailing "DJ" tag ("Ededu Dappulla Bonalu DJ"). Songs ABOUT a DJ
 * ("Tillu Anna DJ Pedithe", "DJ Pe Matkungi") are ordinary songs.
 */
const DJ_TITLE_CUE = new RegExp(
  String.raw`\bdj\s+(?:songs?|remix(?:es)?|mix(?:es)?|hits|beats?|version|special|mashup|non\s*stop)\b|\b(?:${DJ_LEAD}|beats?|mix)\s+dj\b|\b(?:mix(?:es)?|version|beats?|mashup|hits|non\s*stop)\b|[([]\s*dj\s+[^)\]\s]|[-–—]\s*dj\s+\S|\S\s+dj\s*$`,
);
/** A film credit in a title: `(From "DJ Tillu")`, `[From "DJ"]`, `(From"DJ")` — the film's name, not the song's style. */
const FROM_CREDIT = /[([]?\s*\bfrom\s*["“][^"“”]*["”]\s*[)\]]?/g;
/** A credited artist who is a DJ ("DJ Snake", "Dj Ganesh Bayyanagudem"). */
const DJ_ARTIST = /^\s*dj\b|\bdj\s*$/;

/**
 * Folk in any Indian language's own words: janapada / janapadalu (Telugu,
 * Kannada), palle patalu (Telugu village songs), lok geet (Hindi, Bhojpuri,
 * Marathi lokgeete), nattupura / gramiya (Tamil), nadan pattu (Malayalam),
 * and "folk" itself ("Folku" in Tamil film credits).
 */
const FOLK = /\bfolku?\b|\bjaa?napad(?:a|alu|am|ulu)?\b|\bpalle\s*pat(?:a|alu|aalu)\b|\blok\s*geet(?:e|h|s)?\b|\blokgeet(?:e|h|s)?\b|\bnaa?ttupura\b|\bgramiya\b|\bnaa?dan\s*paatt?(?:u|ukal)\b/;

/**
 * Devotional words that do not also name films or people: "devotional",
 * bhajan / keerthanam / stotram / suprabhatam / chalisa / abhang / shabad
 * and their spellings. Deity names alone ("Hanuman", "Krishna") are NOT
 * enough — films and love songs use them too.
 */
const DEVOTIONAL = /\b(?:devotional|devotionals|bhaktimala|bhajans?|bhajana|bhajanalu|aartis|aartiyan|aartiyaan|aartya|kirtans?|keerthanam|keerthanams|keerthanalu|keertanalu|stotram|stothram|stotra|stotras|suprabhatam|suprabhatham|chalisa|namavali|sahasranamam|ashtakam|slokas?|shlokas?|abhangs?|shabad|gurbani|mantram)\b/;
/**
 * 8.3.1 — devotional words that are also people's names: Aarti Mukherji
 * sings film songs, "Keerthana" is an Ilaiyaraaja love song. They count in
 * an ALBUM ("Aarti Vol-3", "Annamayya Keerthana, Vol. 1"), or in a title with
 * a second cue — a deity ("Ganesh Aarti", "Aarti Kunj Bihari Ki").
 */
const DEVOTIONAL_NAME = /\b(?:aarti|aarathi|harathi|bhakti|bhakthi|keerthanas?)\b/;
const DEITY = /\b(?:ganesh(?:a|ji)?|ganpati|ganapath?i|vinayaka?|hanuman|bajrang|sai\s*(?:baba|ram|nath)|shiva?|shivji|shankara|mahadev|bholenath|krishna|govinda?|bihari|shyam|rama|ramji|raghava|lakshmi|laxmi|durga|ambe|mata|maiya|jagdish|venkatesw?ara|balaji|srinivasa|ayyappa|murugan?|amman|yesu|jesus|christ|prabhu|bhagwan|ishwar|om)\b/;

const META: Record<MusicStyle, RegExp> = {
  dj: /\b(?:dj|remix(?:es)?|edm|electronic|club)\b/,
  folk: /\bfolk\b|\bjaa?napad/,
  devotional: /\b(?:devotional|bhajan|bhakti|spiritual)\b/,
};

const low = (v: string | null | undefined): string => String(v ?? '').normalize('NFKC').toLowerCase();
const bare = (v: string): string => v.replace(/[([{].*?[)\]}]/g, ' ').replace(/[^\p{L}\p{N}]+/gu, '');

/** Remove the credited artists' names from a piece of text ("aarti mukherji - masoom" → " - masoom"), whole words only. */
function withoutNames(text: string, names: readonly string[]): string {
  let out = text;
  const edge = (c: string | undefined): boolean => c === undefined || !/[\p{L}\p{N}]/u.test(c);
  for (const n of names) {
    if (n.length < 3) continue;
    for (let at = out.indexOf(n); at >= 0; at = out.indexOf(n, at + 1)) {
      if (edge(out[at - 1]) && edge(out[at + n.length])) out = `${out.slice(0, at)} ${out.slice(at + n.length)}`;
    }
  }
  return out;
}

/**
 * The words a song's style is read from. The subtitle is "Artists - Album"
 * (or just the artists), so it only stands in for a missing album, and the
 * credited artists' names are taken out of it and of the album: a singer
 * called Aarti is not an aarti.
 */
function styleText(song: Song): { title: string; album: string; credits: string[] } {
  const names = (song.artists ?? []).map((a) => low(a?.name).trim()).filter(Boolean);
  const subtitle = low(song.subtitle);
  const dash = subtitle.indexOf(' - ');
  // The subtitle's artist part ("DJ Saikiran Tillu ft. SBS Musicals") names credits too, when `artists` is short.
  const subNames = (dash >= 0 ? subtitle.slice(0, dash) : subtitle).split(/\s*(?:,|&|\bft\.?|\bfeat\.?)\s*/).map((n) => n.trim()).filter(Boolean);
  const credits = [...names, ...subNames];
  let album = song.album?.name ? low(song.album.name) : '';
  if (!album && dash >= 0) {
    const rest = withoutNames(subtitle, credits);
    const at = rest.indexOf(' - ');
    album = at >= 0 ? rest.slice(at + 3) : '';
  }
  return { title: low(song.title), album: withoutNames(album, credits), credits };
}

/** Is the title a DJ remix / DJ version? (See DJ_TITLE_CUE.) */
function djTitle(title: string, album: string): boolean {
  const t = title.replace(FROM_CREDIT, ' ').replace(/\s+/g, ' ').trim();
  if (REMIX.test(t)) return true;
  if (!/\bdj\b/.test(t)) return false;
  // A film called "DJ…" ("DJ", "DJ Tillu"): its album has a bare "DJ" that is no DJ phrase — so is the title's.
  if (/\bdj\b/.test(album) && !DJ_ALBUM.test(album) && bare(album) !== bare(t)) return false;
  // "DJ Hanuman Chalisa": a DJ version of a devotional song.
  return DJ_TITLE_CUE.test(t) || (/^dj\s/.test(t) && DEVOTIONAL.test(t));
}

/** Devotional in words: a devotional word anywhere, a name-like one in the album, or in the title with a deity. */
function devotionalText(title: string, album: string): boolean {
  if (DEVOTIONAL.test(title) || DEVOTIONAL.test(album) || DEVOTIONAL_NAME.test(album)) return true;
  return DEVOTIONAL_NAME.test(title) && DEITY.test(`${title} | ${album}`);
}

/** 8.3.1 — songs are immutable here (enrichment makes new objects), so each one is read once. */
const evidenceCache = new WeakMap<Song, Partial<Record<MusicStyle, StyleStrength>>>();

/**
 * What a song shows of each style, and how strongly. Empty for an ordinary
 * song. A song may show two ("Telugu Folk DJ Songs, Vol. 2" is folk AND DJ;
 * "DJ Remix Teri Bhakti Mei Mera Man Dole" is devotional AND DJ).
 */
export function styleEvidence(song: Song | null | undefined): Partial<Record<MusicStyle, StyleStrength>> {
  if (!song) return {};
  const hit = evidenceCache.get(song);
  if (hit) return hit;
  const out: Partial<Record<MusicStyle, StyleStrength>> = {};
  const { title, album, credits } = styleText(song);
  if (djTitle(title, album) || DJ_ALBUM.test(album) || credits.some((n) => DJ_ARTIST.test(n))) out.dj = 'text';
  if (FOLK.test(`${title} | ${album}`)) out.folk = 'text';
  if (devotionalText(title, album)) out.devotional = 'text';
  const meta = [song.genre, ...(song.genres ?? []), ...(song.vibes ?? [])].map(low).join(' | ');
  for (const style of MUSIC_STYLES) if (!out[style] && META[style].test(meta)) out[style] = 'meta';
  if (!out.devotional && low(song.mood) === 'devotional') out.devotional = 'meta';
  Object.freeze(out);
  evidenceCache.set(song, out);
  return out;
}

/** Every style the song shows, strongest evidence first, then in MUSIC_STYLES order. */
export function songStyles(song: Song | null | undefined): MusicStyle[] {
  const ev = styleEvidence(song);
  const found = MUSIC_STYLES.filter((s) => ev[s]);
  return [...found.filter((s) => ev[s] === 'text'), ...found.filter((s) => ev[s] === 'meta')];
}

/** The song's style (its strongest; DJ before folk before devotional on a tie), or null for an ordinary song. */
export function songStyle(song: Song | null | undefined): MusicStyle | null {
  return songStyles(song)[0] ?? null;
}

/** Does the song belong to this style (either strength)? */
export function matchesStyle(song: Song | null | undefined, style: MusicStyle | null | undefined): boolean {
  return !!style && !!styleEvidence(song)[style];
}

/** The style a song SAYS in its words (title, album, credits) — never a genre or mood guess. Null when none. */
export function songTextStyle(song: Song | null | undefined): MusicStyle | null {
  const ev = styleEvidence(song);
  return MUSIC_STYLES.find((s) => ev[s] === 'text') ?? null;
}

/** Words that turn a cue around when they come just before it ("without remix", "no dj songs", "not folk"). */
const NEGATION = new Set(['no', 'not', 'without', 'avoid', 'except', 'minus', 'skip', 'dont', "don't", 'never', 'nothing']);
/**
 * 8.3.1 — style cues in free text. "dj" alone is a film ("DJ Tillu") or a
 * word in a title; it asks for DJ remixes only next to a DJ word ("dj
 * remix", "dj songs", "dj mix"), at the end after a language ("telugu dj"),
 * or on its own. Remix words count anywhere. Name-like devotional words
 * ("aarti", "bhakti", "keerthana")
 * count next to "songs" / "geet" or with a deity ("ganesh aarti"), never in
 * "aarti mukherjee songs". A few native-script words count too: listeners
 * type भजन or జానపద.
 */
const TEXT_CUES: Record<MusicStyle, RegExp[]> = {
  dj: [
    /\bremix(?:es|ed)?\b/g,
    new RegExp(String.raw`\bdj\s+(?:songs?|remix(?:es)?|mix(?:es)?|hits|beats?|version|special|mashup|non\s*stop)\b|\b(?:${DJ_LEAD}|beats?|mix)\s+dj\s*$|^\s*dj\s*$`, 'g'),
    /रीमिक्स|రీమిక్స్|ரீமிக்ஸ்|ರೀಮಿಕ್ಸ್|डीजे\s*(?:गाने|सॉन्ग|रीमिक्स)|డీజే\s*(?:పాటలు|సాంగ్స్)/g,
  ],
  folk: [new RegExp(FOLK.source, 'g'), /लोक\s*गीत|लोकगीत|జానపద|ಜಾನಪದ|நாட்டுப்புற|നാടൻ\s*പാട്ട്/g],
  devotional: [
    new RegExp(DEVOTIONAL.source, 'g'),
    /\b(?:aarti|aarathi|harathi|bhakti|bhakthi|keerthana)\s+(?:songs?|geet|geete|geethalu|geetalu|gana|gaana|sangrah|sagar|padalgal)\b/g,
    /भजन|भक्ति|భక్తి|ಭಕ್ತಿ|பக்தி|ഭക്തി|కీర్తనలు/g,
  ],
};

const DEVOTIONAL_NAME_G = new RegExp(DEVOTIONAL_NAME.source, 'g');

/** Is some match of `re` in `t` free of a negation within the three words before it (in its own clause)? */
function saysCue(t: string, re: RegExp): boolean {
  re.lastIndex = 0;
  for (let m = re.exec(t); m; m = re.exec(t)) {
    const clause = t.slice(0, m.index).split(/[,.;:!?]|\bbut\b|\bonly\b/).pop() ?? '';
    const before = clause.trim().split(/\s+/).slice(-3);
    if (!before.some((w) => NEGATION.has(w))) return true;
    if (m[0].length === 0) re.lastIndex += 1;
  }
  return false;
}

/**
 * A style named in free text: "telugu dj songs", "dj remix", "folk songs",
 * "janapadalu", "palle patalu", "lok geet", "bhajans". DJ wins over folk
 * ("folk dj songs" asks for the DJ sound), folk over devotional. A cue the
 * text turns down ("arijit singh songs without remix") names no style.
 */
export function styleFromText(text: string | null | undefined): MusicStyle | null {
  const t = low(text).replace(/\s+/g, ' ');
  if (!t.trim()) return null;
  for (const style of MUSIC_STYLES) {
    if (TEXT_CUES[style].some((re) => saysCue(t, re))) return style;
    // A name-like devotional word with a deity in the words ("ganesh aarti", "hanuman bhakti").
    if (style === 'devotional' && saysCue(t, DEVOTIONAL_NAME_G) && DEITY.test(t)) return style;
  }
  return null;
}

/**
 * What an active "Tune this queue" intent means for the style: the style it
 * asks for, `null` when it steers somewhere else (a mood — the listener asked
 * for a change of direction), or `undefined` when it leaves the style alone
 * (language and era tunes, or no tune at all).
 */
export function tuneStyle(tune: string | null | undefined): MusicStyle | null | undefined {
  switch (tune) {
    case 'dj':
    case 'folk':
    case 'devotional':
      return tune;
    case 'energetic':
    case 'chill':
    case 'romantic':
    case 'melody':
    case 'mass':
    case 'heartbreak':
      return null;
    default:
      return undefined;
  }
}

/**
 * Mood tunes that go WITH a style rather than away from it: "More energetic"
 * or "More beats" over a DJ remix (or a folk song — Telangana janapadalu are
 * dappu-driven dance songs) asks for more of the same, as does "More chill"
 * or "More melody" over a bhajan. Any other mood tune is a change of direction.
 */
const STYLE_FRIENDLY_TUNES: Record<MusicStyle, readonly string[]> = {
  dj: ['energetic', 'mass'],
  folk: ['energetic', 'mass'],
  devotional: ['chill', 'melody'],
};

export interface ActiveStyle {
  style: MusicStyle;
  /** Where it came from: a tune (or a pinned devotional mood), the seed song, or the run of plays behind it. */
  from: 'tune' | 'seed' | 'session';
  /** Two of the last three plays share it (or the listener asked for it). */
  reinforced: boolean;
}

/** One play of this sitting, and whether the listener skipped it. */
export interface StylePlay {
  song: Song;
  skipped: boolean;
}

export interface SessionStyleInput {
  seed: Song | null;
  /** Songs that played before the seed, newest first (the seed itself is ignored if present). Leave skipped plays out: a skip does not say the style. */
  recent?: Song[];
  /** 8.3.1 — this sitting's plays, newest first, with the listener's skips (see `turnedAway`). */
  sitting?: StylePlay[];
  /** The song this stretch will follow in the queue, when it is not the seed. */
  previous?: Song | null;
  tune?: string | null;
  moodPin?: string | null;
}

/** How many of the last three plays say this style in their words (title, album, credits). */
function lastThree(recent: Song[], style: MusicStyle): number {
  return recent.slice(0, 3).filter((s) => styleEvidence(s)[style] === 'text').length;
}

/**
 * 8.3.1 — the listener has turned away from a style: its last two (or more)
 * songs this sitting were skipped, with none of its songs finished since. A
 * style the songs set (not a tune the listener asked for) ends there, until
 * a song in it is played through again.
 */
export function turnedAway(sitting: readonly StylePlay[], style: MusicStyle): boolean {
  let skips = 0;
  for (const play of sitting) {
    if (styleEvidence(play.song)[style] !== 'text') continue;
    if (!play.skipped) break;
    skips += 1;
  }
  return skips >= 2;
}

/**
 * The style the listener is in, or null.
 *
 *   1. A tune decides first: "DJ remix", "Folk" or "Devotional" sets the
 *      style; a mood tune clears it unless it goes with the style
 *      (STYLE_FRIENDLY_TUNES: "More energetic" over a DJ remix); a language
 *      or era tune leaves it. A pinned devotional mood sets devotional.
 *   2. A seed that says its style in words (title, album, credits) sets it.
 *      When it shows two, the one the last plays share wins.
 *   3. A seed whose style is only in genre/mood metadata sets it when two of
 *      the last three plays say it in their words.
 *   4. A seed with no style: the style carries on only while the queue is
 *      still in it — the song this stretch follows is in the style and two
 *      of the last three plays said it too (an automatic pick that strayed).
 *      A song the listener started themselves arrives as a fresh queue
 *      (nothing after it, or its own album after it), so playing an
 *      ordinary song by hand clears the style.
 *   5. Steps 2–4 give way when the listener has skipped the style's last two
 *      songs this sitting (`turnedAway`).
 */
export function sessionStyle(input: SessionStyleInput): ActiveStyle | null {
  const fromTune = tuneStyle(input.tune);
  if (fromTune) return { style: fromTune, from: 'tune', reinforced: true };
  if (!input.tune && low(input.moodPin) === 'devotional') return { style: 'devotional', from: 'tune', reinforced: true };
  const found = styleOfSession(input);
  if (found && input.sitting && turnedAway(input.sitting, found.style)) return null;
  if (fromTune === null) return found && STYLE_FRIENDLY_TUNES[found.style].includes(String(input.tune)) ? found : null;
  return found;
}

/** Steps 2–4 of `sessionStyle`: the style the songs themselves are in. */
function styleOfSession(input: SessionStyleInput): ActiveStyle | null {
  const seed = input.seed;
  const recent = (input.recent ?? []).filter((s) => s && s.id !== seed?.id);
  const ev = styleEvidence(seed);
  const shown = songStyles(seed);
  const pick = (styles: MusicStyle[]): { style: MusicStyle; shared: number } | null => {
    let best: { style: MusicStyle; shared: number } | null = null;
    for (const style of styles) {
      const shared = lastThree(recent, style);
      if (!best || shared > best.shared) best = { style, shared };
    }
    return best;
  };
  const worded = pick(shown.filter((s) => ev[s] === 'text'));
  if (worded) return { style: worded.style, from: 'seed', reinforced: worded.shared >= 2 };
  const meta = pick(shown);
  if (meta && meta.shared >= 2) return { style: meta.style, from: 'session', reinforced: true };
  const previous = input.previous ?? null;
  if (!seed || !previous || previous.id === seed.id) return null;
  const carried = pick(songStyles(previous));
  return carried && carried.shared >= 2 ? { style: carried.style, from: 'session', reinforced: true } : null;
}

/**
 * The catalogue searches that fetch a style, in the queue's language.
 * Probed live on 2026-09-28: "<language> dj remix" and "<language> remix
 * songs" return 20 of 20 in-language remixes (Telugu, Hindi, Tamil, Kannada,
 * Punjabi, Malayalam, Bhojpuri, Marathi); "<language> folk songs" and
 * "<language> devotional songs" return 20 of 20 and page on. "dj songs"
 * without a language comes back language-mixed and "telugu dj songs" holds
 * only 7, so neither is used. `salt` rotates the page (and, for DJ, which
 * phrase goes first), so two continuations from the same song reach
 * different songs.
 */
export function styleQueries(style: MusicStyle, language: string | null | undefined, salt = 0): Array<{ query: string; page: number }> {
  const lang = language && language !== 'unknown' ? `${language} ` : '';
  const s = Math.abs(Math.floor(salt));
  if (style === 'dj') {
    const phrases = [`${lang}dj remix`, `${lang}remix songs`];
    const first = s % 2;
    return [
      { query: phrases[first], page: 1 + (Math.floor(s / 2) % 2) },
      { query: phrases[1 - first], page: 1 },
    ];
  }
  const query = style === 'folk' ? `${lang}folk songs` : `${lang}devotional songs`;
  return [
    { query, page: 1 + (s % 3) },
    { query, page: 1 + ((s + 1) % 3) },
  ];
}

/** The one catalogue phrase for a style (AI Radio seeds, a style tune, the playlist pool). */
export function stylePhrase(style: MusicStyle, language: string | null | undefined): string {
  return styleQueries(style, language, 0)[0].query;
}

/** How the style is named in plain words. */
export function styleLabel(style: MusicStyle): string {
  return style === 'dj' ? 'DJ remix' : style;
}

/** The "Why this song?" line for a song that keeps the style going. */
export function styleWhy(style: MusicStyle): string {
  switch (style) {
    case 'dj':
      return 'Keeps the DJ remix going';
    case 'folk':
      return 'More folk songs, like the one playing';
    case 'devotional':
      return 'More devotional songs, like the one playing';
  }
}

/** The line for a song held back because it is outside the style. */
export function offStyleWhy(style: MusicStyle): string {
  return `Held back — not a ${styleLabel(style)} song`;
}

/** Words that dress a remix up without changing which song it is ("Remix By Dj Nitish", "Dj Remix Song Version 5"). */
const REMIX_CREDIT = /\b(?:remix(?:ed)?\s+)?by\s+dj\b.*$|\bremix(?:ed)?\s+by\b.*$/;
/** A dashed part that is dressing or a credit ("- Dj Remix", "- Dj John"), up to the next dash. */
const REMIX_DASH = /\s+[-–—]\s*[^-–—]*?\b(?:dj|remix(?:es|ed)?)\b[^-–—]*?(?=\s+[-–—]|$)/g;
const REMIX_DRESSING = /\b(?:dj|remix(?:es|ed)?|song|official)\b|\bversion\s*\d*\b/g;

/**
 * The song a remix is a remix OF, ignoring who remixed it: "Nadakallo Nadaka
 * (DJ Remix Song Version 5)" by one DJ and "Nadakallo Nadaka - Dj Remix" by
 * another are one work here. The identity contract (identityCore) keeps the
 * primary artist in its key on purpose — two singers' songs of one title are
 * two songs — so this looser key is used only inside a style session, where
 * several remixers of one folk hit is exactly the repetition to avoid. A
 * title that is ALL dressing ("DJ", "Remix") names no song, so it keeps its
 * lead artist: two different songs called "DJ" stay two.
 */
export function remixWorkKey(song: Song): string {
  const base = canonicalKey(song.title, '').split('|')[0];
  const words = low(song.title)
    .replace(/[([{].*?[)\]}]/g, ' ')
    .replace(REMIX_DASH, ' ')
    .replace(REMIX_CREDIT, ' ')
    .replace(REMIX_DRESSING, ' ')
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, '');
  if (words) return words;
  const lead = low(song.artists?.[0]?.name ?? song.subtitle?.split(/,| - /)[0]).replace(/[^\p{L}\p{N}\p{M}]+/gu, '');
  return `${base || 'untitled'}|${lead}`;
}
