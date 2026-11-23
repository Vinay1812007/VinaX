/**
 * SEO 2026-11 — a song page's title and description, the same words the
 * prerendered page uses (songTitle/songDesc in
 * backend/worker/functions/_lib/render.ts; keep the two in sync), so the
 * browser tab, share cards and what search engines index all agree.
 * 2026-11-23: worded the way JioSaavn's pages rank —
 * "Raavana - Song by Divya Kumar | Jai Lava Kusa | VinaX" and
 * "Raavana is a Telugu language song and is sung by Divya Kumar. …".
 */
const cap = (w: string): string => w.charAt(0).toUpperCase() + w.slice(1);

/** The film in a catalogue name: 'Mahi (From "Deewana")' → 'Deewana'. */
function filmOf(text: string | undefined | null): string | undefined {
  const m = /\(From\s+["“]([^"”]+)["”]\)/i.exec(String(text ?? ''));
  return m ? m[1].trim() : undefined;
}

const FROM = /\s*\(From\s+["“][^)]*\)/i;

/** "A, B, C" → "A, B and C". */
function andList(names: string): string {
  const parts = names.split(',').map((x) => x.trim()).filter(Boolean);
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : (parts[0] ?? '');
}

/** "a Telugu song", "an English song". */
const aAn = (words: string): string => `${/^[aeiou]/i.test(words) ? 'an' : 'a'} ${words}`;

/** "4:18". */
const clock = (secs: number): string => `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}`;

/*
 * Album and artist pages, the same words as albumTitle / albumDesc /
 * artistTitle / artistDesc in backend/worker/functions/_lib/render.ts (keep in
 * sync). The prerendered page knows when an album is a movie soundtrack (its
 * songs credit the cast) and who made the music; here only the name can say so.
 */
const SOUNDTRACK = /\s*[([]?\s*(?:original\s+)?(?:motion\s+picture\s+)?soundtrack\s*[)\]]?\s*$|\s*[([]\s*ost\s*[)\]]\s*$/i;
const SONGS_WORD = /\b(?:songs|hits|collection|jukebox|mix|vol\.?\s*\d+)\b/i;
const shortName = (t: string): string => t.replace(/\s*[([][^)\]]*[)\]]/g, '').trim() || t;

/** The film or album a song is from, for its title: never the song itself. */
function songContext(name: string, album?: string | null): string | undefined {
  if (filmOf(name)) return undefined;
  const lower = name.toLowerCase();
  const ctx = filmOf(album) ?? (album ? album.replace(FROM, '').replace(SOUNDTRACK, '').trim() : undefined);
  // "÷ (Deluxe)" leaves "÷": a name with no word in it says nothing.
  return ctx && /[\p{L}\p{N}]{2}/u.test(ctx) && ctx.toLowerCase() !== lower && !lower.includes(ctx.toLowerCase()) ? ctx : undefined;
}

/** "<name> | VinaX" within 70 characters: a name too long is cut at a word. */
function cutTitle(name: string): string {
  if (`${name} | VinaX`.length <= 70) return `${name} | VinaX`;
  const cut = name.slice(0, 59);
  const at = cut.lastIndexOf(' ');
  return `${cut.slice(0, at > 30 ? at : 59).replace(/[\s,.\-–—|:(]+$/, '')}… | VinaX`;
}

export function songTitle(name: string, album?: string | null, artist?: string | null, lang?: string | null): string {
  const people = String(artist ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const bys = [...new Set([andList(people.slice(0, 2).join(', ')), people[0] ?? '', ''])];
  // A film is worth more than a second singer; the singer is worth more than "Telugu Song".
  // A name too long for any of them tries again without its brackets, and
  // then names the film its "(From …)" said.
  for (const n of [...new Set([name, shortName(name)])]) {
    const film = n === name ? songContext(name, album) : (filmOf(name) ?? songContext(name, album));
    const tails = [...new Set([film ?? (lang ? `${cap(lang)} Song` : ''), ''])];
    const make = (by: string, tail: string) => `${n}${by ? ` - Song by ${by}` : ''}${tail ? ` | ${tail}` : ''} | VinaX`;
    const order = film ? tails.flatMap((tail) => bys.map((by) => make(by, tail))) : bys.flatMap((by) => tails.map((tail) => make(by, tail)));
    const fit = order.find((t) => t.length <= 70);
    if (fit) return fit;
  }
  return cutTitle(shortName(name));
}

/** Sentences up to 160 characters: the first `must` always, then each later one (or its short form) that fits. */
export function fitDesc(sentences: Array<string | string[] | false | undefined | null>, must = 2): string {
  const list = sentences.filter((s): s is string | string[] => !!s && s.length > 0);
  const first = (s: string | string[]) => (Array.isArray(s) ? s[0] : s);
  let out = clampDesc(list.slice(0, must).map(first).join(' '));
  for (const s of list.slice(must)) {
    const fit = (Array.isArray(s) ? s : [s]).find((x) => x && `${out} ${x}`.length <= 160);
    if (fit) out = `${out} ${fit}`;
  }
  return out;
}

export function songDesc(
  name: string,
  album?: string | null,
  artist?: string | null,
  lang?: string | null,
  year?: string | number | null,
  duration?: number | null,
): string {
  const L = lang ? cap(lang) : '';
  const people = artist ? andList(artist) : '';
  const al = album ? album.replace(SOUNDTRACK, '').trim() || album : undefined;
  const own = !al || al.toLowerCase() === name.toLowerCase();
  return fitDesc([
    `Listen to ${name} online.`,
    `${name} is ${aAn(`${L ? `${L} language ` : ''}song`)}${people ? ` and is sung by ${people}` : ''}.`,
    !own ? (year ? `${name}, from the album ${al}, was released in the year ${year}.` : `${name} is from the album ${al}.`) : year ? `It was released in the year ${year}.` : '',
    duration ? `The duration of the song is ${clock(duration)}.` : '',
    `Stream ${L ? `${L} ` : ''}songs free on VinaX.`,
  ]);
}

export function albumTitle(name: string, year?: string | null, lang?: string | null, film = false): string {
  const L = lang ? cap(lang) : '';
  const clean = name.replace(SOUNDTRACK, '').trim() || name;
  if (filmOf(name)) return `${clean}${L ? ` | ${L} Song` : ''} | VinaX`;
  const isFilm = film || SOUNDTRACK.test(name);
  const head = SONGS_WORD.test(clean) ? clean : `${clean} Songs`;
  const kind = isFilm ? `${L ? `${L} ` : ''}Movie Songs` : `${L ? `${L} ` : ''}Album`;
  for (const t of [`${head} - ${kind}${year ? ` ${year}` : ''} | VinaX`, `${head} - ${kind} | VinaX`]) if (t.length <= 70) return t;
  return cutTitle(head);
}

export function albumDesc(name: string, year: string | null | undefined, lang: string | null | undefined, songs: string[]): string {
  const clean = name.replace(SOUNDTRACK, '').trim() || name;
  const L = lang ? cap(lang) : '';
  const single = filmOf(name);
  if (songs.length <= 1 || single) {
    const song = shortName(clean);
    return fitDesc([`Listen to ${song} online.`, `${song} is ${aAn(`${L ? `${L} language ` : ''}song`)}${single ? ` from ${single}` : ''}.`, 'Stream free on VinaX.']);
  }
  const kind = SOUNDTRACK.test(name) ? 'movie soundtrack' : 'album';
  const top = songs.slice(0, 3).map(shortName);
  const list = songs.length > 3 ? `${top.join(', ')} and more` : `${top.slice(0, -1).join(', ')} and ${top[top.length - 1]}`;
  return fitDesc([
    `Listen to ${clean} songs online.`,
    `${clean} is ${aAn(`${L ? `${L} ` : ''}${kind}`)}${year ? ` released in ${year}` : ''}.`,
    [`There are a total of ${songs.length} songs in ${clean}: ${list}.`, `There are a total of ${songs.length} songs in ${clean}.`],
    'Stream free on VinaX.',
  ]);
}

export function artistTitle(name: string, lang?: string | null): string {
  const t = `${name} Songs - Top ${lang ? `${cap(lang)} ` : ''}Hits | VinaX`;
  return t.length <= 70 ? t : `${name} Songs | VinaX`;
}

export function artistDesc(name: string, songs: string[]): string {
  const list = songs.length ? `: ${songs.slice(0, 3).map(shortName).join(', ')} and more` : '';
  return fitDesc([`Listen to ${name} songs online${list}.`, 'Stream free on VinaX.']);
}

/** The language most of these songs are in (an artist page's main language). */
export function mainLanguage(songs: Array<{ language: string | null }>): string | undefined {
  const n = new Map<string, number>();
  for (const s of songs) if (s.language && s.language !== 'unknown') n.set(s.language, (n.get(s.language) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

function clampDesc(s: string): string {
  if (s.length <= 160) return s;
  const cut = s.slice(0, 157);
  const at = cut.lastIndexOf(' ');
  return `${cut.slice(0, at > 120 ? at : 157)}…`;
}
