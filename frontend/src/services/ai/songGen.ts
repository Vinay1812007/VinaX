import { create } from 'zustand';
import type { Song } from '@/types';
import { currentAccount } from '@/services/auth/google';
import { isNativePlatform } from '@/services/native';
import { installId } from '@/services/identity/installId';
import { energyOfSong } from '@/services/personalization/session';
import { topArtists } from '@/services/personalization/profile';
import { loadProfile } from '@/services/personalization/storage';
import { inferMood } from '@/services/recommendation/mood';
import { buildSongProfile } from '@/services/recommendation/profiles';
import { kidModeOn } from '@/services/kidMode';

/**
 * 1.4 — "Generate a song like this", on the device.
 *
 * What leaves the device is the playing song's FEEL, from its metadata: mood,
 * energy, tempo, genre, language, a length, instrumental or not, and the
 * listener's own optional words. Never its audio, title, artist or lyrics.
 * The listener's words are checked here first (they may not name the playing
 * song, its artists or the artists the listener plays most), and again on the
 * Worker.
 *
 * A finished song is a NEW, ORIGINAL track. It carries `generated` and the
 * subtitle "AI generated · VinaX AI", which is what cards, Now Playing, the
 * lock screen and share cards show. Its audio lives on the Worker for a day;
 * saving it (a like, a playlist, Save) keeps a copy on the device through the
 * ordinary saved-songs path.
 */

const ORIGIN = isNativePlatform() ? 'https://www.vinaxmusic.online' : '';
const absolute = (path: string): string => `${ORIGIN || (typeof window !== 'undefined' ? window.location.origin : '')}${path}`;

export const GENERATED_ID_PREFIX = 'gen-';
export const GENERATED_SUBTITLE = 'AI generated · VinaX AI';
export const GENERATED_ARTIST = { id: 'vinax-ai-generated', name: 'AI generated' } as const;
export const MIN_SEC = 30;
export const MAX_SEC = 180;
/** A song added to a queue must clear the queue's 90-second rule. */
export const QUEUE_MIN_SEC = 90;
const POLL_MS = 2_000;
const WATCH_MAX_MS = 6 * 60_000;
const STATUS_TTL_MS = 5 * 60_000;

export const isGeneratedSong = (song: Pick<Song, 'id'> | null | undefined): boolean => !!song?.id?.startsWith(GENERATED_ID_PREFIX);

export interface GenInput {
  mood: string;
  energy: number;
  tempo: number;
  genre: string | null;
  language: string | null;
  durationSec: number;
  instrumental: boolean;
  promptText?: string;
  kid: boolean;
}

export type GenError = 'prompt_names_artist' | 'prompt_too_long' | 'prompt_not_allowed' | 'quota_exceeded' | 'rate_limited' | 'gen_not_configured' | 'ai_disabled' | 'gen_failed' | 'signed_out' | 'offline' | 'bad_request';

export const GEN_ERROR_TEXT: Record<GenError, string> = {
  prompt_names_artist: 'Describe a feel or a scene, without naming an artist or a song.',
  prompt_too_long: 'Keep your words under 200 characters.',
  prompt_not_allowed: 'Those words can’t be used for a song here.',
  quota_exceeded: 'That’s all the songs you can make today. Try again tomorrow.',
  rate_limited: 'One moment — too many songs at once. Try again in a minute.',
  gen_not_configured: 'Song making isn’t available right now.',
  ai_disabled: 'Song making is taking a break.',
  gen_failed: 'The song couldn’t be made this time. Try again.',
  signed_out: 'Sign in to make songs.',
  offline: 'You’re offline.',
  bad_request: 'Something was off with that request.',
};

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
const norm = (s: string): string => s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** The playing song's feel, and nothing that identifies it. */
export function generationInputFor(source: Song, opts: { durationSec?: number; instrumental?: boolean; promptText?: string; minSec?: number } = {}): GenInput {
  const kid = kidModeOn();
  const energy = Math.round(clamp(source.energy ?? energyOfSong(source), 0, 1) * 100) / 100;
  const profile = buildSongProfile(source);
  const mood = source.mood?.toLowerCase() ?? inferMood(source);
  const tempo = Math.round(clamp(source.tempo ?? 70 + energy * 80, 50, 200));
  const duration = Math.round(clamp(opts.durationSec ?? source.duration ?? 120, Math.max(MIN_SEC, opts.minSec ?? MIN_SEC), MAX_SEC));
  const text = opts.promptText?.trim();
  return {
    mood,
    energy,
    tempo,
    genre: source.genre?.trim().toLowerCase() || profile.genres[0] || null,
    language: source.language && source.language !== 'unknown' ? source.language : null,
    durationSec: duration,
    // Kid mode: instrumental only, and no free text.
    instrumental: kid || !!opts.instrumental,
    ...(text && !kid ? { promptText: text } : {}),
    kid,
  };
}

