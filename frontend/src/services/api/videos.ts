import type { Song } from '@/types';

/**
 * Music videos (v5.7.9). They came from the music catalogue, which was
 * removed with every provider: searches and lookups now find nothing. The
 * types and the rendition helpers stay for the screens that use them.
 */

export interface VideoArtistRef {
  id: string;
  name: string;
}

export interface Video {
  id: string;
  title: string;
  subtitle: string;
  language: string | null;
  year: string | null;
  duration: number | null;
  thumbnail: string | null;
  streamUrl: string | null;
  previewUrl: string | null;
  songIds: string[];
  artists: VideoArtistRef[];
}

/** Video search. VinaX has no music catalogue any more, so there are none. */
export async function searchVideos(_query: string, _page = 0, _limit = 20): Promise<Video[]> {
  return [];
}

/** One video by id. There is no catalogue, so none is found. */
export async function getVideo(_id: string): Promise<Video | null> {
  return null;
}

/** Playable sources for a video, best first: the full stream (tried first so
 *  full videos work the day the source serves them), then the preview clip. */
export function videoSources(v: Video): string[] {
  const out: string[] = [];
  if (v.streamUrl) out.push(v.streamUrl);
  if (v.previewUrl) out.push(v.previewUrl);
  return out;
}


/** The video canvas behind Now Playing. There is no catalogue, so no song has one. */
export async function findVideoForSong(_song: Song): Promise<Video | null> {
  return null;
}

// ---------------------------------------------------------------- renditions

/**
 * 13.9 — the clip CDN publishes each preview in named renditions,
 * `…_v_<height>p_p.mp4`. The catalogue names the 540p file; a 360p file sits
 * beside every one we probed, and nothing above 540p exists today. The ladder
 * still lists 720p, 1080p, 1440p and 4K so they light up the day the CDN
 * starts serving them (services/canvas/quality probes before trusting them).
 */
export const RENDITION_HEIGHTS = [2160, 1440, 1080, 720, 540, 360] as const;

const RENDITION_RE = /_v_(\d{3,4})p_p\.mp4(?=$|[?#])/;

/** The height a rendition URL names, or null for a URL without the marker. */
export function renditionHeight(url: string | null | undefined): number | null {
  if (!url) return null;
  const m = RENDITION_RE.exec(url);
  return m ? Number(m[1]) : null;
}

/** The same clip at another height, or null when the URL has no rendition marker. */
export function renditionUrl(url: string, height: number): string | null {
  if (!RENDITION_RE.test(url)) return null;
  return url.replace(RENDITION_RE, `_v_${height}p_p.mp4`);
}

/** How a listener reads a height: 4K, Full HD 1080p, HD 720p, 540p… */
export function qualityLabel(height: number): string {
  if (height >= 2160) return '4K';
  if (height >= 1440) return '1440p';
  if (height >= 1080) return 'Full HD 1080p';
  if (height >= 720) return 'HD 720p';
  return `${height}p`;
}

/** The short form for a chip: 4K · 1080p · 720p · 540p. */
export function qualityBadge(height: number): string {
  return height >= 2160 ? '4K' : `${height}p`;
}
