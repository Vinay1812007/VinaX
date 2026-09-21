/**
 * Matching a raw trend item to ONE catalogue recording — or refusing to.
 *
 * A chart entry is a video title such as
 *   "Chuttamalle - Lyrical | Devara Part - 1 | NTR | Janhvi Kapoor | Anirudh | Shilpa Rao"
 * and the catalogue holds songs with a title, credited artists and an album
 * (for film songs, the film). The steps:
 *
 *   1. parseSourceTitle — split on the usual separators ("|", " - ", ":"),
 *      drop presentation words ("Full Video Song", "Lyrical", "4K", …),
 *      read "(From X)" as the film, collect version words (remix, live,
 *      lofi, …) and a language named in the title, flag compilations,
 *      trailers and other non-songs, and flag short-form reuse ("#shorts",
 *      "original audio").
 *   2. search the catalogue (at most two queries per item, from a per-run
 *      budget) and score every candidate:
 *        title evidence   exact | phonetic | transliterated | partial | none
 *        corroboration    a credited artist agrees, the film agrees
 *      giving the confidence in CONFIDENCE (below). A transliteration across
 *      scripts is never enough on its own; it needs another signal.
 *   3. versions are recordings: the source's version tag must equal the
 *      candidate's (identityCore.versionTag), so a remix trend never maps to
 *      the original recording, nor the original to a remix. A language named
 *      in the title must equal the candidate's language (dubbed versions of a
 *      film song are different recordings).
 *   4. the best candidate becomes `matched` only at AUTO_MATCH_THRESHOLD or
 *      above AND when no candidate of a different song family scores within
 *      AMBIGUITY_MARGIN of it. Everything else goes to the review queue with
 *      a reason, and review items never reach listeners or autoplay.
 */
import { canonicalKey, normalizeIdentityText, versionTag } from '../identityCore';
import type { RawTrendItem } from './types';

export const AUTO_MATCH_THRESHOLD = 0.8;
export const AMBIGUITY_MARGIN = 0.05;

export type TitleLevel = 'exact' | 'phonetic' | 'transliterated' | 'partial' | 'none';

/** Confidence by title evidence × corroboration (artist and film both / one of them / neither). */
export const CONFIDENCE: Record<Exclude<TitleLevel, 'none'>, { both: number; one: number; none: number }> = {
  exact: { both: 0.98, one: 0.92, none: 0.7 },
  phonetic: { both: 0.9, one: 0.85, none: 0.6 },
  transliterated: { both: 0.85, one: 0.8, none: 0.5 },
  partial: { both: 0.75, one: 0.6, none: 0.3 },
};
/** Caps that keep a candidate out of automatic use whatever its title score. */
export const CAP = { versionMismatch: 0.45, languageMismatch: 0.45, shortForm: 0.5 } as const;

// ------------------------------------------------------------------ scripts --

/** Nine Brahmic scripts share one 128-code-point layout, so one offset table transliterates all of them. */
const INDIC_BLOCKS: Array<{ start: number; script: string }> = [
  { start: 0x0900, script: 'devanagari' },
  { start: 0x0980, script: 'bengali' },
  { start: 0x0a00, script: 'gurmukhi' },
  { start: 0x0a80, script: 'gujarati' },
  { start: 0x0b00, script: 'odia' },
  { start: 0x0b80, script: 'tamil' },
  { start: 0x0c00, script: 'telugu' },
  { start: 0x0c80, script: 'kannada' },
  { start: 0x0d00, script: 'malayalam' },
];

