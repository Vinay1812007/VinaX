/**
 * What a cast receiver is sent for a song, built once for both senders: the
 * Cast web SDK (services/cast/index.ts) and the Android app's VinaxCast
 * plugin (services/cast/native.ts). Plain data; each sender turns it into its
 * own load request.
 */
import type { Song } from '@/types';
import { orderedSources, type StreamQualityPref } from '@/services/audio/engine';
import { bestImage } from '@/utils/images';

export interface CastMedia {
  url: string;
  contentType: string;
  title: string;
  artist: string;
  /** Artwork URL, '' when the song has none. */
  image: string;
}

export function castMime(url: string): string {
  const m = url.match(/\.(mp4|m4a|aac|mp3|ogg|webm|flac|wav)(?:[?#]|$)/i);
  const ext = m ? m[1].toLowerCase() : '';
  if (ext === 'mp3') return 'audio/mpeg';
  if (ext === 'ogg') return 'audio/ogg';
  if (ext === 'webm') return 'audio/webm';
  if (ext === 'flac') return 'audio/flac';
  if (ext === 'wav') return 'audio/wav';
  return 'audio/mp4'; // m4a/mp4/aac, and the upstream default
}

const isNetworkUrl = (u: string): boolean => /^https?:\/\//i.test(u);

/** The song's best stream the receiver can fetch itself (a network URL), or null. */
export function castMediaFor(song: Song, quality: StreamQualityPref): CastMedia | null {
  const url = orderedSources(song, quality).find(isNetworkUrl);
  if (!url) return null;
  const art = bestImage(song.images, 500); // the inline placeholder is no use to a TV
  return { url, contentType: castMime(url), title: song.title, artist: song.subtitle, image: isNetworkUrl(art) ? art : '' };
}
