import type { Song } from '@/types';

/**
 * v7.1.0 — the one-line form of an upcoming song: Song – Movie/Album – Artist.
 * The catalogue often repeats the film inside the title ("Sasirekha (From
 * "Mana Shankara…")"); when the album is shown anyway, that tag is dropped
 * so the line does not say the same thing twice.
 */
export interface SongLine {
  title: string;
  album: string | null;
  artist: string;
}

const FROM_TAG = /\s*[([]\s*from\s+["“”']?([^"“”')\]]+)["“”']?\s*[)\]]\s*$/i;
const ALBUM_NOISE = /\s*[([][^)\]]*(original motion picture soundtrack|ost|soundtrack|deluxe|expanded)[^)\]]*[)\]]\s*$/i;

const norm = (t: string): string => t.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, '');

export function songLine(song: Song): SongLine {
  const albumFull = (song.album?.name ?? '').replace(ALBUM_NOISE, '').trim();
  // v2 — the album can carry the tag too: "Mangal Rang (From "Ramayana")".
  const albumFrom = FROM_TAG.exec(albumFull);
  const rawAlbum = albumFrom ? albumFull.replace(FROM_TAG, '').trim() : albumFull;
  const from = FROM_TAG.exec(song.title);
  const film = from?.[1]?.trim() || albumFrom?.[1]?.trim() || null;
  const baseTitle = song.title.replace(FROM_TAG, '').trim();
  // Prefer the album; a single released under its own title falls back to the "(From …)" film when there is one.
  const isSelfTitled = !!rawAlbum && norm(rawAlbum) === norm(baseTitle);
  const album = (isSelfTitled ? film : rawAlbum) || film || null;
  const title = from && album ? baseTitle : song.title;
  // No artist list: the subtitle is often "Artists - Album"; keep the artists,
  // and nothing at all when what is left only repeats the album or the title.
  let artist = song.artists.length ? song.artists.slice(0, 2).map((a) => a.name).join(', ') : (song.subtitle ?? '').split(/\s+[-–]\s+/)[0];
  artist = artist.trim();
  const a = norm(artist);
  if (a && [albumFull, rawAlbum, album ?? '', song.title, baseTitle].some((t) => t && norm(t) === a)) artist = '';
  return { title, album, artist };
}

/** "Song – Movie/Album – Artist" (the album part is left out when the catalogue has none). */
export function formatSongLine(song: Song): string {
  const { title, album, artist } = songLine(song);
  return [title, album, artist].filter(Boolean).join(' – ');
}