const VOWELS: Record<number, string> = { 0x05: 'a', 0x06: 'aa', 0x07: 'i', 0x08: 'ii', 0x09: 'u', 0x0a: 'uu', 0x0b: 'ri', 0x0c: 'li', 0x0e: 'e', 0x0f: 'e', 0x10: 'ai', 0x12: 'o', 0x13: 'o', 0x14: 'au' };
const CONSONANTS: Record<number, string> = {
  0x15: 'k', 0x16: 'kh', 0x17: 'g', 0x18: 'gh', 0x19: 'ng', 0x1a: 'ch', 0x1b: 'chh', 0x1c: 'j', 0x1d: 'jh', 0x1e: 'ny',
  0x1f: 't', 0x20: 'th', 0x21: 'd', 0x22: 'dh', 0x23: 'n', 0x24: 't', 0x25: 'th', 0x26: 'd', 0x27: 'dh', 0x28: 'n', 0x29: 'n',
  0x2a: 'p', 0x2b: 'ph', 0x2c: 'b', 0x2d: 'bh', 0x2e: 'm', 0x2f: 'y', 0x30: 'r', 0x31: 'r', 0x32: 'l', 0x33: 'l', 0x34: 'zh',
  0x35: 'v', 0x36: 'sh', 0x37: 'sh', 0x38: 's', 0x39: 'h',
  // Devanagari nukta forms.
  0x58: 'q', 0x59: 'kh', 0x5a: 'gh', 0x5b: 'z', 0x5c: 'd', 0x5d: 'rh', 0x5e: 'f', 0x5f: 'y',
};
const SIGNS: Record<number, string> = { 0x3e: 'aa', 0x3f: 'i', 0x40: 'ii', 0x41: 'u', 0x42: 'uu', 0x43: 'ri', 0x44: 'rri', 0x46: 'e', 0x47: 'e', 0x48: 'ai', 0x4a: 'o', 0x4b: 'o', 0x4c: 'au' };
const VIRAMA = 0x4d;
const NUKTA = 0x3c;
/** Scripts whose word-final inherent vowel is silent ("दिल" is dil, not dila). */
const FINAL_SCHWA_DROPS = new Set(['devanagari', 'bengali', 'gurmukhi', 'gujarati']);

function indicBlock(cp: number): { start: number; script: string } | null {
  for (const b of INDIC_BLOCKS) if (cp >= b.start && cp < b.start + 0x80) return b;
  return null;
}

/** The dominant Indic script of a text, or null for Latin / other text. Evidence only. */
export function scriptLanguage(text: string): string | null {
  const counts = new Map<string, number>();
  for (const ch of String(text ?? '')) {
    const b = indicBlock(ch.codePointAt(0) ?? 0);
    if (b) counts.set(b.script, (counts.get(b.script) ?? 0) + 1);
  }
  let best: string | null = null;
  let n = 1;
  for (const [script, c] of counts) if (c > n) { best = script; n = c; }
  return best;
}

function hasIndic(text: string): boolean {
  return scriptLanguage(text) !== null || [...text].some((ch) => indicBlock(ch.codePointAt(0) ?? 0) !== null);
}

/** Letter-by-letter romanisation of the nine Brahmic scripts (not a dictionary; spelling varies). */
export function transliterate(text: string): string {
  const chars = [...String(text ?? '').normalize('NFC')];
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    const cp = chars[i].codePointAt(0) ?? 0;
    const block = indicBlock(cp);
    if (!block) {
      out += chars[i];
      continue;
    }
    const off = cp - block.start;
    const cons = CONSONANTS[off];
    if (cons) {
      out += cons;
      let j = i + 1;
      const offAt = (k: number): number => {
        const c = chars[k]?.codePointAt(0) ?? -1;
        return c >= block.start && c < block.start + 0x80 ? c - block.start : -1;
      };
      if (offAt(j) === NUKTA) j++;
      const next = offAt(j);
      if (SIGNS[next]) {
        out += SIGNS[next];
        i = j;
      } else if (next === VIRAMA) {
        i = j;
      } else {
        // Inherent vowel — silent at the end of a word in the northern scripts.
        const endOfWord = next < 0 || !(CONSONANTS[next] || VOWELS[next]);
        if (!(endOfWord && FINAL_SCHWA_DROPS.has(block.script))) out += 'a';
        i = j - 1;
      }
      continue;
    }
    if (VOWELS[off]) out += VOWELS[off];
    else if (off === 0x01 || off === 0x02) out += 'n';
    else if (off === 0x03) out += 'h';
    else if (off >= 0x66 && off <= 0x6f) out += String(off - 0x66);
  }
  return out;
}

