import { useSyncExternalStore } from 'react';
import type { Song } from '@/types';
import { EPISODE_PROGRESS_KEY } from './episode';

/**
 * Where you are in each podcast episode, and which ones you finished.
 *
 * The player saves every song's place in its own resume map (80 places,
 * vinax.resume.v1) and seeks there when the song starts again. Episodes stay
 * in that map, but music listening used to push them out of it; this list
 * (its own key) keeps the episodes, so the player never drops their places
 * (episode.resumeEvictee), and adds what the map cannot hold: the episode
 * itself for "Continue your shows", and a "played" mark once 95% is heard.
 *
 * Written by the player every 5 seconds of an episode (playerStore.saveResume
 * loads this module on demand); read by the podcast pages. Local to the
 * device, like the resume map.
 */

export interface EpisodeProgress {
  /** The episode as it played, so a row can start it again without a lookup. */
  song: Song;
  /** Seconds in. */
  sec: number;
  /** Length in seconds (the audio's own). */
  dur: number;
  /** Last listened (ms). */
  at: number;
  /** Heard to the end (95%, or the last seconds of a short one). */
  played: boolean;
}

export type EpisodeProgressMap = Record<string, EpisodeProgress>;

/** Episodes remembered; the oldest listened go first. */
export const MAX_EPISODES = 50;
/** Below this many seconds in, an episode has not really been started (the resume map's own floor). */
export const STARTED_SEC = 20;
/** The player's resume map: a finished episode's place is cleared from it, so it starts at the top next time. */
const RESUME_KEY = 'vinax.resume.v1';
const CHANGED = 'vinax:podcast-progress';

/** The second an episode counts as played: 95% in, or 6 seconds from the end for a short one. */
export function playedAt(dur: number): number {
  return Math.max(0, Math.min(dur * 0.95, dur - 6));
}

function valid(e: unknown): e is EpisodeProgress {
  const x = e as EpisodeProgress | null;
  return !!x && typeof x === 'object' && typeof x.song?.id === 'string' && Array.isArray(x.song.audio)
    && Number.isFinite(x.sec) && Number.isFinite(x.dur) && Number.isFinite(x.at);
}

function parse(raw: string | null): EpisodeProgressMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: EpisodeProgressMap = {};
    if (!parsed || typeof parsed !== 'object') return out;
    for (const [id, e] of Object.entries(parsed)) if (valid(e)) out[id] = { ...e, played: e.played === true };
    return out;
  } catch {
    return {};
  }
}

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(EPISODE_PROGRESS_KEY);
  } catch {
    return null;
  }
}

export function readEpisodeProgress(): EpisodeProgressMap {
  return parse(readRaw());
}

function write(map: EpisodeProgressMap): void {
  try {
    window.localStorage.setItem(EPISODE_PROGRESS_KEY, JSON.stringify(map));
  } catch {
    /* storage full or blocked: the resume map still has the place */
  }
  window.dispatchEvent(new Event(CHANGED));
}

/** Forget a finished episode's place in the player's resume map. */
function clearResume(id: string): void {
  try {
    const map = JSON.parse(window.localStorage.getItem(RESUME_KEY) || '{}') as Record<string, number>;
    if (!(id in map)) return;
    delete map[id];
    window.localStorage.setItem(RESUME_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

/**
 * The player heard an episode up to `sec` of `duration`. Past 95% it is
 * played (once marked, it stays so until it is replayed past its opening).
 */
export function noteEpisodeProgress(song: Song, sec: number, duration: number, now = Date.now()): void {
  if (!song?.id || !Number.isFinite(sec) || !Number.isFinite(duration) || duration <= 0) return;
  const map = readEpisodeProgress();
  const prev = map[song.id];
  const done = sec >= playedAt(duration);
  const played = done || (!!prev?.played && sec <= STARTED_SEC);
  // Its own key is re-added last, so the list stays in listening order.
  delete map[song.id];
  map[song.id] = { song, sec: Math.floor(sec), dur: Math.round(duration), at: now, played };
  const ids = Object.keys(map);
  if (ids.length > MAX_EPISODES) {
    for (const id of ids.sort((a, b) => map[a].at - map[b].at).slice(0, ids.length - MAX_EPISODES)) delete map[id];
  }
  write(map);
  // The player saved this place a moment ago; a finished episode starts from the top next time.
  if (done) clearResume(song.id);
}

/** Episodes started and not finished, most recent first: the "Continue your shows" row. */
export function continueListening(map: EpisodeProgressMap, limit = 12): EpisodeProgress[] {
  return Object.values(map)
    .filter((e) => !e.played && e.sec > STARTED_SEC && e.dur > 0)
    .sort((a, b) => b.at - a.at)
    .slice(0, limit);
}

/** How far in, 0–1 (1 for a played episode). */
export function progressFraction(e: Pick<EpisodeProgress, 'sec' | 'dur' | 'played'>): number {
  if (e.played) return 1;
  return e.dur > 0 ? Math.min(1, Math.max(0, e.sec / e.dur)) : 0;
}

/** "12 min left", "40 sec left", "1 hr 5 min left". */
export function timeLeft(e: Pick<EpisodeProgress, 'sec' | 'dur'>): string {
  const left = Math.max(0, e.dur - e.sec);
  if (left < 60) return `${Math.max(1, Math.round(left))} sec left`;
  const mins = Math.round(left / 60);
  if (mins < 60) return `${mins} min left`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} hr ${m} min left` : `${h} hr left`;
}

// ---- React: re-render when the player writes (this tab) or another tab does.

let cachedRaw: string | null | undefined;
let cachedMap: EpisodeProgressMap = {};

function snapshot(): EpisodeProgressMap {
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedMap = parse(raw);
  }
  return cachedMap;
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent): void => {
    if (e.key === null || e.key === EPISODE_PROGRESS_KEY) onChange();
  };
  window.addEventListener(CHANGED, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener('storage', onStorage);
  };
}

/** Every remembered episode, kept current. */
export function useEpisodeProgress(): EpisodeProgressMap {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
