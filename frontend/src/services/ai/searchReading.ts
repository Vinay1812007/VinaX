import { isNativePlatform } from '@/services/native';
import { useSettingsStore } from '@/store/settingsStore';
import type { IntentMood, MusicIntent } from './musicIntent';

/**
 * 8.5.0 — the server's reading of a described search (POST /api/ai/search
 * with `withTracks: false`): the AI model turns "something for a candle-light
 * dinner" into filters the on-device word lists cannot see. Only filters come
 * back — never songs — and the app fetches and ranks the songs itself, so a
 * slow or absent answer costs nothing but the extra cues.
 *
 * Off when the listener's AI switch is off; backs off after failures (half an
 * hour when the deployed backend does not have the route yet).
 */

const ENDPOINT = isNativePlatform() ? 'https://www.sirimillavinay.online/api/ai/search' : '/api/ai/search';
const LEASH_MS = 2_500;
const MOODS: readonly IntentMood[] = ['romantic', 'energetic', 'chill', 'melancholy', 'devotional'];

export interface ServerReading {
  languages: string[];
  moods: IntentMood[];
  energy: 'high' | 'low' | null;
  tempo: 'slow' | 'fast' | null;
  yearFrom: number | null;
  seed: string | null;
  instrumental: boolean;
  source: 'ai' | 'rules';
}

let retryAfter = 0;
let failures = 0;

function backOff(status: number | null): void {
  failures += 1;
  const ms = status === 404 || status === 405 ? 30 * 60_000 : status === 429 ? 60_000 : Math.min(15 * 60_000, 30_000 * 2 ** Math.min(failures - 1, 5));
  retryAfter = Date.now() + ms;
}

/** Test hook. */
export function resetSearchReading(): void {
  retryAfter = 0;
  failures = 0;
}

/** Re-check the server's answer: it is typed input like any other. */
export function toReading(data: unknown): ServerReading | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as { filters?: unknown; source?: unknown };
  const f = d.filters && typeof d.filters === 'object' ? (d.filters as Record<string, unknown>) : null;
  if (!f) return null;
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const seed = f.seed && typeof f.seed === 'object' ? (f.seed as { text?: unknown }).text : null;
  const year = typeof f.yearFrom === 'number' && Number.isInteger(f.yearFrom) && f.yearFrom >= 1940 && f.yearFrom <= 2100 ? f.yearFrom : null;
  return {
    languages: strings(f.languages).map((l) => l.toLowerCase()).filter((l) => /^[a-z]{2,20}$/.test(l)).slice(0, 3),
    moods: strings(f.moods).filter((m): m is IntentMood => (MOODS as readonly string[]).includes(m)).slice(0, 3),
    energy: f.energy === 'high' || f.energy === 'low' ? f.energy : null,
    tempo: f.tempo === 'slow' || f.tempo === 'fast' ? f.tempo : null,
    yearFrom: year,
    seed: typeof seed === 'string' && seed.trim().length >= 2 ? seed.trim().slice(0, 80) : null,
    instrumental: f.instrumental === true,
    source: d.source === 'ai' ? 'ai' : 'rules',
  };
}

/** The server's reading, or null (AI off, backed off, slow, or failed). Never throws. */
export async function readSearchOnServer(query: string, languages: readonly string[], signal?: AbortSignal): Promise<ServerReading | null> {
  try {
    if (useSettingsStore.getState().aiAssist === false) return null;
  } catch {
    /* settings unavailable: allowed */
  }
  if (Date.now() < retryAfter) return null;
  const ctrl = new AbortController();
  const abort = () => ctrl.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, LEASH_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-vinax-client': isNativePlatform() ? 'app' : 'web' },
      body: JSON.stringify({ query: query.slice(0, 200), languages: languages.slice(0, 3), withTracks: false }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      backOff(res.status);
      return null;
    }
    const reading = toReading(await res.json().catch(() => null));
    if (!reading) backOff(null);
    else failures = 0;
    return reading;
  } catch {
    // A leash timeout or the caller's abort is not a server failure.
    if (!ctrl.signal.aborted) backOff(null);
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

/**
 * The server's reading folded into the on-device one: what the device read
 * literally wins, the server fills what it missed (a mood, a seed, a period).
 * Returns the intent unchanged when the reading adds nothing.
 */
export function mergeReading(intent: MusicIntent, r: ServerReading | null): MusicIntent {
  if (!r || r.source !== 'ai') return intent;
  const moods = [...new Set([...intent.moods, ...r.moods])];
  const merged: MusicIntent = {
    ...intent,
    languages: intent.languages.length ? intent.languages : r.languages,
    moods,
    energy: intent.energy ?? r.energy,
    tempo: intent.tempo ?? r.tempo,
    decade: intent.decade ?? (r.yearFrom != null ? r.yearFrom - (r.yearFrom % 10) : null),
    seed: intent.seed ?? (r.seed ? { text: r.seed } : null),
    instrumental: intent.instrumental || r.instrumental,
  };
  const added = merged.languages.length - intent.languages.length + (moods.length - intent.moods.length) + (merged.seed && !intent.seed ? 1 : 0) + (merged.decade !== intent.decade ? 1 : 0) + (merged.instrumental !== !!intent.instrumental ? 1 : 0);
  return added > 0 ? { ...merged, cues: intent.cues + added } : intent;
}