/** Latin spelling fold for romanised Indian titles: "Naatu" = "Natu", "Zindagi" = "Jindagi", "Chuttamalle" = "Chuttamale". */
export function latinKey(text: string): string {
  let s = normalizeIdentityText(hasIndic(text) ? transliterate(text) : text);
  s = s.replace(/[^\p{L}\p{N}]+/gu, '');
  s = s
    .replace(/aa+/g, 'a')
    .replace(/ee|ii/g, 'i')
    .replace(/oo|uu/g, 'u')
    .replace(/ph/g, 'f')
    .replace(/w/g, 'v')
    .replace(/q/g, 'k')
    .replace(/ck/g, 'k')
    .replace(/z/g, 'j')
    .replace(/([kgcjtdpbs])h/g, '$1')
    .replace(/iy(?=[aeiou])/g, 'i')
    .replace(/(.)\1+/g, '$1');
  return s;
}

/**
 * A lossier key for comparing ACROSS scripts: voicing and the vowel "a" are
 * dropped because letter-by-letter romanisation cannot know where a northern
 * script silences its inherent vowel. Equality on this key is only ever
 * `transliterated` evidence, which never auto-matches without corroboration.
 */
export function crossScriptKey(text: string): string {
  return latinKey(text)
    .replace(/g/g, 'k')
    .replace(/d/g, 't')
    .replace(/b/g, 'p')
    .replace(/j/g, 'c')
    .replace(/sh/g, 's')
    .replace(/e/g, 'i')
    .replace(/o/g, 'u')
    .replace(/a/g, '')
    .replace(/(.)\1+/g, '$1');
}

function bigrams(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}

/** Dice coefficient over character bigrams, 0..1. */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.length || !B.length) return 0;
  const pool = new Map<string, number>();
  for (const g of B) pool.set(g, (pool.get(g) ?? 0) + 1);
  let common = 0;
  for (const g of A) {
    const n = pool.get(g) ?? 0;
    if (n > 0) {
      common++;
      pool.set(g, n - 1);
    }
  }
  return (2 * common) / (A.length + B.length);
}

// ------------------------------------------------------------ title parsing --