/**
 * The listener's words may describe a feel or a scene; they may not name the
 * playing song, its artists, or the artists this listener plays most. (The
 * Worker checks again, for any real artist or song.)
 */
export function promptNamesKnownWork(text: string, source: Song): boolean {
  const t = ` ${norm(text)} `;
  const names = [source.title, ...(source.artists ?? []).map((a) => a.name), ...topArtists(loadProfile(), 20).map((a) => a.affinity.name)]
    .map((n) => norm(n ?? ''))
    .filter((n) => n.length >= 3);
  return names.some((n) => t.includes(` ${n} `));
}

async function call<T>(path: string, init: RequestInit = {}): Promise<{ ok: true; body: T } | { ok: false; error: GenError }> {
  const account = currentAccount();
  if (!account) return { ok: false, error: 'signed_out' };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { ok: false, error: 'offline' };
  try {
    const res = await fetch(`${ORIGIN}/api/ai/generate-song${path}`, {
      ...init,
      headers: { accept: 'application/json', authorization: `Bearer ${account.session}`, 'x-vinax-device': installId(), ...(init.body ? { 'content-type': 'application/json' } : {}) },
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, error: (typeof body.error === 'string' && body.error in GEN_ERROR_TEXT ? body.error : 'gen_failed') as GenError };
    return { ok: true, body: body as T };
  } catch {
    return { ok: false, error: 'gen_failed' };
  }
}

export interface Availability {
  available: boolean;
  remaining: number;
  limit: number;
  reason?: string;
}

let availability: { at: number; value: Availability } | null = null;

/** Can this listener make songs now? Cached for a few minutes; "no" on any doubt, so the action stays hidden. */
export async function generationAvailability(force = false): Promise<Availability> {
  if (!force && availability && Date.now() - availability.at < STATUS_TTL_MS) return availability.value;
  const r = await call<Availability>('');
  const value: Availability = r.ok ? { available: !!r.body.available, remaining: Number(r.body.remaining) || 0, limit: Number(r.body.limit) || 0, ...(r.body.reason ? { reason: r.body.reason } : {}) } : { available: false, remaining: 0, limit: 0, reason: r.error };
  availability = { at: Date.now(), value };
  return value;
}

export interface JobStatus {
  status: 'queued' | 'running' | 'done' | 'failed';
  progress: number;
  title?: string;
  durationSec?: number;
  instrumental?: boolean;
  audioUrl?: string;
  expiresAt?: number;
}

/** The finished song as the app plays, lists and saves it. */
export function toGeneratedSong(jobId: string, s: JobStatus, inspired: Pick<GenInput, 'mood' | 'language' | 'instrumental'>): Song {
  const now = Date.now();
  return {
    kind: 'song',
    id: `${GENERATED_ID_PREFIX}${jobId}`,
    title: (s.title ?? 'New song').slice(0, 80),
    subtitle: GENERATED_SUBTITLE,
    artists: [{ ...GENERATED_ARTIST }],
    album: { id: 'vinax-ai-generated', name: 'AI generated' },
    images: [],
    audio: s.audioUrl ? [{ quality: '160kbps', url: absolute(s.audioUrl) }] : [],
    duration: s.durationSec ?? null,
    language: inspired.instrumental ? null : inspired.language,
    year: String(new Date(now).getFullYear()),
    explicit: false,
    hasLyrics: false,
    playCount: null,
    mood: inspired.mood,
    generated: { jobId, createdAt: now, expiresAt: s.expiresAt ?? now + 86_400_000, instrumental: !!s.instrumental },
  };
}

export interface GenerationJob {
  id: string;
  sourceId: string;
  status: JobStatus['status'] | 'starting';
  progress: number;
  song: Song | null;
  error: GenError | null;
}

interface GenState {
  jobs: Record<string, GenerationJob>;
  /** The newest job started from Now Playing, for its progress bar. */
  latest: string | null;
}

export const useGenerationStore = create<GenState>()(() => ({ jobs: {}, latest: null }));

const put = (job: GenerationJob, latest = false): void =>
  useGenerationStore.setState((s) => ({ jobs: { ...s.jobs, [job.id]: job }, latest: latest ? job.id : s.latest }));

/** Recently made songs, newest first, for "Generated for you" on Home. */
export const GENERATED_LIST_KEY = 'vinax.generated.v1';

export function recentGenerated(now = Date.now()): Song[] {
  try {
    const list = JSON.parse(window.localStorage.getItem(GENERATED_LIST_KEY) ?? '[]') as Song[];
    return Array.isArray(list) ? list.filter((s) => isGeneratedSong(s) && (s.generated?.expiresAt ?? 0) > now) : [];
  } catch {
    return [];
  }
}

function remember(song: Song): void {
  try {
    const list = [song, ...recentGenerated().filter((s) => s.id !== song.id)].slice(0, 30);
    window.localStorage.setItem(GENERATED_LIST_KEY, JSON.stringify(list));
  } catch {
    /* the list is a convenience */
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Make a song like `source`. Resolves with the finished song, or the reason it
 * could not be made; progress is published in `useGenerationStore` meanwhile.
 */
export async function generateLike(source: Song, opts: { durationSec?: number; instrumental?: boolean; promptText?: string; minSec?: number; fromNowPlaying?: boolean; signal?: AbortSignal } = {}): Promise<{ song: Song } | { error: GenError }> {
  if (opts.promptText && promptNamesKnownWork(opts.promptText, source)) return { error: 'prompt_names_artist' };
  const input = generationInputFor(source, opts);
  const local = `pending-${Date.now()}`;
  put({ id: local, sourceId: source.id, status: 'starting', progress: 0, song: null, error: null }, !!opts.fromNowPlaying);
  const started = await call<{ jobId: string; status: JobStatus['status']; progress: number; remaining: number }>('', { method: 'POST', body: JSON.stringify(input) });
  useGenerationStore.setState((s) => {
    const jobs = { ...s.jobs };
    delete jobs[local];
    return { jobs, latest: s.latest === local ? null : s.latest };
  });
  if (!started.ok) {
    put({ id: local, sourceId: source.id, status: 'failed', progress: 0, song: null, error: started.error }, !!opts.fromNowPlaying);
    return { error: started.error };
  }
  availability = availability ? { at: availability.at, value: { ...availability.value, remaining: started.body.remaining } } : null;
  const id = started.body.jobId;
  put({ id, sourceId: source.id, status: started.body.status, progress: started.body.progress ?? 0, song: null, error: null }, !!opts.fromNowPlaying);
  const until = Date.now() + WATCH_MAX_MS;
  for (;;) {
    if (opts.signal?.aborted) return { error: 'gen_failed' };
    const s = await call<JobStatus>(`/${encodeURIComponent(id)}`);
    if (s.ok && s.body.status === 'done' && s.body.audioUrl) {
      const song = toGeneratedSong(id, s.body, input);
      remember(song);
      put({ id, sourceId: source.id, status: 'done', progress: 1, song, error: null });
      return { song };
    }
    if ((s.ok && s.body.status === 'failed') || Date.now() > until) {
      put({ id, sourceId: source.id, status: 'failed', progress: 0, song: null, error: 'gen_failed' });
      return { error: 'gen_failed' };
    }
    if (s.ok) put({ id, sourceId: source.id, status: s.body.status, progress: s.body.progress ?? 0, song: null, error: null });
    await sleep(POLL_MS);
  }
}

/** Tests. */
export function resetSongGen(): void {
  availability = null;
  useGenerationStore.setState({ jobs: {}, latest: null });
}
