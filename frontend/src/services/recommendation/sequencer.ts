import type { Song } from '@/types';
import { inferMood, moodMatchScore, type Mood } from './mood';
import { energyOfSong } from '@/services/personalization/session';
import { transitionScore } from './transitions';

/**
 * v6.3.0 — the arc sequencer. Given a pool of admitted songs, orders them
 * into a listening ARC from real, per-song signals instead of trusting a
 * prompt to "build gently and peak at two thirds":
 *
 *   energy   — song.energy from the AI classifier when present, else the
 *              mood-derived estimate the session tracker already uses, with
 *              a small tempo nudge; the arc shape gives every slot a target.
 *   mood     — keeps emotional continuity (sad stays sad, party stays party).
 *   spacing  — no lead artist twice in a row, and not again within three
 *              slots; the same album not back to back.
 *   era      — decade jumps cost a little, so a 90s cut lands next to a 90s
 *              cut, not between two 2024 releases.
 *   language — the queue's language lock is a hard rule.
 *   memory   — hand-offs the listener completed before are preferred, ones
 *              they skipped are avoided (./transitions.ts).
 *   rank     — the caller's ranking (taste) is a prior, not the whole story.
 *
 * Greedy, deterministic and fast (pool ≤ 60), so it can run on every queue
 * extension and inside the Queue Builder preview. The optional duration
 * budget stops the arc once the target minutes are covered.
 */
export type ArcShape = 'steady' | 'build' | 'wind-down' | 'wave' | 'lift';

export interface SequenceOptions {
  seed?: Song | null;
  shape?: ArcShape;
  /** Stop once the sum of durations reaches this (seconds); 0 = no budget. */
  durationSec?: number;
  limit?: number;
  /** Target language; null = none. */
  language?: string | null;
  /** 'lock' (default) drops other languages; 'prefer' keeps them but charges a cost, so a
   *  few can drift in when the arc and the listener's other languages justify it. */
  languagePolicy?: 'lock' | 'prefer';
  /** Other languages the listener plays (only matters under 'prefer'). */
  otherLanguages?: string[];
  /** 0..1 — share of slots that may go to `discovery` candidates. */
  discovery?: number;
  /** Ids the caller considers "sure" picks (favourites, most played) — used by the lift shape. */
  sureIds?: Set<string>;
  /** Ids the caller flags as discovery / unfamiliar. */
  discoveryIds?: Set<string>;
  /** Songs that played just before this stretch (for spacing and memory). */
  recent?: Song[];
}

export interface SequencedSong {
  song: Song;
  /** 0..1 target energy for the slot. */
  target: number;
  /** 0..1 estimated energy of the song. */
  energy: number;
  mood: Mood;
  /** Short, honest "why here" line. */
  why: string;
}

export interface SequenceResult {
  songs: SequencedSong[];
  totalSec: number;
  /** Mean absolute distance between song energy and slot target (0 = perfect arc). */
  arcError: number;
}

const decadeOf = (s: Song): number | null => {
  const y = Number.parseInt(s.year ?? '', 10);
  return Number.isFinite(y) ? Math.floor(y / 10) : null;
};
const leadArtist = (s: Song): string => (s.artists[0]?.name ?? s.subtitle.split(',')[0] ?? '').trim().toLowerCase();
const albumOf = (s: Song): string => (s.album?.name ?? '').trim().toLowerCase();

/** 0..1 energy estimate: classifier value when present, mood estimate otherwise, nudged by tempo. */
export function songEnergy(s: Song): number {
  let e = typeof s.energy === 'number' && s.energy >= 0 && s.energy <= 1 ? s.energy : energyOfSong(s);
  if (typeof s.tempo === 'number' && s.tempo >= 40 && s.tempo <= 220) e = e * 0.8 + ((s.tempo - 60) / 120) * 0.2;
  return Math.max(0, Math.min(1, e));
}

