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
 *   text  — the title, the album name, the subtitle (search results carry
 *           "Artist - Album" there) and the credited artists. Folk songs
 *           rarely say so in their title; their ALBUM does ("Telugu Folk
 *           Songs Telangana Janapadalu Vol - 6"). DJ remixes say it in the
 *           title ("Nadakallo Nadaka (DJ Remix Song Version 5)"). An album
 *           counts as DJ only with a phrase ("DJ Songs", "DJ Remix",
 *           "Remix"), so a film called "DJ Tillu" does not make its whole
 *           soundtrack a DJ set; a credited "DJ" artist does count.
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

/** In a title: "DJ", "Remix", "Remixes", "Remixed". */
const DJ_TITLE = /\b(?:dj|remix(?:es|ed)?)\b/;
/** In an album name or a subtitle: a DJ PHRASE, never a bare "DJ" (a film can be called that). */
const DJ_ALBUM = /\bdj\s+(?:songs?|remix(?:es)?|mix(?:es)?|hits|beats?|version|special)\b|\bremix(?:es|ed)?\b|\b(?:folk|telugu|hindi|tamil|kannada|marathi|bhojpuri|punjabi|malayalam|gujarati|bengali|odia|nonstop|non stop)\s+dj\b/;
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
 * bhakti / bhajan / keerthana / stotram / suprabhatam / chalisa / aarti /
 * abhang / shabad and their spellings. Deity names alone ("Hanuman",
 * "Krishna") are NOT enough — films and love songs use them too.
 */
const DEVOTIONAL = /\b(?:devotional|bhakti|bhakthi|bhaktimala|bhajans?|bhajana|bhajanalu|aarti|aarathi|harathi|kirtans?|keerthana(?:m|ms|lu|s)?|keertanalu|stotram|stothram|stotra|stotras|suprabhatam|suprabhatham|chalisa|namavali|sahasranamam|ashtakam|slokas?|shlokas?|abhangs?|shabad|gurbani|mantram)\b/;

const META: Record<MusicStyle, RegExp> = {
  dj: /\b(?:dj|remix(?:es)?|edm|electronic|club)\b/,
  folk: /\bfolk\b|\bjaa?napad/,
  devotional: /\b(?:devotional|bhajan|bhakti|spiritual)\b/,
};

const low = (v: string | null | undefined): string => String(v ?? '').normalize('NFKC').toLowerCase();

/**
 * What a song shows of each style, and how strongly. Empty for an ordinary
 * song. A song may show two ("Telugu Folk DJ Songs, Vol. 2" is folk AND DJ;
 * "DJ Remix Teri Bhakti Mei Mera Man Dole" is devotional AND DJ).
 */
export function styleEvidence(song: Song | null | undefined): Partial<Record<MusicStyle, StyleStrength>> {
  const out: Partial<Record<MusicStyle, StyleStrength>> = {};
  if (!song) return out;
  const title = low(song.title);
  const album = low(song.album?.name);
  const subtitle = low(song.subtitle);
  const words = `${title} | ${album} | ${subtitle}`;
  if (DJ_TITLE.test(title) || DJ_ALBUM.test(album) || DJ_ALBUM.test(subtitle) || (song.artists ?? []).some((a) => DJ_ARTIST.test(low(a?.name)))) out.dj = 'text';
  if (FOLK.test(words)) out.folk = 'text';
  if (DEVOTIONAL.test(words)) out.devotional = 'text';
  const meta = [song.genre, ...(song.genres ?? []), ...(song.vibes ?? [])].map(low).join(' | ');
  for (const style of MUSIC_STYLES) if (!out[style] && META[style].test(meta)) out[style] = 'meta';
  if (!out.devotional && low(song.mood) === 'devotional') out.devotional = 'meta';
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

/**
 * A style named in free text: "telugu dj songs", "dj remix", "folk songs",
 * "janapadalu", "palle patalu", "lok geet", "bhajans". DJ wins over folk
 * ("folk dj songs" asks for the DJ sound), folk over devotional.
 */
export function styleFromText(text: string | null | undefined): MusicStyle | null {
  const t = low(text);
  if (!t.trim()) return null;
  if (/\b(?:dj|remix(?:es|ed)?)\b/.test(t)) return 'dj';
  if (FOLK.test(t)) return 'folk';
  if (DEVOTIONAL.test(t)) return 'devotional';
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

export interface SessionStyleInput {
  seed: Song | null;
  /** Songs that played before the seed, newest first (the seed itself is ignored if present). */
  recent?: Song[];
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
 */
export function sessionStyle(input: SessionStyleInput): ActiveStyle | null {
  const fromTune = tuneStyle(input.tune);
  if (fromTune) return { style: fromTune, from: 'tune', reinforced: true };
  if (!input.tune && low(input.moodPin) === 'devotional') return { style: 'devotional', from: 'tune', reinforced: true };
  const found = styleOfSession(input);
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
const REMIX_DASH = /\s+[-–—]\s+[^-–—]*\b(?:dj|remix(?:es|ed)?)\b[^-–—]*/g;
const REMIX_DRESSING = /\b(?:dj|remix(?:es|ed)?|song|official)\b|\bversion\s*\d*\b/g;

/**
 * The song a remix is a remix OF, ignoring who remixed it: "Nadakallo Nadaka
 * (DJ Remix Song Version 5)" by one DJ and "Nadakallo Nadaka - Dj Remix" by
 * another are one work here. The identity contract (identityCore) keeps the
 * primary artist in its key on purpose — two singers' songs of one title are
 * two songs — so this looser key is used only inside a style session, where
 * several remixers of one folk hit is exactly the repetition to avoid.
 */
export function remixWorkKey(song: Song): string {
  const base = canonicalKey(song.title, '').split('|')[0];
  const words = low(song.title)
    .replace(/[([{].*?[)\]}]/g, ' ')
    .replace(REMIX_DASH, ' ')
    .replace(REMIX_CREDIT, ' ')
    .replace(REMIX_DRESSING, ' ')
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, '');
  return words || base;
}
