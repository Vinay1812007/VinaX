import { isBlockedSong } from '@/services/content/blocklist';
import type {
  Album,
  AlbumRef,
  Artist,
  ArtistRef,
  AudioVariant,
  ImageVariant,
  Lyrics,
  Playlist,
  Song,
} from '@/types';
import { decodeHtml } from '@/utils/format';
import { normalizeLanguage } from '@/constants/languages';

/* eslint-disable @typescript-eslint/no-explicit-any */
// This module is the single boundary where untyped upstream JSON becomes
// typed app models, so localized `any` access is intentional here.

function str(...vals: unknown[]): string {
  for (const v of vals) if (typeof v === 'string' && v.trim()) return v;
  return '';
}

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

function upscaleImage(url: string): string {
  return url.replace(/150x150|50x50/, '500x500');
}

export function toImages(input: unknown): ImageVariant[] {
  if (typeof input === 'string' && input) {
    return [{ quality: '500x500', url: upscaleImage(input) }];
  }
  if (Array.isArray(input)) {
    return input
      .map((i: any) => ({
        quality: str(i?.quality, '500x500'),
        url: str(i?.url, i?.link),
      }))
      .filter((v) => v.url);
  }
  return [];
}

export function toAudio(input: unknown): AudioVariant[] {
  if (typeof input === 'string' && input) return [{ quality: '160kbps', url: input }];
  if (Array.isArray(input)) {
    return input
      .map((i: any) => ({ quality: str(i?.quality, '160kbps'), url: str(i?.url, i?.link) }))
      .filter((v) => v.url);
  }
  return [];
}

function firstImageUrl(input: unknown): string | null {
  const imgs = toImages(input);
  return imgs.length ? imgs[imgs.length - 1].url : null;
}

// Hoisted above the first user so the `warnedArtistShape` reference inside
// toArtistRefs isn't a TDZ hazard (function hoists, `let` doesn't).
let warnedArtistShape = false;

function toArtistRefs(raw: any): ArtistRef[] {
  const source = raw?.artists?.primary ?? raw?.artists?.all ?? raw?.primaryArtists ?? raw?.more_info?.artistMap?.primary_artists;
  if (Array.isArray(source)) {
    return source
      .map((a: any) => ({
        id: String(a?.id ?? ''),
        name: decodeHtml(str(a?.name, a?.title)),
        role: typeof a?.role === 'string' ? a.role : undefined,
        image: firstImageUrl(a?.image),
      }))
      .filter((a) => a.name);
  }
  if (typeof source === 'string' && source.trim()) {
    return source
      .split(',')
      .map((n) => ({ id: '', name: decodeHtml(n.trim()) }))
      .filter((a) => a.name);
  }
  // When every well-known shape misses, we return [] and every downstream
  // subtitle becomes empty with no diagnostic. Warn once per session in dev
  // so an upstream API drift is visible instead of silently degrading UX
  // (audit finding M9).
  if (raw?.artists && import.meta.env?.DEV && !warnedArtistShape) {
    warnedArtistShape = true;
    console.warn('[normalize] Unrecognized artists shape on raw payload:', Object.keys(raw.artists ?? {}));
  }
  return [];
}

function toAlbumRef(raw: any): AlbumRef | null {
  const a = raw?.album ?? raw?.more_info?.album;
  if (!a) return null;
  if (typeof a === 'string') return a.trim() ? { id: '', name: decodeHtml(a) } : null;
  const name = decodeHtml(str(a?.name, a?.title));
  return name ? { id: String(a?.id ?? ''), name } : null;
}