/** The arc: a target energy for slot i of n, anchored on the seed's energy. */
export function arcTarget(shape: ArcShape, i: number, n: number, start: number): number {
  const t = n <= 1 ? 0 : i / (n - 1);
  const clamp = (v: number) => Math.max(0.08, Math.min(0.95, v));
  switch (shape) {
    case 'build':
      return clamp(start + (0.9 - start) * t);
    case 'wind-down':
      return clamp(start - (start - 0.15) * t);
    case 'wave':
      return clamp(start + 0.3 * Math.sin(t * Math.PI * 2));
    case 'lift':
      // A restless listener: come up a notch quickly, then hold.
      return clamp(Math.min(start + 0.25, 0.85) + 0.05 * Math.sin(t * Math.PI));
    default:
      // Steady: settle, one gentle peak around two thirds, ease off.
      return clamp(start + 0.18 * Math.sin(t * Math.PI) * (t < 0.66 ? 1 : 0.6) - 0.05 * t);
  }
}

interface Scored {
  song: Song;
  energy: number;
  mood: Mood;
  rank: number;
}

export function sequenceSongs(pool: Song[], opts: SequenceOptions = {}): SequenceResult {
  const shape = opts.shape ?? 'steady';
  const limit = Math.max(0, Math.min(60, Math.floor(opts.limit ?? pool.length)));
  const budget = opts.durationSec && opts.durationSec > 0 ? opts.durationSec : 0;
  const discoveryShare = Math.max(0, Math.min(1, opts.discovery ?? 0.2));
  const seed = opts.seed ?? null;
  const seen = new Set<string>();
  const items: Scored[] = [];
  pool.forEach((song, rank) => {
    if (!song?.id || seen.has(song.id)) return;
    if (seed && song.id === seed.id) return;
    if (opts.language && song.language && song.language !== opts.language && (opts.languagePolicy ?? 'lock') === 'lock') return;
    seen.add(song.id);
    items.push({ song, energy: songEnergy(song), mood: inferMood(song), rank });
  });
  if (!items.length || !limit) return { songs: [], totalSec: 0, arcError: 0 };

  const startEnergy = seed ? songEnergy(seed) : items.reduce((s, it) => s + it.energy, 0) / items.length;
  const startMood: Mood = seed ? inferMood(seed) : 'neutral';
  const n = Math.min(limit, items.length);
  const out: SequencedSong[] = [];
  const recentSongs: Song[] = [...(opts.recent ?? []).slice(-3), ...(seed ? [seed] : [])];
  let totalSec = 0;
  let errSum = 0;
  let discoveryUsed = 0;
  const remaining = [...items];

  while (remaining.length && out.length < n) {
    const i = out.length;
    const target = arcTarget(shape, i, n, startEnergy);
    const prev = out.length ? out[out.length - 1].song : seed;
    const prevMood = out.length ? out[out.length - 1].mood : startMood;
    const last3 = [...recentSongs.slice(-3), ...out.slice(-3).map((o) => o.song)].slice(-3);
    const lastArtists = last3.map(leadArtist);
    const lastAlbum = prev ? albumOf(prev) : '';
    const prevLead = prev ? leadArtist(prev) : '';
    const prevEnergy = out.length ? out[out.length - 1].energy : seed ? startEnergy : null;
    const prevDecade = prev ? decadeOf(prev) : null;
    const discoveryAllowed = discoveryUsed < Math.floor(discoveryShare * n + 0.5);
    let bestIdx = -1;
    let bestCost = Infinity;
    let bestWhy = '';
    for (let k = 0; k < remaining.length; k += 1) {
      const c = remaining[k];
      const isDiscovery = !!opts.discoveryIds?.has(c.song.id);
      if (isDiscovery && !discoveryAllowed && remaining.some((r) => !opts.discoveryIds?.has(r.song.id))) continue;
      const why: string[] = [];
      let cost = Math.abs(c.energy - target) * 3;
      const moodFit = moodMatchScore(prevMood, c.mood);
      cost += (1 - moodFit) * 1.2;
      if (moodFit === 1 && c.mood !== 'neutral') why.push(`keeps the ${c.mood} mood`);
      const artist = leadArtist(c.song);
      if (artist && lastArtists[lastArtists.length - 1] === artist) cost += 4; // never back to back
      else if (artist && lastArtists.includes(artist)) cost += 1.5;
      // v7.0.0 — a featured credit counts too: the previous lead singing second
      // on this one is still the same voice twice in a row (softer than a lead repeat).
      else if (prevLead && c.song.artists.slice(1).some((a) => a.name.trim().toLowerCase() === prevLead)) cost += 1;
      if (lastAlbum && albumOf(c.song) === lastAlbum) cost += 1;
      // v7.0.0 — transition smoothness: the arc target moves gently, but a
      // single hand-off may still lurch (a lullaby straight into a dance cut).
      // Steps beyond a third of the scale pay for the excess.
      if (prevEnergy !== null) cost += Math.max(0, Math.abs(c.energy - prevEnergy) - 0.35) * 2.5;
      const dec = decadeOf(c.song);
      if (prevDecade !== null && dec !== null) cost += Math.min(3, Math.abs(dec - prevDecade)) * 0.25;
      cost += (c.rank / Math.max(items.length, 1)) * 1.0; // taste prior
      // Language drift ('prefer' policy): an off-target song pays a cost —
      // small for a language the listener also plays, large otherwise — and
      // never lands right after another off-target song, so the queue can
      // wander for a song and come back rather than switch languages.
      if (opts.language && c.song.language && c.song.language !== opts.language) {
        const familiar = opts.otherLanguages?.includes(c.song.language);
        const prevOff = !!(prev?.language && prev.language !== opts.language);
        cost += (familiar ? 1.1 : 2.5) + (prevOff ? 3 : 0);
        why.push(`a ${c.song.language} detour`);
      }
      if (shape === 'lift' && opts.sureIds?.has(c.song.id)) {
        cost -= 1.2;
        why.push('a sure favourite');
      }
      const memory = prev ? transitionScore(prev, c.song) : 0;
      cost -= memory * 1.5;
      if (memory > 0.2) why.push('a hand-off you finished before');
      if (memory < -0.2) why.push('you skipped this after a song like the last one');
      if (isDiscovery) why.push('a discovery slot');
      if (cost < bestCost) {
        bestCost = cost;
        bestIdx = k;
        const dir = c.energy > target + 0.12 ? 'lifts the energy' : c.energy < target - 0.12 ? 'eases the energy' : 'holds the energy';
        bestWhy = [dir, ...why].join(' · ');
      }
    }
    if (bestIdx < 0) break;
    const [pick] = remaining.splice(bestIdx, 1);
    if (opts.discoveryIds?.has(pick.song.id)) discoveryUsed += 1;
    const dur = typeof pick.song.duration === 'number' && pick.song.duration > 0 ? pick.song.duration : 210;
    if (budget && totalSec > 0 && totalSec + dur > budget * 1.1) break;
    totalSec += dur;
    errSum += Math.abs(pick.energy - target);
    out.push({ song: pick.song, target, energy: pick.energy, mood: pick.mood, why: bestWhy });
    if (budget && totalSec >= budget) break;
  }
  return { songs: out, totalSec, arcError: out.length ? errSum / out.length : 0 };
}

/** Mean |energy − target| for a FIXED order (how far it strays from the arc). */
export function arcErrorOf(order: Song[], seed: Song | null, shape: ArcShape): number {
  if (!order.length) return 0;
  const n = order.length;
  const start = seed ? songEnergy(seed) : order.reduce((s, x) => s + songEnergy(x), 0) / n;
  let sum = 0;
  order.forEach((song, i) => {
    sum += Math.abs(songEnergy(song) - arcTarget(shape, i, n, start));
  });
  return sum / n;
}
