import { HUB_LANGUAGES, LANGUAGES, languageLabel } from '@/constants/languages';
import { bestImage } from '@/utils/images';
import { albumPath, artistPath, songPath } from '@/utils/slug';
import type { Album, Artist, Song } from '@/types/music';

export const SITE_ORIGIN = 'https://www.sirimillavinay.online';

/** Map a catalog language id ("telugu") to a BCP-47 tag ("te") for schema.org. */
export function bcp47(languageId: string | null | undefined): string | undefined {
  if (!languageId) return undefined;
  return LANGUAGES.find((l) => l.id === languageId)?.locales[0] ?? languageId;
}

/** ISO-8601 duration from seconds (245 → "PT4M5S"). */
export function isoDuration(seconds: number | null | undefined): string | undefined {
  if (seconds == null || seconds <= 0) return undefined;
  return `PT${Math.floor(seconds / 60)}M${Math.round(seconds % 60)}S`;
}

function artistRefLd(a: { id: string; name: string }): Record<string, unknown> {
  return a.id
    ? {
        '@type': 'MusicGroup',
        '@id': `${SITE_ORIGIN}${artistPath(a)}#artist`,
        name: a.name,
        url: `${SITE_ORIGIN}${artistPath(a)}`,
      }
    : { '@type': 'MusicGroup', name: a.name };
}

/** schema.org MusicRecording for a song page. Mirrors the edge renderer's output. */
export function buildSongJsonLd(song: Song): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'MusicRecording',
    '@id': `${SITE_ORIGIN}${songPath(song)}#recording`,
    name: song.title,
    url: `${SITE_ORIGIN}${songPath(song)}`,
    image: bestImage(song.images, 500),
    duration: isoDuration(song.duration),
    inLanguage: bcp47(song.language),
    datePublished: song.year ?? undefined,
    byArtist: song.artists.slice(0, 3).map(artistRefLd),
    inAlbum: song.album?.id
      ? {
          '@type': 'MusicAlbum',
          '@id': `${SITE_ORIGIN}${albumPath(song.album)}#album`,
          name: song.album.name,
          url: `${SITE_ORIGIN}${albumPath(song.album)}`,
        }
      : undefined,
    isPartOf: { '@id': `${SITE_ORIGIN}/#website` },
  };
}

/** schema.org MusicAlbum with a track ItemList for an album page. */
export function buildAlbumJsonLd(album: Album): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'MusicAlbum',
    '@id': `${SITE_ORIGIN}${albumPath(album)}#album`,
    name: album.title,
    url: `${SITE_ORIGIN}${albumPath(album)}`,
    image: bestImage(album.images, 500),
    datePublished: album.year ?? undefined,
    inLanguage: bcp47(album.language),
    numTracks: album.songCount ?? album.songs.length,
    byArtist: album.artists.slice(0, 2).map(artistRefLd),
    track: {
      '@type': 'ItemList',
      numberOfItems: album.songs.length,
      itemListElement: album.songs.slice(0, 25).map((s, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        item: {
          '@type': 'MusicRecording',
          '@id': `${SITE_ORIGIN}${songPath(s)}#recording`,
          name: s.title,
          url: `${SITE_ORIGIN}${songPath(s)}`,
        },
      })),
    },
    isPartOf: { '@id': `${SITE_ORIGIN}/#website` },
  };
}

/** schema.org MusicGroup for an artist page. */
export function buildArtistJsonLd(artist: Artist): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'MusicGroup',
    '@id': `${SITE_ORIGIN}${artistPath(artist)}#artist`,
    name: artist.name,
    url: `${SITE_ORIGIN}${artistPath(artist)}`,
    image: bestImage(artist.images, 500),
    track: artist.topSongs.slice(0, 10).map((s) => ({
      '@type': 'MusicRecording',
      '@id': `${SITE_ORIGIN}${songPath(s)}#recording`,
      name: s.title,
      url: `${SITE_ORIGIN}${songPath(s)}`,
    })),
    isPartOf: { '@id': `${SITE_ORIGIN}/#website` },
  };
}

export interface Crumb {
  name: string;
  item?: string;
}

/** schema.org BreadcrumbList from an ordered trail; the last crumb is the current page (no item). */
export function buildBreadcrumbLd(crumbs: Crumb[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      ...(c.item ? { item: c.item } : {}),
    })),
  };
}

/** Language-hub crumb ("Telugu Songs" → /telugu-songs) when the language has a hub page. */
export function hubCrumbs(language: string | null | undefined): Crumb[] {
  if (!language || !(HUB_LANGUAGES as readonly string[]).includes(language)) return [];
  return [{ name: `${languageLabel(language)} Songs`, item: `${SITE_ORIGIN}/${language}-songs` }];
}

export function buildSongBreadcrumbs(song: Song): Record<string, unknown> {
  return buildBreadcrumbLd([
    { name: 'Home', item: `${SITE_ORIGIN}/` },
    ...hubCrumbs(song.language),
    ...(song.album?.id ? [{ name: song.album.name, item: `${SITE_ORIGIN}${albumPath(song.album)}` }] : []),
    { name: song.title },
  ]);
}

export function buildAlbumBreadcrumbs(album: Album): Record<string, unknown> {
  return buildBreadcrumbLd([
    { name: 'Home', item: `${SITE_ORIGIN}/` },
    ...hubCrumbs(album.language),
    { name: album.title },
  ]);
}

export function buildArtistBreadcrumbs(artist: Artist): Record<string, unknown> {
  return buildBreadcrumbLd([{ name: 'Home', item: `${SITE_ORIGIN}/` }, { name: artist.name }]);
}
