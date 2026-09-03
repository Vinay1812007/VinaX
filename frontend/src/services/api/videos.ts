/**
 * Music videos (v5.7.9) — served by the VinaX Music API only (the fallback
 * catalog bases have no video routes, so this rides a direct client instead
 * of the orchestrator).
 *
 * Honest playback contract, verified against the live upstream:
 *  - `previewUrl` is a real 720p MP4 clip (~30s) that always plays — the
 *    JioSaavn-video-CDN "preview" rendition.
 *  - `streamUrl` (the full-length master) is 404 upstream for every video
 *    probed at ship time. The player still tries it FIRST, so full videos
 *    light up automatically the moment the source starts serving them.
 *  - `songIds` bridges a video to the full audio track in our catalog.
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

const BASE = 'https://vinax-saavan-api.onrender.com/api';

/** The upstream titles arrive HTML-encoded ("Tested, Approved &amp; Trusted"). */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

async function getJson(url: string, timeoutMs = 12_000): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

interface RawArtist {
  id?: unknown;
  name?: unknown;
}
interface RawVideo {
  id?: unknown;
  name?: unknown;
  language?: unknown;
  year?: unknown;
  duration?: unknown;
  thumbnail?: unknown;
  streamUrl?: unknown;
  previewUrl?: unknown;
  songIds?: unknown;
  artists?: { primary?: RawArtist[]; all?: RawArtist[] };
}

function normalizeVideo(raw: RawVideo | null | undefined): Video | null {
  if (!raw || typeof raw.id !== 'string' || typeof raw.name !== 'string') return null;
  const artistsRaw = raw.artists?.primary?.length ? raw.artists.primary : raw.artists?.all ?? [];
  const artists: VideoArtistRef[] = artistsRaw
    .filter((a): a is { id: string; name: string } => typeof a?.id === 'string' && typeof a?.name === 'string')
    .map((a) => ({ id: a.id, name: decodeEntities(a.name) }));
  const songIds =
    typeof raw.songIds === 'string'
      ? raw.songIds.split(',').map((s) => s.trim()).filter(Boolean)
      : Array.isArray(raw.songIds)
        ? raw.songIds.filter((s): s is string => typeof s === 'string')
        : [];
  const lang = typeof raw.language === 'string' && raw.language.toLowerCase() !== 'unknown' ? raw.language : null;
  return {
    id: raw.id,
    title: decodeEntities(raw.name),
    subtitle: artists.map((a) => a.name).join(', '),
    language: lang,
    year: typeof raw.year === 'string' && raw.year !== '0' ? raw.year : null,
    duration: typeof raw.duration === 'number' && raw.duration > 0 ? raw.duration : null,
    thumbnail: typeof raw.thumbnail === 'string' ? raw.thumbnail : null,
    streamUrl: typeof raw.streamUrl === 'string' ? raw.streamUrl : null,
    previewUrl: typeof raw.previewUrl === 'string' ? raw.previewUrl : null,
    songIds,
    artists,
  };
}

export async function searchVideos(query: string, page = 0, limit = 20): Promise<Video[]> {
  const url = `${BASE}/videos?query=${encodeURIComponent(query)}&page=${page}&limit=${limit}`;
  const json = (await getJson(url)) as { data?: { results?: RawVideo[] } } | null;
  const list = json?.data?.results ?? [];
  const seen = new Set<string>();
  const out: Video[] = [];
  for (const raw of list) {
    const v = normalizeVideo(raw);
    if (v && !seen.has(v.id)) {
      seen.add(v.id);
      out.push(v);
    }
  }
  return out;
}

export async function getVideo(id: string): Promise<Video | null> {
  const json = (await getJson(`${BASE}/videos/${encodeURIComponent(id)}`)) as { data?: RawVideo } | null;
  return normalizeVideo(json?.data);
}

/** Playable sources for a video, best first: the full stream (tried first so
 *  full videos work the day the source serves them), then the preview clip. */
export function videoSources(v: Video): string[] {
  const out: string[] = [];
  if (v.streamUrl) out.push(v.streamUrl);
  if (v.previewUrl) out.push(v.previewUrl);
  return out;
}
