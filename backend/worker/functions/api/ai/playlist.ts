/**
 * 8.5.0 — POST /api/ai/playlist — a described playlist, as catalogue song ids.
 *
 *   request  { prompt: string (1–500 chars), languages?: string[],
 *              taste?: <taste snapshot, see _lib/taste.ts>, avoidTitles?: string[] (≤ 60),
 *              limit?: 10–30 (default 25) }
 *   200      { title, description,
 *              tracks: [{ id, reason, title, artist, album, language, year,
 *                         source: 'ai' | 'catalogue' }],
 *              source: 'ai' | 'catalogue', dropped: number }
 *   400      { error: 'bad_request' }   413 { error: 'too_large' }
 *   429      { error: 'rate_limited', retryAfter }
 *   502      { error: 'catalogue_unavailable' }
 *
 * The same generation as /api/playlist (which keeps answering titles for the
 * app builds already installed), then every suggestion is looked up in the
 * catalogue HERE (_lib/playlistResolve.ts): a suggestion with no matching
 * catalogue song is dropped and counted in `dropped`, never swapped for a
 * different song. A short list is topped up with catalogue songs for the
 * request's own filters (`source: 'catalogue'` on those tracks), and when the
 * AI is off, over budget or unusable the whole playlist comes from the
 * catalogue (`source: 'catalogue'`) instead of an error.
 */
import { type AiEnv } from '../../_lib/ai';
import { resolveSuggestions } from '../../_lib/playlistResolve';
import { methodNotAllowed } from '../../_lib/ratelimit';
import { describeFilters, rulesFilters, type SearchFilters } from '../../_lib/searchFilters';
import { type SupabaseEnv } from '../../_lib/supabase';
import { CatalogUnavailable } from '../../_lib/trends/catalog';
import { runPlaylist } from '../playlist';
import { retrieve } from './search';

type Env = AiEnv & SupabaseEnv;

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, x-vinax-client',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS } });
}

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: CORS });
export const onRequestGet = async (): Promise<Response> => methodNotAllowed();

export interface PlaylistTrack {
  id: string;
  reason: string;
  title: string;
  artist: string;
  album: string | null;
  language: string | null;
  year: number | null;
  source: 'ai' | 'catalogue';
}

const DEFAULT_LIMIT = 25;
/** Fewer resolved AI picks than this are topped up from the catalogue. */
const MIN_TRACKS = 12;
/** Catalogue look-ups get this long after the generation; rounds already started finish. */
const RESOLVE_BUDGET_MS = 9_000;

/** A plain title for a catalogue playlist, from the request's own filters. */
export function fallbackTitle(f: SearchFilters): string {
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const moodName: Record<string, string> = { romantic: 'Romance', energetic: 'Energy', chill: 'Chill', melancholy: 'Heartbreak', devotional: 'Devotion' };
  const lang = f.languages[0] ? `${cap(f.languages[0])} ` : '';
  if (f.activity) return `${lang}${cap(f.activity)} Mix`;
  if (f.moods[0]) return `${lang}${moodName[f.moods[0]]} Mix`;
  if (f.instrumental) return `${lang}Instrumental Mix`;
  return `${lang}Mix`.trim();
}

/** Read the optional `limit` from a CLONE of the request (the generation reads the body itself). */
async function readLimit(request: Request): Promise<number | null> {
  const body = (await request.clone().json().catch(() => null)) as { limit?: unknown } | null;
  if (!body || body.limit === undefined) return DEFAULT_LIMIT;
  return typeof body.limit === 'number' && Number.isInteger(body.limit) && body.limit >= 10 && body.limit <= 30 ? body.limit : null;
}

async function catalogueTracks(prompt: string, languages: string[], limit: number, exclude: Set<string>): Promise<PlaylistTrack[]> {
  const filters = rulesFilters(prompt);
  const found = await retrieve(filters, languages, Math.min(30, limit + exclude.size));
  return found.tracks
    .filter((t) => !exclude.has(t.id))
    .slice(0, limit)
    .map((t) => ({ id: t.id, reason: t.reasonText, title: t.title, artist: t.artist, album: t.album, language: t.language, year: t.year, source: 'catalogue' as const }));
}

export const onRequestPost = async (context: { request: Request; env: Env; waitUntil?: (p: Promise<unknown>) => void }): Promise<Response> => {
  try {
    const limit = await readLimit(context.request);
    if (limit == null) return json({ error: 'bad_request' }, 400);
    const run = await runPlaylist(context);
    if (!run.ok) {
      // Rate limits and bad requests keep their answer; an unavailable AI falls back to the catalogue.
      if (!run.aiUnavailable || !run.prompt) return run.response;
      const tracks = await catalogueTracks(run.prompt, run.languages ?? [], limit, new Set());
      const filters = rulesFilters(run.prompt);
      return json({
        title: fallbackTitle(filters),
        description: tracks.length ? `Songs from the VinaX catalogue that match ${describeFilters(filters) || 'your request'}.` : 'Nothing in the catalogue matched this request yet.',
        tracks,
        source: 'catalogue',
        dropped: 0,
      });
    }
    const { parsed, reading, prompt, languages } = run;
    // Only a language the request itself names is enforced; saved languages guided the model but do not filter.
    const resolved = await resolveSuggestions(parsed.songs, { languages: reading.languages, limit, deadlineAt: Date.now() + RESOLVE_BUDGET_MS });
    const tracks: PlaylistTrack[] = resolved.map(({ song, suggestion }) => ({
      id: song.id,
      reason: suggestion.reason || 'Chosen by VinaX AI for this request',
      title: song.title,
      artist: song.primaryArtists[0] ?? suggestion.artist,
      album: song.album,
      language: song.language,
      year: song.year,
      source: 'ai',
    }));
    const dropped = Math.max(0, Math.min(parsed.songs.length, limit) - tracks.length);
    if (tracks.length < Math.min(MIN_TRACKS, limit)) {
      const more = await catalogueTracks(prompt, languages, limit - tracks.length, new Set(tracks.map((t) => t.id))).catch((e) => {
        if (e instanceof CatalogUnavailable && !tracks.length) throw e;
        return [] as PlaylistTrack[];
      });
      tracks.push(...more);
    }
    const source = tracks.some((t) => t.source === 'ai') ? 'ai' : 'catalogue';
    return json({
      title: (source === 'ai' && parsed.name) || fallbackTitle(rulesFilters(prompt)),
      description: (source === 'ai' && parsed.description) || 'Songs from the VinaX catalogue that match your request.',
      tracks,
      source,
      dropped,
    });
  } catch (e) {
    if (e instanceof CatalogUnavailable) return json({ error: 'catalogue_unavailable' }, 502);
    console.warn('[ai-playlist] unhandled:', e instanceof Error ? e.name : 'error');
    return json({ error: 'internal' }, 500);
  }
};
