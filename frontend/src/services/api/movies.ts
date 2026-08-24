/**
 * Movie projection — formalizes "a film" over the catalog's soundtrack albums.
 * Album names carry the film title: `Song (From "Film")` or
 * `Film (Original Motion Picture Soundtrack)`. Parser is unit-tested.
 */
import type { Album, Movie } from '@/types';

const LANG_SUFFIX =
  /\s*\((?:telugu|tamil|hindi|kannada|malayalam|bengali|marathi|punjabi|gujarati|bhojpuri|urdu|english)\)\s*$/i;

/** Extract the film title from an album/song-collection name, or null. */
export function filmTitleFromAlbumName(name: string): string | null {
  let t: string | null = null;
  const from = /\(from\s+["“'']?(.+?)["”'']?\s*\)\s*$/i.exec(name);
  if (from) t = from[1];
  if (!t) {
    const ost = /^(.*?)\s*\((?:original motion picture soundtrack|original background score)\)/i.exec(name);
    if (ost) t = ost[1];
  }
  if (!t) return null;
  t = t.replace(LANG_SUFFIX, '').trim();
  return t || null;
}

/** Typed Movie view over a soundtrack album; null when it isn't film music. */
export function movieFromAlbum(album: Album): Movie | null {
  const title = filmTitleFromAlbumName(album.title);
  if (!title) return null;
  return {
    kind: 'movie',
    id: album.id,
    title,
    language: album.language ?? null,
    year: album.year ?? null,
    albumId: album.id,
    images: album.images,
  };
}