const LANGUAGE_NAMES = ['hindi', 'telugu', 'tamil', 'kannada', 'malayalam', 'punjabi', 'bengali', 'marathi', 'gujarati', 'english', 'bhojpuri', 'haryanvi', 'urdu', 'odia', 'assamese', 'rajasthani'];
const LANGUAGE_RE = new RegExp(`^(${LANGUAGE_NAMES.join('|')})(?:\\s+(?:version|song|lyrics?))?$`, 'i');
/** Words that make a cut an alternate recording — the same list identityCore uses. */
const ALTERNATE_RE = /\b(remix|reprise|mix|unplugged|reloaded|revisited|slowed|sped\s?up|reverb|lofi|lo-fi|live|acoustic|cover|karaoke|instrumental|edit|extended|female|male|duet|8d|bass\s?boosted|flip|mashup)\b/i;
const NOT_A_SONG_RE = /\b(jukebox|trailer|teaser|glimpse|first\s+look|promo|making\s+of|behind\s+the\s+scenes|bts|interview|reaction|full\s+movie|movie\s+scene|dialogue|episode|podcast|live\s*stream|non[\s-]?stop|back\s+to\s+back|all\s+songs|top\s+\d+\s+songs|audio\s+launch|pre[\s-]?release\s+event|press\s+meet)\b/i;
const SHORT_FORM_RE = /(#\s*shorts?\b|\bshorts\b|\breels?\b|\boriginal\s+(?:audio|sound)\b|\bwhats\s?app\s+status\b|\bstatus\s+video\b|\btrending\s+audio\b)/i;
const NOISE: RegExp[] = [
  /\b(?:official\s+)?(?:full\s+)?(?:video|audio|lyric(?:al)?)\s+songs?\b/gi,
  /\bofficial\s+(?:music\s+|lyric(?:al)?\s+|full\s+)?(?:video|audio)\b/gi,
  /\bfull\s+(?:video|audio|song)\b/gi,
  /\blyric(?:al)?\s+video\b/gi,
  /\bmusic\s+video\b/gi,
  /\b(?:lyrical|lyrics?)\b/gi,
  /\b(?:4k|8k|hd|uhd|hq|1080p|720p|dolby\s+atmos)\b/gi,
  /\b(?:out\s+now|new\s+song|latest\s+song)\b/gi,
  /\b(?:official|video|audio)\b/gi,
];
const ENTITIES: Record<string, string> = { '&amp;': '&', '&quot;': '"', '&#039;': "'", '&#39;': "'", '&apos;': "'", '&lt;': '<', '&gt;': '>' };

export function decodeEntities(s: string): string {
  return String(s ?? '').replace(/&(?:amp|quot|#0?39|apos|lt|gt);/g, (m) => ENTITIES[m] ?? m);
}

export interface ParsedSourceTitle {
  /** Ordered title candidates, most likely first. */
  titles: string[];
  /** Every cleaned segment, in order (titles, film, credits…). */
  segments: string[];
  /** Film named as "(From X)" or "From X". */
  movie: string | null;
  /** Alternate-recording tag of the source ("remix", "lofi+slowed"), '' for the plain release. */
  versionTag: string;
  /** Language named in the title ("(Telugu)"). */
  languageHint: string | null;
  /** Short-form reuse: a short clip or "original audio" that may only borrow part of a song. */
  shortForm: boolean;
  /** A compilation, trailer, interview or other non-song upload. */
  notASong: boolean;
}

const QUOTES = /^["'“”‘’`]+|["'“”‘’`]+$/g;

function cleanSegment(seg: string): string {
  let s = seg;
  for (const re of NOISE) s = s.replace(re, ' ');
  return s.replace(/\s+/g, ' ').replace(/^[\s\-–—:|,.]+|[\s\-–—:|,.]+$/g, '').replace(QUOTES, '').trim();
}

export function parseSourceTitle(raw: string): ParsedSourceTitle {
  let text = decodeEntities(raw).normalize('NFKC');
  const shortForm = SHORT_FORM_RE.test(text);
  const notASong = NOT_A_SONG_RE.test(text);
  text = text.replace(/\p{Extended_Pictographic}/gu, ' ').replace(/#\s*shorts?\b/gi, ' ').replace(/#/g, ' ');

  let movie: string | null = null;
  let languageHint: string | null = null;
  const versionWords: string[] = [];
  const extra: string[] = [];

  // Bracketed groups: film credit, language, version, or plain extra info.
  text = text.replace(/[([{]([^)\]}]*)[)\]}]/g, (_m, inner: string) => {
    const t = inner.trim();
    const from = /^from\s+(.+)$/i.exec(t);
    if (from) movie = from[1].replace(QUOTES, '').trim();
    else if (LANGUAGE_RE.test(t)) languageHint = LANGUAGE_RE.exec(t)![1].toLowerCase();
    else if (ALTERNATE_RE.test(t)) versionWords.push(t);
    else {
      const cleaned = cleanSegment(t);
      if (cleaned) extra.push(cleaned);
    }
    return ' ';
  });

  const segments: string[] = [];
  for (const part of text.split(/\s*[|｜•]\s*|\s+[-–—]\s+|\s*:\s+|\s*\/\/\s*/)) {
    const fromTrail = /^(.*?)\s*\bfrom\s+["“]?(.+?)["”]?$/i.exec(part);
    let seg = part;
    if (fromTrail && fromTrail[1].trim()) {
      movie = movie ?? fromTrail[2].trim();
      seg = fromTrail[1];
    }
    const cleaned = cleanSegment(seg);
    if (!cleaned) continue;
    if (LANGUAGE_RE.test(cleaned)) {
      languageHint = languageHint ?? LANGUAGE_RE.exec(cleaned)![1].toLowerCase();
      continue;
    }
    // A short segment made of version words ("Lofi Version", "Slowed + Reverb", "DJ Remix") is a version, not a title.
    if (ALTERNATE_RE.test(cleaned) && cleaned.split(/\s+/).length <= 4 && segments.length > 0) {
      versionWords.push(cleaned);
      continue;
    }
    segments.push(cleaned);
  }
  segments.push(...extra);

  // Title candidates: a segment that calls itself a "... Song" first, then the first two segments.
  const titles: string[] = [];
  const add = (t: string | undefined): void => {
    const v = (t ?? '').trim();
    if (v && !titles.some((x) => x.toLowerCase() === v.toLowerCase())) titles.push(v);
  };
  const songMarked = segments.slice(0, 3).find((s) => /\bsong\b/i.test(s) && s.split(/\s+/).length > 1);
  if (songMarked) add(songMarked.replace(/\s*\bsong\b\s*$/i, '').replace(/\s*\bsong\b\s*/i, ' '));
  for (const s of segments.slice(0, 2)) {
    add(s);
    if (/\s\bsong$/i.test(s)) add(s.replace(/\s+song$/i, ''));
  }

  const probe = versionWords.length ? `x (${versionWords.join(' ')})` : 'x';
  return { titles: titles.slice(0, 3), segments, movie, versionTag: versionTag(probe), languageHint, shortForm, notASong };
}

// ---------------------------------------------------------------- scoring --

export interface CatalogCandidate {
  id: string;
  title: string;
  primaryArtists: string[];
  featuredArtists: string[];
  /** Everyone credited: singers, composer, lyricist, cast. */
  credits: string[];
  album: string | null;
  language: string | null;
  year: number | null;
  /** Seconds, when the catalogue knows it. Tells a compilation copy of a recording from a different song. */
  durationSec?: number | null;
}

/** The title with version decorations and featured credits removed, compact. */
function titleBase(title: string): string {
  return canonicalKey(title, '').split('|')[0];
}

export interface TitleEvidence {
  level: TitleLevel;
  crossScript: boolean;
}

/** Best title evidence between any source title candidate and a catalogue title. */
export function titleEvidence(sourceTitles: string[], catalogTitle: string): TitleEvidence {
  const order: TitleLevel[] = ['exact', 'phonetic', 'transliterated', 'partial', 'none'];
  let best: TitleEvidence = { level: 'none', crossScript: false };
  const cBase = titleBase(catalogTitle);
  const cIndic = hasIndic(cBase);
  for (const t of sourceTitles) {
    const sBase = titleBase(t);
    if (!sBase || !cBase) continue;
    const cross = hasIndic(sBase) !== cIndic;
    let level: TitleLevel = 'none';
    if (!cross && sBase === cBase) level = 'exact';
    else if (!cross && latinKey(sBase) === latinKey(cBase)) level = 'phonetic';
    else if (cross && crossScriptKey(sBase).length >= 2 && crossScriptKey(sBase) === crossScriptKey(cBase)) level = 'transliterated';
    else if ((cross ? similarity(crossScriptKey(sBase), crossScriptKey(cBase)) : similarity(latinKey(sBase), latinKey(cBase))) >= (cross ? 0.8 : 0.75)) level = 'partial';
    if (order.indexOf(level) < order.indexOf(best.level)) best = { level, crossScript: cross };
  }
  return best;
}

function nameKey(name: string): string {
  return latinKey(name);
}

/** Does any name the source credits agree with any name the catalogue credits? */
export function creditsAgree(sourceNames: string[], catalogNames: string[]): boolean {
  const src = sourceNames.map(nameKey).filter((k) => k.length >= 3);
  const cat = catalogNames.map(nameKey).filter((k) => k.length >= 3);
  for (const a of src) {
    for (const b of cat) {
      if (a === b) return true;
      if (a.length >= 5 && b.length >= 5 && (a.includes(b) || b.includes(a))) return true;
    }
  }
  return false;
}

const ALBUM_NOISE = /\b(original\s+motion\s+picture\s+soundtrack|original\s+soundtrack|ost|soundtrack|telugu|hindi|tamil|kannada|malayalam|punjabi|bengali|marathi)\b/gi;

function albumKey(album: string): string {
  return decodeEntities(album).replace(/[([{][^)\]}]*[)\]}]/g, ' ').replace(ALBUM_NOISE, ' ');
}