export function normalizeSong(raw: any): Song | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = str(raw.id, raw.songId);
  const title = decodeHtml(str(raw.name, raw.title, raw.song));
  if (!id || !title) return null;

  const artists = toArtistRefs(raw);
  const subtitle = decodeHtml(
    str(raw.subtitle, artists.map((a) => a.name).join(', '), raw.primaryArtists, raw.singers),
  );

  return {
    kind: 'song',
    id,
    title,
    subtitle,
    artists,
    album: toAlbumRef(raw),
    images: toImages(raw.image ?? raw.images),
    audio: toAudio(raw.downloadUrl ?? raw.download_url ?? raw.media_url ?? raw.mediaUrl ?? raw.more_info?.media_url),
    duration: num(raw.duration ?? raw.more_info?.duration),
    language: normalizeLanguage(raw.language ?? raw.more_info?.language),
    year: str(String(raw.year ?? ''), raw.releaseDate)?.slice(0, 4) || null,
    explicit: raw.explicitContent === true || raw.explicitContent === 1 || raw.explicit_content === '1',
    hasLyrics: raw.hasLyrics === true || raw.has_lyrics === 'true',
    playCount: num(raw.playCount ?? raw.play_count),
  };
}

export function normalizeSongList(raw: unknown): Song[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeSong).filter((s): s is Song => s !== null && !isBlockedSong(s));
}

export function normalizeAlbum(raw: any): Album | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = str(raw.id, raw.albumid);
  const title = decodeHtml(str(raw.name, raw.title));
  if (!id || !title) return null;
  const songsRaw = raw.songs ?? raw.list ?? raw.more_info?.songs;
  return {
    kind: 'album',
    id,
    title,
    subtitle: decodeHtml(str(raw.subtitle, raw.primaryArtists, raw.artist)),
    images: toImages(raw.image ?? raw.images),
    artists: toArtistRefs(raw),
    songs: normalizeSongList(songsRaw),
    songCount: num(raw.songCount ?? raw.more_info?.song_count) ?? (Array.isArray(songsRaw) ? songsRaw.length : null),
    year: str(String(raw.year ?? '')).slice(0, 4) || null,
    language: normalizeLanguage(raw.language),
  };
}

export function normalizePlaylist(raw: any): Playlist | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = str(raw.id, raw.listid);
  const title = decodeHtml(str(raw.name, raw.title, raw.listname));
  if (!id || !title) return null;
  const songsRaw = raw.songs ?? raw.list;
  return {
    kind: 'playlist',
    id,
    title,
    subtitle: decodeHtml(str(raw.subtitle, raw.description)),
    images: toImages(raw.image ?? raw.images),
    songs: normalizeSongList(songsRaw),
    songCount: num(raw.songCount ?? raw.list_count) ?? (Array.isArray(songsRaw) ? songsRaw.length : null),
    language: normalizeLanguage(raw.language),
  };
}

export function normalizeArtist(raw: any): Artist | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = str(raw.id, raw.artistId);
  const name = decodeHtml(str(raw.name, raw.title));
  if (!id || !name) return null;
  const bioRaw = raw.bio;
  let bio: string | null = null;
  if (typeof bioRaw === 'string') bio = decodeHtml(bioRaw);
  else if (Array.isArray(bioRaw) && bioRaw[0]?.text) bio = decodeHtml(String(bioRaw[0].text));
  return {
    kind: 'artist',
    id,
    name,
    subtitle: decodeHtml(str(raw.subtitle, raw.dominantType, 'Artist')),
    images: toImages(raw.image ?? raw.images),
    bio,
    topSongs: normalizeSongList(raw.topSongs ?? raw.top_songs),
    albums: Array.isArray(raw.topAlbums ?? raw.albums)
      ? ((raw.topAlbums ?? raw.albums) as unknown[])
          .map(normalizeAlbum)
          .filter((a): a is Album => a !== null)
      : [],
  };
}

export function normalizeLyrics(raw: any): Lyrics | null {
  if (!raw || typeof raw !== 'object') return null;
  const text = str(raw.lyrics, raw.lyrics_text, raw.snippet);
  if (!text) return null;
  return {
    lyrics: decodeHtml(text).replace(/<br\s*\/?>/gi, '\n'),
    copyright: typeof raw.copyright === 'string' ? decodeHtml(raw.copyright) : null,
  };
}

/** Unwrap `{success, data}` envelopes that most wrappers use. */
export function unwrap(json: unknown): any {
  const j = json as any;
  if (j && typeof j === 'object' && 'data' in j) return j.data;
  return j;
}
