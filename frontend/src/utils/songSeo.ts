/**
 * SEO 2026-11 — a song page's title and description, the same words the
 * prerendered page uses (songTitle/songDesc in
 * backend/worker/functions/_lib/render.ts; keep the two in sync), so the
 * browser tab, share cards and what search engines index all agree:
 * "Suttamla Soosi - Gangs Of Godavari | Telugu Song | VinaX".
 */
const cap = (w: string): string => w.charAt(0).toUpperCase() + w.slice(1);

/** The film in a catalogue name: 'Mahi (From "Deewana")' → 'Deewana'. */
function filmOf(text: string | undefined | null): string | undefined {
  const m = /\(From\s+["“]([^"”]+)["”]\)/i.exec(String(text ?? ''));
  return m ? m[1].trim() : undefined;
}

const withoutFrom = (album: string): string => album.replace(/\(From\s+["“][^)]*\)/i, '').trim();

/** "A, B, C" → "A, B and C". */
function andList(names: string): string {
  const parts = names.split(',').map((x) => x.trim()).filter(Boolean);
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : (parts[0] ?? '');
}

export function songTitle(name: string, album?: string | null, artist?: string | null, lang?: string | null): string {
  const lower = name.toLowerCase();
  const albumFilm = filmOf(album) ?? (album ? withoutFrom(album) : undefined);
  let context: string | undefined;
  if (!filmOf(name)) {
    if (albumFilm && albumFilm.toLowerCase() !== lower && !lower.includes(albumFilm.toLowerCase())) context = albumFilm;
    else if (artist) context = artist.split(',')[0].trim();
  }
  const base = `${name}${context ? ` - ${context}` : ''}`;
  const withLang = `${base}${lang ? ` | ${cap(lang)} Song` : ''} | VinaX`;
  return withLang.length <= 70 ? withLang : `${base} | VinaX`;
}

export function songDesc(name: string, album?: string | null, artist?: string | null, lang?: string | null): string {
  const film = filmOf(name) ?? filmOf(album) ?? (album ? withoutFrom(album) : undefined);
  const from = film && film.toLowerCase() !== name.toLowerCase() ? ` from ${film}` : '';
  const kind = lang ? `a ${cap(lang)} song` : 'a song';
  const by = artist ? `, sung by ${andList(artist)}` : '';
  return clampDesc(`Listen to ${name} online. ${name} is ${kind}${from}${by}. Stream it free on VinaX, with lyrics and no subscription.`);
}

/*
 * SEO 2026-11 — album and artist pages, the same words as albumTitle /
 * albumDesc / artistTitle / artistDesc in backend/worker/functions/_lib/render.ts
 * (keep in sync). The prerendered page knows when an album is a movie
 * soundtrack (its songs credit the cast); here only the name can say so.
 */
const SOUNDTRACK = /\s*[([]?\s*(?:original\s+)?(?:motion\s+picture\s+)?soundtrack\s*[)\]]?\s*$|\s*[([]\s*ost\s*[)\]]\s*$/i;
const SONGS_WORD = /\b(?:songs|hits|collection|jukebox|mix|vol\.?\s*\d+)\b/i;
const shortName = (t: string): string => t.replace(/\s*[([][^)\]]*[)\]]/g, '').trim() || t;

export function albumTitle(name: string, year?: string | null, lang?: string | null, film = false): string {
  const L = lang ? cap(lang) : '';
  const clean = name.replace(SOUNDTRACK, '').trim() || name;
  if (filmOf(name)) return `${clean}${L ? ` | ${L} Song` : ''} | VinaX`;
  const isFilm = film || SOUNDTRACK.test(name);
  const head = SONGS_WORD.test(clean) ? clean : `${clean} Songs`;
  const kind = isFilm ? `${L ? `${L} ` : ''}Movie Songs` : `${L ? `${L} ` : ''}Album`;
  for (const t of [`${head} - ${kind}${year ? ` ${year}` : ''} | VinaX`, `${head} - ${kind} | VinaX`]) if (t.length <= 70) return t;
  return `${head} | VinaX`;
}

export function albumDesc(name: string, year: string | null | undefined, lang: string | null | undefined, songs: string[]): string {
  const clean = name.replace(SOUNDTRACK, '').trim() || name;
  const L = lang ? cap(lang) : '';
  const single = filmOf(name);
  if (songs.length <= 1 || single) {
    const song = shortName(clean);
    return clampDesc(`Listen to ${song} online. ${song} is ${L ? `a ${L} song` : 'a song'}${single ? ` from ${single}` : ''}. Stream free on VinaX.`);
  }
  const isFilm = SOUNDTRACK.test(name);
  const from = isFilm ? `, from the ${[year, L].filter(Boolean).join(' ')} movie`.replace('the  movie', 'the movie') : L ? `, a ${L} album` : '';
  const top = songs.slice(0, 3).map(shortName);
  const list = songs.length > 3 ? `${top.join(', ')} and more` : `${top.slice(0, -1).join(', ')} and ${top[top.length - 1]}`;
  return clampDesc(`Listen to all ${songs.length} ${clean} songs online${from}: ${list}. Stream free on VinaX.`);
}

export function artistTitle(name: string, lang?: string | null): string {
  const t = `${name} Songs - Top ${lang ? `${cap(lang)} ` : ''}Hits | VinaX`;
  return t.length <= 70 ? t : `${name} Songs | VinaX`;
}

export function artistDesc(name: string, songs: string[]): string {
  const list = songs.length ? `: ${songs.slice(0, 3).map(shortName).join(', ')} and more` : '';
  return clampDesc(`Listen to ${name} songs online${list}. Stream free on VinaX.`);
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