/** Does the film named by the source agree with the candidate's album? A single's album named after the song does not count. */
export function movieAgrees(parsed: ParsedSourceTitle, cand: CatalogCandidate): boolean {
  if (!cand.album) return false;
  const album = albumKey(cand.album);
  const aCompact = titleBase(album);
  const aKey = latinKey(album);
  if (!aCompact || aCompact === titleBase(cand.title)) return false;
  const pool = [parsed.movie, ...parsed.segments].filter((s): s is string => !!s);
  for (const s of pool) {
    const sCompact = titleBase(s);
    if (sCompact && sCompact === aCompact) return true;
    const sKey = latinKey(s);
    if (sKey.length >= 3 && sKey === aKey) return true;
    if (sKey.length >= 5 && aKey.length >= 5 && (sKey.includes(aKey) || aKey.includes(sKey))) return true;
  }
  return false;
}

/** Names credited by the source: every segment except the leading title, split on the usual joiners, plus the uploader. */
export function sourceCredits(parsed: ParsedSourceTitle, credit: string | null, artistHint?: string | null): string[] {
  const lead = parsed.titles[0]?.toLowerCase();
  const segs = parsed.segments.filter((s) => s.toLowerCase() !== lead);
  const names = [...segs, credit ?? '', artistHint ?? '']
    .flatMap((s) => s.split(/\s*(?:,|&|\/|\band\b|\bx\b|\bft\b\.?|\bfeat\b\.?|\bfeaturing\b)\s*/i))
    .map((s) => s.replace(/\b(?:vevo|official|music|records|channel|topic)\b/gi, ' ').trim())
    .filter((s) => s.length >= 2);
  return [...new Set(names)];
}

