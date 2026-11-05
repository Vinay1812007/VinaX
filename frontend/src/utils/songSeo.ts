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
  const s = `Listen to ${name} online. ${name} is ${kind}${from}${by}. Stream it free on VinaX, with lyrics and no subscription.`;
  if (s.length <= 160) return s;
  const cut = s.slice(0, 157);
  const at = cut.lastIndexOf(' ');
  return `${cut.slice(0, at > 120 ? at : 157)}…`;
}
