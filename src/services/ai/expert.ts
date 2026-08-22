import type { Song } from '@/types';
import { isNativePlatform } from '@/services/native';
import { buildTasteSnapshot } from '@/services/ai/taste';
import { resolveSuggestions, type Suggestion } from '@/services/ai/playlist';

/**
 * Search-page music expert — a dedicated, specialized discovery engine.
 * Sends the listener's query + preferred languages to the server's hidden
 * `expert` mode (its own AI lane, tuned for personalized song discovery),
 * parses the "Title — Artist" suggestions and resolves them to playable
 * catalog songs.
 */

// Same-origin on web; the native app calls the deployed function directly.
const ENDPOINT = isNativePlatform() ? 'https://www.sirimillavinay.online/api/vinaxai' : '/api/vinaxai';

export type ExpertSearchResult =
  | { ok: true; songs: Song[] }
  | { ok: false; reason: 'not_configured' | 'empty' | 'error' };

/** Parse "Title — Artist" lines (bullets/numbering/bold tolerated) into picks. */
function parseSuggestions(text: string): Suggestion[] {
  const out: Suggestion[] = [];
  const seen = new Set<string>();
  for (const raw of text.split('\n')) {
    const line = raw
      .replace(/^[\s*\-•\d.)]+/, '')
      .replace(/\*\*/g, '')
      .trim();
    const m = /^(.{1,80}?)\s+[—–-]\s+(.{1,60})$/.exec(line);
    if (!m) continue;
    const title = m[1].trim();
    const artist = m[2].trim();
    const key = `${title}|${artist}`.toLowerCase();
    if (!title || !artist || seen.has(key)) continue;
    seen.add(key);
    out.push({ title, artist });
    if (out.length >= 14) break;
  }
  return out;
}

/** Ask the music expert for songs matching a free-form search query. */
export async function expertSongSearch(
  query: string,
  languages: string[],
  muted: string[] = [],
): Promise<ExpertSearchResult> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 30_000);
  let text = '';
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-vinax-client': isNativePlatform() ? 'app' : 'web',
      },
      body: JSON.stringify({
        mode: 'expert',
        messages: [
          {
            role: 'user',
            content:
              `Search query: "${query.slice(0, 200)}"\n` +
              `Preferred languages: ${languages.length ? languages.join(', ') : 'any'}`,
          },
        ],
        taste: buildTasteSnapshot(),
      }),
      signal: ctrl.signal,
    });
    if (res.status === 503) return { ok: false, reason: 'not_configured' };
    if (!res.ok || !res.body) return { ok: false, reason: 'error' };
    // Drain the SSE stream and accumulate the deltas into the full reply.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data) continue;
        try {
          const j = JSON.parse(data) as { delta?: unknown };
          if (typeof j.delta === 'string') text += j.delta;
        } catch {
          /* skip a malformed SSE chunk */
        }
      }
    }
  } catch {
    return { ok: false, reason: 'error' };
  } finally {
    window.clearTimeout(timer);
  }

  const suggestions = parseSuggestions(text);
  if (!suggestions.length) return { ok: false, reason: 'empty' };
  const songs = await resolveSuggestions(suggestions, 12, muted);
  if (!songs.length) return { ok: false, reason: 'empty' };
  return { ok: true, songs };
}