export interface CandidateScore {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  language: string | null;
  confidence: number;
  method: string;
  reason: string | null;
  /** Work family (canonicalKey) — two candidates of the same family are not a real ambiguity… */
  family: string;
  /** …unless their durations show they are different recordings. */
  durationSec: number | null;
}

export function scoreCandidate(parsed: ParsedSourceTitle, credits: string[], cand: CatalogCandidate): CandidateScore {
  const ev = titleEvidence(parsed.titles, cand.title);
  const artist = creditsAgree(credits, [...cand.primaryArtists, ...cand.featuredArtists, ...cand.credits]);
  const movie = movieAgrees(parsed, cand);
  const agree = artist && movie ? 'both' : artist || movie ? 'one' : 'none';
  let confidence = ev.level === 'none' ? 0 : CONFIDENCE[ev.level][agree];
  let reason: string | null = null;
  if (ev.level === 'transliterated' && agree === 'none') reason = 'transliteration';
  else if ((ev.level === 'exact' || ev.level === 'phonetic') && agree === 'none') reason = 'uncorroborated';
  else if (ev.level === 'partial') reason = 'weak_title';
  if (ev.level === 'none') reason = 'no_title_match';
  if (parsed.versionTag !== versionTag(cand.title)) {
    confidence = Math.min(confidence, CAP.versionMismatch);
    reason = 'version_mismatch';
  } else if (parsed.languageHint && cand.language && parsed.languageHint !== cand.language.toLowerCase()) {
    confidence = Math.min(confidence, CAP.languageMismatch);
    reason = 'language_mismatch';
  }
  if (parsed.shortForm) {
    confidence = Math.min(confidence, CAP.shortForm);
    reason = 'short_form_reuse';
  }
  const method = `title:${ev.level}${artist ? '+artist' : ''}${movie ? '+film' : ''}`;
  const lead = cand.primaryArtists[0] ?? '';
  return {
    id: cand.id,
    title: cand.title,
    artist: cand.primaryArtists.join(', '),
    album: cand.album,
    language: cand.language,
    confidence: Math.round(confidence * 100) / 100,
    method,
    reason,
    family: canonicalKey(cand.title, lead),
    durationSec: typeof cand.durationSec === 'number' && cand.durationSec > 0 ? cand.durationSec : null,
  };
}

/**
 * Could these two candidates be different songs? Different work families, or
 * one family whose known durations differ by more than 5 s (the same title by
 * the same singer in two films). A compilation copy of one recording has the
 * same duration and is not a rival.
 */
export function differentSongs(a: CandidateScore, b: CandidateScore): boolean {
  if (a.family !== b.family) return true;
  return a.durationSec !== null && b.durationSec !== null && Math.abs(a.durationSec - b.durationSec) > 5;
}

export interface MatchDecision {
  status: 'matched' | 'review';
  catalogId: string | null;
  catalogTitle: string | null;
  catalogArtist: string | null;
  catalogLanguage: string | null;
  confidence: number;
  method: string;
  reason: string | null;
  /** Top candidates for the reviewer, best first. */
  candidates: CandidateScore[];
  /** Catalogue calls this decision spent. */
  searches: number;
}

