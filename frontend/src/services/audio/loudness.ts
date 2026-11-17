/**
 * Loudness levelling maths and the per-song cache (lazy: only the effects
 * chain imports this). Settings > Sound > Loudness normalisation plays every
 * song at about the same level, the way streaming services level whole
 * tracks, instead of squashing the dynamics inside each one.
 *
 * Measuring: the chain taps the song through a two-filter K-weighting
 * approximation (a +4 dB shelf above ~1.5 kHz, then a high-pass at ~38 Hz)
 * into its own analyser and reads the mean square of ~0.34 s blocks while
 * the song plays. The blocks are gated like BS.1770 integrated loudness
 * (absolute −70, then relative −10 LU), which gives a LUFS-like number.
 *
 * The analyser hears one channel, the average of left and right. For a
 * typical mix that is ~3 dB below the two-channel sum BS.1770 adds up, so
 * that much is added back; it is an approximation, good to a dB or two.
 */
import { localWritesFrozen } from '@/services/storage/local';

/** Level every song is moved towards (about what Spotify and YouTube Music use). */
export const TARGET_LUFS = -14;
/** Largest boost or cut the levelling applies. */
export const MAX_LEVEL_DB = 9;
/** Blocks below this are silence (intros, gaps) and do not count. */
const ABSOLUTE_GATE_LUFS = -70;
/** Blocks this far below the loudness of the rest do not count either. */
const RELATIVE_GATE_LU = 10;
/** One channel heard (the analyser's L/R average) vs the BS.1770 two-channel sum. */
const MONO_TO_STEREO_DB = 3.01;

/** LUFS-like loudness of one block's K-weighted mean square (−Infinity for silence). */
export function blockLoudness(meanSquare: number): number {
  if (!(meanSquare > 0)) return -Infinity;
  return -0.691 + 10 * Math.log10(meanSquare) + MONO_TO_STEREO_DB;
}

function loudnessOfMean(blocks: readonly number[]): number {
  let sum = 0;
  for (const b of blocks) sum += b;
  return blockLoudness(sum / blocks.length);
}

/**
 * Gated integrated loudness of K-weighted block mean squares, or null when
 * nothing above the silence gate was heard.
 */
export function integratedLoudness(meanSquares: readonly number[]): number | null {
  const loud = meanSquares.filter((m) => blockLoudness(m) > ABSOLUTE_GATE_LUFS);
  if (loud.length === 0) return null;
  const relative = loudnessOfMean(loud) - RELATIVE_GATE_LU;
  const kept = loud.filter((m) => blockLoudness(m) > relative);
  return loudnessOfMean(kept.length > 0 ? kept : loud);
}

/** Gain in dB that moves a song of `lufs` to the target, never past ±MAX_LEVEL_DB. */
export function levelGainDb(lufs: number | null): number {
  if (lufs == null || !Number.isFinite(lufs)) return 0;
  return Math.max(-MAX_LEVEL_DB, Math.min(MAX_LEVEL_DB, TARGET_LUFS - lufs));
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

// ── Per-song cache ────────────────────────────────────────────────────────
// Measured loudness by song id, newest last, so a replay is levelled from its
// first note. Only this device's browser keeps it; losing it just means the
// next play measures again.

export const LOUDNESS_KEY = 'vinax.loudness.v1';
export const LOUDNESS_CACHE_MAX = 500;
/** A new song starts from the typical level of songs already measured once this many are known. */
const PRIOR_MIN_SONGS = 5;

type Entry = [id: string, lufs: number];

let memory: Entry[] | null = null;

function load(): Entry[] {
  if (memory) return memory;
  let list: Entry[] = [];
  try {
    const raw = window.localStorage.getItem(LOUDNESS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      list = parsed.filter(
        (e): e is Entry => Array.isArray(e) && typeof e[0] === 'string' && typeof e[1] === 'number' && Number.isFinite(e[1]),
      );
    }
  } catch {
    /* storage blocked or corrupt: start empty */
  }
  memory = list.slice(-LOUDNESS_CACHE_MAX);
  return memory;
}

function save(list: Entry[]): void {
  // A restore or Clear all data is reloading the page: write nothing over it.
  if (localWritesFrozen()) return;
  try {
    window.localStorage.setItem(LOUDNESS_KEY, JSON.stringify(list));
  } catch {
    /* storage full or blocked: the in-memory copy still serves this session */
  }
}

/** The stored loudness of a song, or null when it has not been measured here. A hit becomes the newest entry. */
export function cachedLoudness(id: string): number | null {
  const list = load();
  const at = list.findIndex((e) => e[0] === id);
  if (at < 0) return null;
  const hit = list[at];
  if (at !== list.length - 1) {
    list.splice(at, 1);
    list.push(hit);
    save(list);
  }
  return hit[1];
}

/** Remember a song's loudness; the oldest song drops out past LOUDNESS_CACHE_MAX. */
export function storeLoudness(id: string, lufs: number): void {
  if (!id || !Number.isFinite(lufs)) return;
  const list = load().filter((e) => e[0] !== id);
  list.push([id, Math.round(lufs * 10) / 10]);
  if (list.length > LOUDNESS_CACHE_MAX) list.splice(0, list.length - LOUDNESS_CACHE_MAX);
  memory = list;
  save(list);
}

/**
 * Where a song heard for the first time starts while it is measured: the
 * median of the songs already measured (most releases are mastered alike),
 * or null (0 dB) until enough are known.
 */
export function priorLoudness(): number | null {
  const values = load().map((e) => e[1]);
  if (values.length < PRIOR_MIN_SONGS) return null;
  values.sort((a, b) => a - b);
  const mid = values.length >> 1;
  return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

/** Tests only: forget the in-memory copy so the next read goes to storage. */
export function resetLoudnessMemory(): void {
  memory = null;
}
