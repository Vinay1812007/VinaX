import type { Song } from '@/types';
import { inferMood, type Mood } from '@/services/recommendation/mood';

/**
 * V2 — the session ANCHOR: what this listening session is about.
 *
 * The old continuation re-seeded every batch from the song playing at the
 * time, so each automatic pick became the seed of the next and the queue
 * walked away from where the listener started (Telugu romance → Tamil
 * dance → Hindi devotional in an hour). The anchor fixes the reference
 * point: it is set by what the LISTENER chose — the song they tapped, the
 * playlist or album they started, the radio seeds — and it only grows from
 * their own actions (a like, a hand-queued song). Automatic picks never
 * become anchors. Every stretch is planned from the anchor, so the language
 * and the mood the listener chose hold for the whole session.
 *
 * Held in memory and mirrored to sessionStorage, so a reload in the same tab
 * keeps the session's anchor and a new tab starts fresh.
 */

export interface AnchorSeed {
  song: Song;
  /** Where it came from: the listener's start, a like, a hand-queued song. */
  via: 'start' | 'like' | 'queued';
  at: number;
}

export interface Anchor {
  seeds: AnchorSeed[];
  /** Languages the session speaks (most-used first). Empty = not known. */
  languages: string[];
  /** The session's mood when the seeds agree on one; null when they do not. */
  mood: Mood | null;
  /** Bumped on every change, so a warm pool built for an older anchor is dropped. */
  version: number;
  startedAt: number;
}

const KEY = 'vinax.nextup.anchor.v1';
/** Seeds kept: the start (a sample of a long list) plus the latest likes and adds. */
export const MAX_SEEDS = 24;
/** Start seeds kept from a long list: an even sample, so a 300-song playlist is represented end to end. */
export const MAX_START_SEEDS = 16;
/** A session ends after this much silence; the next play starts a new anchor. */
export const SESSION_GAP_MS = 45 * 60_000;

let state: Anchor | null = null;
let lastTouch = 0;

const langOf = (s: Song): string | null => (s.language && s.language !== 'unknown' ? s.language.toLowerCase() : null);

/** An even sample of `n` items across a list (first and last included). */
export function evenSample<T>(list: readonly T[], n: number): T[] {
  if (list.length <= n) return [...list];
  const out: T[] = [];
  for (let i = 0; i < n; i += 1) out.push(list[Math.round((i * (list.length - 1)) / (n - 1))]);
  return out;
}

/**
 * The languages a set of seeds speaks: every language with at least a fifth
 * of the known-language seeds (so a Telugu playlist with one Hindi song stays
 * Telugu, and a half-Telugu half-Hindi one keeps both), most-used first.
 */
export function anchorLanguages(seeds: readonly Song[]): string[] {
  const counts = new Map<string, number>();
  for (const s of seeds) {
    const l = langOf(s);
    if (l) counts.set(l, (counts.get(l) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (!total) return [];
  return [...counts.entries()]
    .filter(([, n]) => n / total >= 0.2)
    .sort((a, b) => b[1] - a[1])
    .map(([l]) => l);
}

/**
 * The mood a set of seeds agrees on: the leading non-neutral mood when it
 * holds at least 45% of the seeds. A mixed list has no mood (null), and the
 * engine then only keeps devotional and non-devotional apart.
 */
export function anchorMood(seeds: readonly Song[]): Mood | null {
  if (!seeds.length) return null;
  const counts = new Map<Mood, number>();
  for (const s of seeds) {
    const m = inferMood(s);
    counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  let best: Mood | null = null;
  let bestN = 0;
  for (const [m, n] of counts) {
    if (m === 'neutral') continue;
    if (n > bestN) { best = m; bestN = n; }
  }
  return best && bestN / seeds.length >= 0.45 ? best : null;
}

function derive(seeds: AnchorSeed[], version: number, startedAt: number): Anchor {
  const songs = seeds.map((s) => s.song);
  return { seeds, languages: anchorLanguages(songs), mood: anchorMood(songs), version, startedAt };
}

function save(): void {
  try {
    if (state) window.sessionStorage.setItem(KEY, JSON.stringify({ a: state, t: lastTouch }));
    else window.sessionStorage.removeItem(KEY);
  } catch {
    /* in-memory copy still works */
  }
}

function load(): Anchor | null {
  if (state) return state;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { a?: Anchor; t?: number };
    if (!parsed?.a || !Array.isArray(parsed.a.seeds)) return null;
    const seeds = parsed.a.seeds.filter((s) => s?.song?.id);
    state = derive(seeds, Number(parsed.a.version) || 1, Number(parsed.a.startedAt) || Date.now());
    lastTouch = Number(parsed.t) || 0;
    return state;
  } catch {
    return null;
  }
}

/** Start a new session from what the listener chose: a song, a list, radio seeds. */
export function startAnchor(songs: readonly Song[], now = Date.now()): Anchor {
  const unique: Song[] = [];
  const seen = new Set<string>();
  for (const s of songs) if (s?.id && !seen.has(s.id)) { seen.add(s.id); unique.push(s); }
  const seeds = evenSample(unique, MAX_START_SEEDS).map((song) => ({ song, via: 'start' as const, at: now }));
  state = derive(seeds, (state?.version ?? 0) + 1, now);
  lastTouch = now;
  save();
  return state;
}

/**
 * The listener said "more like this" (a like, a hand-queued song): it joins
 * the anchor. The newest seeds are kept; the start seeds stay unless the
 * anchor is full of later actions.
 */
export function addAnchorSeed(song: Song, via: 'like' | 'queued', now = Date.now()): Anchor | null {
  const current = load();
  if (!current || !song?.id) return current;
  if (current.seeds.some((s) => s.song.id === song.id)) {
    lastTouch = now;
    return current;
  }
  const seeds = [...current.seeds, { song, via, at: now }];
  while (seeds.length > MAX_SEEDS) {
    // Drop the oldest non-start seed first; then the oldest start seed.
    const i = seeds.findIndex((s) => s.via !== 'start');
    seeds.splice(i >= 0 && i < seeds.length - 1 ? i : 0, 1);
  }
  state = derive(seeds, current.version + 1, current.startedAt);
  lastTouch = now;
  save();
  return state;
}

/** Drop a seed (the listener un-liked it, or skipped it). */
export function removeAnchorSeed(songId: string): void {
  const current = load();
  if (!current) return;
  const seeds = current.seeds.filter((s) => s.song.id !== songId);
  if (seeds.length === current.seeds.length || !seeds.length) return;
  state = derive(seeds, current.version + 1, current.startedAt);
  save();
}

/**
 * The anchor for a plan. A session that went quiet for longer than the gap,
 * or none at all, starts again from `fallbackSeed` (the song playing).
 * `lastActivity` is the listener's latest play start: a long playlist plays
 * for hours without a plan, and that is still one session.
 */
export function readAnchor(fallbackSeed: Song, now = Date.now(), lastActivity = 0): Anchor {
  const current = load();
  if (!current || !current.seeds.length || now - Math.max(lastTouch, lastActivity) > SESSION_GAP_MS) return startAnchor([fallbackSeed], now);
  lastTouch = now;
  return current;
}

/** Test hook. */
export function resetAnchor(): void {
  state = null;
  lastTouch = 0;
  try { window.sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}