/** Pick from scored candidates: confident, unambiguous → matched; anything else → review. */
export function decide(scored: CandidateScore[], searches: number, fallbackReason: string): MatchDecision {
  const sorted = [...scored].sort((a, b) => b.confidence - a.confidence);
  const best = sorted[0];
  if (!best || best.confidence <= 0) {
    return { status: 'review', catalogId: null, catalogTitle: null, catalogArtist: null, catalogLanguage: null, confidence: 0, method: 'none', reason: fallbackReason, candidates: sorted.slice(0, 3), searches };
  }
  const rival = sorted.find((c) => c !== best && differentSongs(c, best) && c.confidence >= best.confidence - AMBIGUITY_MARGIN);
  const confident = best.confidence >= AUTO_MATCH_THRESHOLD;
  const status: MatchDecision['status'] = confident && !rival ? 'matched' : 'review';
  const reason = status === 'matched' ? null : rival ? 'ambiguous' : best.reason ?? 'low_confidence';
  return {
    status,
    catalogId: best.id,
    catalogTitle: best.title,
    catalogArtist: best.artist,
    catalogLanguage: best.language,
    confidence: best.confidence,
    method: best.method,
    reason,
    candidates: sorted.slice(0, 3),
    searches,
  };
}

export type CatalogSearch = (query: string, limit: number) => Promise<CatalogCandidate[]>;
export type CatalogLookup = (id: string) => Promise<CatalogCandidate | null>;

export interface MatchDeps {
  search: CatalogSearch;
  lookup?: CatalogLookup;
  /** Catalogue calls left for this run; shared by every item. */
  budget: { remaining: number };
}

/**
 * Decide what catalogue recording (if any) a raw item is. Returns null when
 * nothing could be decided NOW — the budget ran out or the catalogue failed —
 * so the item is retried on a later run instead of being filed as unmatched.
 */
export async function matchRawItem(item: RawTrendItem, deps: MatchDeps): Promise<MatchDecision | null> {
  const parsed = parseSourceTitle(item.title);
  const credits = sourceCredits(parsed, item.credit, item.artistHint);

  if (item.catalogIdHint) {
    if (!deps.lookup || deps.budget.remaining <= 0) return null;
    deps.budget.remaining -= 1;
    let song: CatalogCandidate | null;
    try {
      song = await deps.lookup(item.catalogIdHint);
    } catch {
      return null;
    }
    if (!song) return decide([], 1, 'catalog_id_not_found');
    const scored = scoreCandidate(parsed, credits, song);
    const titleOk = titleEvidence(parsed.titles, song.title).level !== 'none';
    const versionOk = parsed.versionTag === versionTag(song.title);
    if (!titleOk || !versionOk) {
      return { ...decide([{ ...scored, confidence: Math.min(scored.confidence, 0.3) }], 1, 'catalog_id_title_mismatch'), status: 'review', reason: versionOk ? 'catalog_id_title_mismatch' : 'version_mismatch' };
    }
    return { ...decide([{ ...scored, confidence: 1, method: 'editorial-catalog-id', reason: null }], 1, ''), status: 'matched', reason: null };
  }

  if (parsed.notASong) return decide([], 0, 'not_a_song');
  if (!parsed.titles.length) return decide([], 0, 'no_title');

  const lead = parsed.titles[0];
  const context = parsed.movie ?? parsed.segments.find((s) => s !== lead) ?? '';
  const queries = [`${lead} ${context}`.trim()];
  if (hasIndic(lead)) queries.push(transliterate(lead));
  else if (context) queries.push(lead);
  if (parsed.titles[1]) queries.push(parsed.titles[1]);

  // Short-form reuse is always the reason a reviewer sees, whatever else the candidates show.
  const fallback = parsed.shortForm ? 'short_form_reuse' : 'no_candidate';
  const finish = (d: MatchDecision): MatchDecision => (parsed.shortForm && d.status === 'review' ? { ...d, reason: 'short_form_reuse' } : d);
  const seen = new Map<string, CandidateScore>();
  let searches = 0;
  for (const q of [...new Set(queries)].slice(0, 2)) {
    if (deps.budget.remaining <= 0) break;
    deps.budget.remaining -= 1;
    searches++;
    let found: CatalogCandidate[];
    try {
      found = await deps.search(q.slice(0, 120), 10);
    } catch {
      return null; // the catalogue is down: decide later, never file as "no candidate"
    }
    for (const c of found) if (!seen.has(c.id)) seen.set(c.id, scoreCandidate(parsed, credits, c));
    const interim = decide([...seen.values()], searches, fallback);
    if (interim.status === 'matched') return interim;
  }
  if (searches === 0) return null;
  return finish(decide([...seen.values()], searches, fallback));
}
