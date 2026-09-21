/**
 * Song identity — the one normalisation contract shared by the app and the
 * Worker. This file has NO imports and is kept byte-identical in
 * `frontend/src/services/recommendation/identityCore.ts` and
 * `backend/worker/functions/_lib/identityCore.ts`; a backend test fails when
 * the two copies drift, and both test suites run the vectors in
 * `shared/identity-vectors.json`.
 *
 * Two levels of identity:
 *   - canonicalKey — the WORK family: "Monica", "Monica (From "Coolie")",
 *     "Monica (2025 Remix)" and "Monica - Lofi Flip" by the same lead artist
 *     are one key, so one of them reaches a queue or shelf.
 *   - recordingKey — the RECORDING: the family plus the version tag, so a
 *     remix, a live cut or a cover stays distinguishable when a listener asks
 *     for that version on purpose.
 *
 * Unicode rules: NFKC folds width and compatibility forms; invisible
 * characters (zero-width space / joiners, word joiner, BOM, soft hyphen) are
 * dropped; combining marks in the Combining Diacritical Marks block (Latin
 * accents: "Café" = "Cafe") are folded; every other combining mark is KEPT,
 * so Indic vowel signs survive ("కల" and "కాల" are different songs).
 */

/** Words that mark a bracketed or dashed suffix as a VERSION of a song rather than part of its name. */
const VERSION_WORDS =
  'from|remix|remaster(?:ed)?|reprise|version|mix|unplugged|reloaded|revisited|slowed|sped\\s?up|reverb|lofi|lo-fi|live|acoustic|cover|karaoke|instrumental|edit|extended|female|male|duet|8d|bass\\s?boosted|deluxe|bonus|ost|flip|mashup|19\\d{2}|20\\d{2}';

/** Version decorations in brackets: "(From "Coolie")", "[Live]", "(2019 Remaster)". */
const VERSION_TAG = new RegExp(`\\s*[([{][^)\\]}]*\\b(?:${VERSION_WORDS})\\b[^)\\]}]*[)\\]}]`, 'gi');
/** The same decorations written without brackets: "Song - Lofi Flip", "Song – 2019 Remaster". */
const VERSION_DASH = new RegExp(`\\s+[-–—]\\s+[^-–—]*\\b(?:${VERSION_WORDS})\\b[^-–—]*$`, 'i');
/** Words that make a cut a different RECORDING (not a remaster, film credit, year or bonus tag). */
const ALTERNATE_WORDS = /\b(remix|reprise|mix|unplugged|reloaded|revisited|slowed|sped\s?up|reverb|lofi|lo-fi|live|acoustic|cover|karaoke|instrumental|edit|extended|female|male|duet|8d|bass\s?boosted|flip|mashup)\b/g;
const REMASTER_WORD = /\bremaster(?:ed)?\b/;
/** Zero-width space, non-joiner, joiner, word joiner, BOM, soft hyphen, combining grapheme joiner. */
const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF\u00AD]|\u034F/g;
/** Latin (and Greek / Cyrillic) accents after NFD. Indic signs live in their own blocks and are untouched. */
const LATIN_MARKS = /[\u0300-\u036f]/g;
/** Bracketed or trailing featured-artist credits. The trailing form needs a space BEFORE "ft" ("Left Right" keeps its name). */
const FEAT_BRACKET = /\s*[([]\s*(?:feat|ft|featuring)\b[^)\]]*[)\]]/gi;
const FEAT_TRAIL = /\s+(?:feat\.?|ft\.?|featuring)\s+.+$/i;
const FROM_TRAIL = /\s*[-–—]\s*from\s+.+$/i;
/** Separators between credited artists; only the first (primary) artist is part of the identity. */
const ARTIST_SPLIT = /\s*(?:[,&;/]|\s(?:feat|ft)\.?\s|\sfeaturing\s)\s*/i;

const squash = (text: string): string => text.replace(/[^\p{L}\p{N}\p{M}]+/gu, '');

/** Unicode-safe fold used by every identity function. */
export function normalizeIdentityText(text: string): string {
  return String(text ?? '')
    .normalize('NFKC')
    .replace(INVISIBLE, '')
    .normalize('NFD')
    .replace(LATIN_MARKS, '')
    .normalize('NFC')
    .toLowerCase();
}

/** The primary credited artist of a credit line ("A, B", "A & B", "A feat. B" → "a"). */
export function primaryArtistName(artist: string): string {
  return normalizeIdentityText(artist).split(ARTIST_SPLIT)[0]?.trim() ?? '';
}

/** Canonical WORK identity: normalised title (version decorations and featured credits stripped) + primary artist. */
export function canonicalKey(title: string, artist: string): string {
  const base = normalizeIdentityText(title);
  const stripped = base
    .replace(VERSION_TAG, '')
    .replace(VERSION_DASH, '')
    .replace(FROM_TRAIL, '')
    .replace(FEAT_BRACKET, '')
    .replace(FEAT_TRAIL, '');
  // A title that is nothing BUT a version word ("Remix", "Live") keeps its own name.
  const t = squash(stripped) || squash(base);
  return `${t}|${squash(primaryArtistName(artist))}`;
}

function versionDecorations(title: string): string {
  const base = normalizeIdentityText(title);
  return [...(base.match(VERSION_TAG) ?? []), ...(base.match(VERSION_DASH) ?? [])].join(' ');
}

/**
 * The alternate-recording tag of a title, normalised and sorted ("lofi+slowed"),
 * or '' for the plain release. A remaster, a film credit, a year or a
 * deluxe/bonus tag is the same recording and yields ''.
 */
export function versionTag(title: string): string {
  const tags = versionDecorations(title);
  if (!tags) return '';
  const words = new Set<string>();
  for (const m of tags.matchAll(ALTERNATE_WORDS)) words.add(m[1].replace(/\s+/g, '').replace('lo-fi', 'lofi'));
  return [...words].sort().join('+');
}

export type VersionKind = 'original' | 'remaster' | 'alternate';

/** What kind of cut a title is: the plain release, a remaster of it, or an alternate (remix, live, slowed, cover…). */
export function versionKind(title: string): VersionKind {
  const tags = versionDecorations(title);
  if (!tags) return 'original';
  if (versionTag(title)) return 'alternate';
  if (REMASTER_WORD.test(tags)) return 'remaster';
  return 'original';
}

/** RECORDING identity: the work family plus the alternate-version tag ("…#original" for the plain release and its remasters). */
export function recordingKey(title: string, artist: string): string {
  return `${canonicalKey(title, artist)}#${versionTag(title) || 'original'}`;
}
