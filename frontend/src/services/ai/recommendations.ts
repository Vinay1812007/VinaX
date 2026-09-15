import type { Song } from '@/types';
import { isNativePlatform } from '@/services/native';
import { buildTasteSnapshot } from './taste';

/** Model aliases are resolved by the existing server router. Keeping aliases
 * here (rather than provider ids) lets routing/failover change server-side. */
export interface RecommendationAiRouting {
  metadata: string[];
  ranking: string[];
  metadataTimeoutMs: number;
  rankingTimeoutMs: number;
}

export const RECOMMENDATION_AI_ROUTING: RecommendationAiRouting = {
  metadata: ['nano', 'mini', 'swift', 'flash', 'musegl', 'router'],
  ranking: ['pro', 'sage', 'nova', 'muse', 'scholar', 'router'],
  metadataTimeoutMs: 2200,
  rankingTimeoutMs: 4500,
};

const ENDPOINT = isNativePlatform() ? 'https://www.sirimillavinay.online/api/vinaxai' : '/api/vinaxai';
const CACHE_KEY = 'vinax.recommendation.ai-metadata.v1';
const HEALTH_KEY = 'vinax.recommendation.ai-health.v1';
const CACHE_TTL = 30 * 86_400_000;

export interface AiSongMetadata {
  id: string;
  mood?: string;
  vibe?: string[];
  language?: string;
  dialect?: string;
  subLanguage?: string;
  genre?: string[];
  energy?: number;
  tempo?: number;
  context?: string[];
}

interface CachedEntry { at: number; metadata: AiSongMetadata; }

function readJson<T>(key: string, fallback: T): T {
  try { return JSON.parse(window.localStorage.getItem(key) || '') as T; } catch { return fallback; }
}
function writeJson(key: string, value: unknown): void {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage is optional */ }
}

function cached(): Record<string, CachedEntry> { return readJson(CACHE_KEY, {}); }
function health(): Record<string, { latency: number; failures: number; at: number }> { return readJson(HEALTH_KEY, {}); }

function chooseModes(modes: string[]): string[] {
  const h = health();
  return [...modes].sort((a, b) => (h[a]?.failures ?? 0) - (h[b]?.failures ?? 0) || (h[a]?.latency ?? 0) - (h[b]?.latency ?? 0));
}

