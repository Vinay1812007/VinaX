/**
 * Disco lights — beat reading, kept pure (no Web Audio, no DOM) so it can be
 * tested with made-up spectra.
 *
 * The page reads the playing song's spectrum from the sound chain's analyser
 * about sixty times a second and hands each frame here. A beat is a jump in
 * the bass (kick and bass guitar, about 40-160 Hz) well above its own
 * average over the last second, rising from the frame before, and at least
 * MIN_GAP_MS after the previous beat. The tempo is the median gap between
 * recent beats, folded into a danceable range.
 */

/** Bass band the beat is read from (Hz). */
export const BASS_HZ: readonly [number, number] = [40, 160];
/** Upper band for the sparkle (hi-hats, cymbals). */
export const TREBLE_HZ: readonly [number, number] = [4000, 12000];
/** No two beats closer than this (about 214 beats a minute). */
export const MIN_GAP_MS = 280;
/** How far back the running average looks. */
export const WINDOW_MS = 1000;
/** Below this bass level (0-1) nothing counts as a beat: a quiet passage is not a drum. */
export const FLOOR = 0.12;
/** Beats kept for the tempo. */
const TEMPO_BEATS = 16;
/** Folded tempo range: 70-180 a minute. */
const BPM_MIN = 70;
const BPM_MAX = 180;

/** Average of the bins between `lo` and `hi` Hz, as 0-1. */
export function bandLevel(spectrum: ArrayLike<number>, binHz: number, lo: number, hi: number): number {
  if (!(binHz > 0) || spectrum.length === 0) return 0;
  // Bin i is centred on i * binHz: take the bins whose centres fall in the band.
  const from = Math.max(0, Math.round(lo / binHz));
  const to = Math.min(spectrum.length - 1, Math.max(from, Math.round(hi / binHz)));
  if (to < from) return 0;
  let sum = 0;
  for (let i = from; i <= to; i += 1) sum += spectrum[i];
  return sum / ((to - from + 1) * 255);
}

/**
 * How far above its average the bass must jump to count, from the
 * listener's sensitivity (0 = only the hardest hits, 1 = nearly every
 * bump). 1.6x at 0, 1.15x at 1.
 */
export function thresholdFor(sensitivity: number): number {
  const s = Math.max(0, Math.min(1, Number.isFinite(sensitivity) ? sensitivity : 0.5));
  return 1.6 - 0.45 * s;
}

/** Median of a list (0 for an empty one). */
export function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** A tempo doubled or halved into BPM_MIN-BPM_MAX (a half-time feel reads as the dance tempo). */
export function foldBpm(bpm: number): number {
  if (!(bpm > 0) || !Number.isFinite(bpm)) return 0;
  let b = bpm;
  while (b < BPM_MIN) b *= 2;
  while (b > BPM_MAX) b /= 2;
  return Math.round(b);
}

/** Tempo from beat times (ms): the median gap, folded. null until there are four sensible gaps. */
export function bpmFromBeats(times: readonly number[]): number | null {
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i += 1) {
    const gap = times[i] - times[i - 1];
    // A gap over 1.5 s is a break in the music, not a beat apart.
    if (gap >= MIN_GAP_MS && gap <= 1500) gaps.push(gap);
  }
  if (gaps.length < 4) return null;
  return foldBpm(60_000 / median(gaps));
}

export interface BeatFrame {
  /** A beat landed on this frame. */
  beat: boolean;
  /** How hard (1 = right at the threshold, more is harder), 0 when no beat. */
  strength: number;
  /** Bass level 0-1, relative to the loudest bass heard lately (drives the glow). */
  level: number;
  /** High-end level 0-1 (drives the sparkle). */
  sparkle: number;
  /** Tempo in beats a minute, once there is enough to tell. */
  bpm: number | null;
}

/** Reads beats from successive spectrum frames. One per disco session; `reset` on a new song. */
export class BeatDetector {
  private history: Array<{ t: number; e: number }> = [];
  private prev = 0;
  private lastBeat = -Infinity;
  private beats: number[] = [];
  private peak = 0.2;
  private lastT = -Infinity;
  sensitivity = 0.5;

  reset(): void {
    this.history = [];
    this.prev = 0;
    this.lastBeat = -Infinity;
    this.beats = [];
    this.peak = 0.2;
    this.lastT = -Infinity;
  }

  /** The tempo so far, or null. */
  get bpm(): number | null {
    return bpmFromBeats(this.beats);
  }

  /** One frame of spectrum at time `t` (ms). */
  push(spectrum: ArrayLike<number>, binHz: number, t: number): BeatFrame {
    const e = bandLevel(spectrum, binHz, BASS_HZ[0], BASS_HZ[1]);
    const sparkle = bandLevel(spectrum, binHz, TREBLE_HZ[0], TREBLE_HZ[1]);
    return this.pushLevels(e, sparkle, t);
  }

  /** Same as `push`, from band levels already worked out (0-1). */
  pushLevels(e: number, sparkle: number, t: number): BeatFrame {
    // A long gap (paused, hidden tab) makes the old average meaningless.
    if (t - this.lastT > 500) {
      this.history = [];
      this.prev = e;
    }
    this.lastT = t;

    while (this.history.length && t - this.history[0].t > WINDOW_MS) this.history.shift();
    let sum = 0;
    for (const h of this.history) sum += h.e;
    const avg = this.history.length ? sum / this.history.length : e;
    const warm = this.history.length >= 10;
    this.history.push({ t, e });

    // The loudest bass lately, falling slowly so a quiet song still glows.
    this.peak = Math.max(e, this.peak * 0.997, 0.05);
    const level = Math.max(0, Math.min(1, e / this.peak));

    const threshold = thresholdFor(this.sensitivity);
    const rising = e > this.prev;
    this.prev = e;
    let beat = false;
    let strength = 0;
    if (warm && rising && e >= FLOOR && e > avg * threshold && t - this.lastBeat >= MIN_GAP_MS) {
      beat = true;
      strength = avg > 0 ? e / (avg * threshold) : 1;
      this.lastBeat = t;
      this.beats.push(t);
      if (this.beats.length > TEMPO_BEATS) this.beats.shift();
    }
    return { beat, strength, level, sparkle: Math.max(0, Math.min(1, sparkle * 2.5)), bpm: this.bpm };
  }
}

/**
 * Tap tempo for when the music cannot be heard (iPhone Safari, casting, a
 * source that will not share its sound): the listener taps along. Taps more
 * than two seconds apart start over. Returns the tempo once there are three
 * taps, else null.
 */
export function tapTempo(taps: readonly number[]): number | null {
  const recent: number[] = [];
  for (let i = taps.length - 1; i >= 0; i -= 1) {
    if (recent.length && recent[0] - taps[i] > 2000) break;
    recent.unshift(taps[i]);
    if (recent.length === 8) break;
  }
  if (recent.length < 3) return null;
  const gaps: number[] = [];
  for (let i = 1; i < recent.length; i += 1) gaps.push(recent[i] - recent[i - 1]);
  const gap = median(gaps);
  if (gap < 200) return null;
  return Math.max(40, Math.min(240, Math.round(60_000 / gap)));
}
