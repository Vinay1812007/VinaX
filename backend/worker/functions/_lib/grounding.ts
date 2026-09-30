/**
 * 8.5.0 — keep the DJ's spoken lines to what the app actually knows.
 *
 * The DJ writes an intro, a reason per pick and (with the voice on) a segue.
 * The model knows a lot about music — and some of it is wrong, or about a
 * different song with the same name. A spoken line that states a fact VinaX
 * did not hand it ("the chart-topper that won a national award in 2016") can
 * be false, and it is said in VinaX's voice. So a line is dropped (returned
 * as '') when it:
 *
 *  - makes a CLAIM of the kind that needs a source: awards, nominations,
 *    charts, sales / stream / view counts, box office, births and deaths,
 *    debuts, "record-breaking";
 *  - holds a NUMBER that is not in the facts (a year the pool carries, or a
 *    number inside a title such as "96" or "2.0" is fine);
 *  - NAMES someone or something that is not in the facts: a capitalised word
 *    mid-sentence must come from a pool title, artist, album, a language, or
 *    a short list of ordinary words.
 *
 * What survives is how the music feels and flows — tempo, mood, voice,
 * language — plus the names on the pool. Dropping a line is always safe: the
 * app plays the set without a segue, and the intro is optional.
 */

const CLAIMS =
  /\b(awards?|award-winning|won|wins|winning|winner|nominat\w*|grammys?|filmfare|oscars?|charts?|chart-?topp\w*|topped|number one|no\.\s?1|million|billion|crore|lakh|streams|streamed|views|record-?breaking|all-?time|born|died|passed away|debut\w*|blockbuster|box office|super-?hit|biggest hit|best-?selling|platinum|biopic)\b|#\s?1\b/i;

/** Capitalised words that name nothing: sentence glue a DJ says. */
const ORDINARY = new Set(
  'i im ill ive id lets let here heres now next up coming this that these those its it we were you youre your our and but so then just one more time tonight today morning evening night weekend vinax dj ok okay yes hey hello welcome enjoy stay keep turn feel take get ready sit back relax dance sing listen a an the of in on with for to from by or'.split(' '),
);

const LANGUAGES = ['telugu', 'hindi', 'tamil', 'kannada', 'malayalam', 'punjabi', 'marathi', 'bengali', 'gujarati', 'english', 'bhojpuri', 'haryanvi', 'urdu', 'odia', 'assamese', 'rajasthani', 'indian', 'tollywood', 'bollywood', 'kollywood', 'mollywood', 'sandalwood'];

export interface Facts {
  /** Lower-cased words of every known name (titles, artists, albums, languages). */
  words: Set<string>;
  /** Every number the facts contain ("2016", "96", "2"). */
  numbers: Set<string>;
}

const wordsOf = (s: string): string[] =>
  s
    .toLowerCase()
    .normalize('NFKC')
    .replace(/['’]s\b/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

export function buildFacts(texts: Array<string | null | undefined>): Facts {
  const words = new Set<string>(LANGUAGES);
  const numbers = new Set<string>();
  for (const t of texts) {
    if (!t) continue;
    for (const w of wordsOf(t)) {
      words.add(w);
      if (/^\d+$/.test(w)) numbers.add(w);
    }
  }
  return { words, numbers };
}

/** The line, or '' when it says something the facts do not back. Pure. */
export function groundedLine(text: string, facts: Facts): string {
  const line = text.trim();
  if (!line) return '';
  if (CLAIMS.test(line)) return '';
  for (const n of line.match(/\d+/g) ?? []) if (!facts.numbers.has(n)) return '';
  // Capitalised words that do not open a sentence must be known names.
  const tokens = line.split(/\s+/);
  let sentenceStart = true;
  for (const raw of tokens) {
    const token = raw.replace(/^[("“‘'«]+/, '');
    const bare = token.replace(/['’]s$/, '').replace(/[^\p{L}\p{N}-]+/gu, '');
    if (bare && /^\p{Lu}/u.test(bare) && !sentenceStart) {
      const parts = wordsOf(bare);
      const known = parts.every((p) => facts.words.has(p) || ORDINARY.has(p.replace(/[^a-z]/g, '')));
      if (!known) return '';
    }
    if (bare) sentenceStart = /[.!?…:]["”’)]*$/.test(token);
  }
  return line;
}