async function ask(mode: string, prompt: string, timeoutMs: number): Promise<string> {
  const started = performance.now();
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-vinax-client': isNativePlatform() ? 'app' : 'web' },
      body: JSON.stringify({ mode, messages: [{ role: 'user', content: prompt }], taste: buildTasteSnapshot() }), signal: ctrl.signal,
    });
    if (!res.ok || !res.body) throw new Error(`recommendation AI ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = ''; let text = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl = -1;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim(); buffer = buffer.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        try { const chunk = JSON.parse(line.slice(5).trim()) as { delta?: unknown; text?: unknown }; if (typeof chunk.delta === 'string') text += chunk.delta; else if (typeof chunk.text === 'string') text += chunk.text; } catch { /* ignore malformed SSE */ }
      }
    }
    const h = health(); h[mode] = { latency: performance.now() - started, failures: 0, at: Date.now() }; writeJson(HEALTH_KEY, h);
    return text;
  } catch (error) {
    const h = health(); const prev = h[mode]; h[mode] = { latency: prev?.latency ?? timeoutMs, failures: (prev?.failures ?? 0) + 1, at: Date.now() }; writeJson(HEALTH_KEY, h);
    throw error;
  } finally { window.clearTimeout(timer); }
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? text;
  const start = fenced.search(/[[]{/); const end = Math.max(fenced.lastIndexOf(']'), fenced.lastIndexOf('}'));
  if (start < 0 || end < start) return null;
  try { return JSON.parse(fenced.slice(start, end + 1)); } catch { return null; }
}

function normaliseMetadata(raw: unknown): AiSongMetadata[] {
  const rows = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' && Array.isArray((raw as { songs?: unknown }).songs) ? (raw as { songs: unknown[] }).songs : []);
  return rows.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object').map((row) => ({
    id: String(row.id ?? ''), mood: typeof row.mood === 'string' ? row.mood : undefined,
    vibe: Array.isArray(row.vibe) ? row.vibe.filter((v): v is string => typeof v === 'string') : typeof row.vibe === 'string' ? [row.vibe] : undefined,
    language: typeof row.language === 'string' ? row.language : undefined,
    dialect: typeof row.dialect === 'string' ? row.dialect : undefined,
    subLanguage: typeof row.subLanguage === 'string' ? row.subLanguage : undefined,
    genre: Array.isArray(row.genre) ? row.genre.filter((v): v is string => typeof v === 'string') : typeof row.genre === 'string' ? [row.genre] : undefined,
    energy: typeof row.energy === 'number' ? Math.max(0, Math.min(1, row.energy)) : undefined,
    tempo: typeof row.tempo === 'number' ? row.tempo : undefined,
    context: Array.isArray(row.context) ? row.context.filter((v): v is string => typeof v === 'string') : undefined,
  })).filter((row) => row.id);
}

export async function classifySongs(songs: Song[]): Promise<AiSongMetadata[]> {
  const store = cached(); const fresh: AiSongMetadata[] = []; const missing: Song[] = [];
  for (const song of songs.slice(0, 24)) {
    const hit = store[song.id];
    if (hit && Date.now() - hit.at < CACHE_TTL) fresh.push(hit.metadata); else missing.push(song);
  }
  if (!missing.length) return fresh;
  const payload = missing.map((s) => ({ id: s.id, title: s.title, subtitle: s.subtitle, language: s.language, artists: s.artists.map((a) => a.name), album: s.album?.name }));
  const prompt = 'Classify each song for recommendation. Return ONLY a JSON array with the same ids. Fields: id, mood, vibe (array), language, dialect, subLanguage, genre (array), energy (0..1), tempo (BPM), context (array such as workout, focus, commute). Infer conservatively and never invent an artist.\n' + JSON.stringify(payload);
  for (const mode of chooseModes(RECOMMENDATION_AI_ROUTING.metadata)) {
    try {
      const rows = normaliseMetadata(extractJson(await ask(mode, prompt, RECOMMENDATION_AI_ROUTING.metadataTimeoutMs)));
      if (!rows.length) continue;
      const now = Date.now(); for (const row of rows) store[row.id] = { at: now, metadata: row };
      const keys = Object.keys(store); if (keys.length > 500) for (const key of keys.slice(0, keys.length - 500)) delete store[key];
      writeJson(CACHE_KEY, store);
      return [...fresh, ...rows];
    } catch { /* automatic router fallback */ }
  }
  return fresh;
}

export function applyMetadata(songs: Song[], metadata: AiSongMetadata[]): Song[] {
  const byId = new Map(metadata.map((m) => [m.id, m]));
  return songs.map((song) => { const m = byId.get(song.id); if (!m) return song; return { ...song, mood: m.mood ?? song.mood, dialect: m.dialect ?? song.dialect, subLanguage: m.subLanguage ?? song.subLanguage, genre: m.genre?.[0] ?? song.genre, genres: [...new Set([...(song.genres ?? []), ...(m.genre ?? [])])], vibe: m.vibe?.[0] ?? song.vibe, vibes: [...new Set([...(song.vibes ?? []), ...(m.vibe ?? [])])], energy: m.energy ?? song.energy, tempo: m.tempo ?? song.tempo, language: song.language ?? m.language ?? null }; });
}

export async function enrichSongs(songs: Song[]): Promise<Song[]> {
  if (!songs.length) return songs;
  return applyMetadata(songs, await classifySongs(songs));
}

export async function aiRerankSongs(songs: Song[], context: string, limit: number): Promise<Song[]> {
  if (songs.length < 3) return songs.slice(0, limit);
  const prompt = 'Rank these songs for the listener context. Return ONLY a JSON array of song ids in order, no explanation. Prefer relevant but include tasteful diversity and discovery.\nCONTEXT:\n' + context.slice(0, 3000) + '\nSONGS:\n' + JSON.stringify(songs.slice(0, 40).map((s) => ({ id: s.id, title: s.title, artist: s.artists[0]?.name, language: s.language, genre: s.genres ?? s.genre, vibe: s.vibes ?? s.vibe, energy: s.energy, tempo: s.tempo })));
  for (const mode of chooseModes(RECOMMENDATION_AI_ROUTING.ranking)) {
    try {
      const raw = extractJson(await ask(mode, prompt, RECOMMENDATION_AI_ROUTING.rankingTimeoutMs));
      if (!Array.isArray(raw)) continue;
      const byId = new Map(songs.map((s) => [s.id, s])); const ordered = raw.map((id) => byId.get(String(id))).filter((s): s is Song => !!s);
      const seen = new Set(ordered.map((s) => s.id)); return [...ordered, ...songs.filter((s) => !seen.has(s.id))].slice(0, limit);
    } catch { /* fallback to deterministic ranking */ }
  }
  return songs.slice(0, limit);
}
