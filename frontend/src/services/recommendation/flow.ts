/**
 * VinaX Flow (v5.5.0) — the deterministic recommendation core behind the
 * Next Song algorithm, the AI DJ and the AI Home shelves. Owner-approved
 * design (2026-08-31): a deterministic, catalog-grounded pipeline enforces
 * every hard rule IN CODE — the AI only re-orders an already-clean list and
 * can never invent, duplicate or language-break a pick.
 *
 * The three owner-reported failures this module kills:
 * - DUPLICATES: the catalog carries the same song under many ids ("Monica",
 *   "Monica (From \"Coolie\")", per-language uploads) — id-dedup can't see
 *   they're the same song. canonicalKey() collapses them to one identity.
 * - LANGUAGE: a seed with language:null used to unlock the queue for any
 *   language the search returned. hardFilter() locks to the seed's language
 *   (falling back to the listener's pinned language), and unknown-language
 *   strays are only admitted when the pool would otherwise starve.
 * - SAME SONGS: every surface (DJ, next-song, Home) now shares ONE served
 *   memory keyed by canonical identity, and the scorer carries a fresh
 *   crypto jitter per round so identical inputs still rank differently.
 */
import type { Song } from '@/types';

/** One shared cross-surface served-memory (DJ + next-song + Home). */
const SERVED_KEY = 'vinax.flow.served.v1';
const SERVED_CAP = 300;

/** Titles that are never songs — they poison queues when a search returns them. */
const JUNK_TITLE = /\b(dialogue|dialogues|bgm|jukebox|trailer|teaser|promo|ringtone|commentary)\b/i;

/** Version decorations that make one song look like many. */
const VERSION_TAG =
  /\s*[([{][^)\]}]*(?:from|remix|remaster|reprise|version|mix|unplugged|reloaded|revisited|slowed|reverb|lofi|lo-fi|19\d{2}|20\d{2})[^)\]}]*[)\]}]/gi;

/** Primary credited artist for a song — the identity half of the canonical key. */
export function primaryArtist(s: Song): string {
  return s.artists[0]?.name ?? s.subtitle.split(',')[0] ?? '';
}

/**
 * Canonical song identity: normalized title + primary artist. "Monica",
 * "Monica (From \"Coolie\")" and "Monica (2025 Remix)" by the same artist all
 * collapse onto one key, so one of them ever reaches a queue or shelf.
 */
export function canonicalKey(title: string, artist: string): string {
  const t = title
    .toLowerCase()
    .replace(VERSION_TAG, '')
    .replace(/\s*[-–—]\s*from\s+.+$/i, '')
    .replace(/\s*(?:feat\.?|ft\.?|featuring)\s+.+$/i, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
  const a = artist
    .toLowerCase()
    .split(',')[0]
    .replace(/[^\p{L}\p{N}]+/gu, '');
  return `${t}|${a}`;
}

/** Canonical key straight from a Song. */
export function songKey(s: Song): string {
  return canonicalKey(s.title, primaryArtist(s));
}

interface ServedEntry {
  k: string;
  t: number;
}

function loadServed(): ServedEntry[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(SERVED_KEY) || '[]') as ServedEntry[];
    return Array.isArray(raw) ? raw.filter((e) => e && typeof e.k === 'string') : [];
  } catch {
    return [];
  }
}

/** The shared served-identity set — consult it before surfacing anything. */
export function servedKeySet(): Set<string> {
  return new Set(loadServed().map((e) => e.k));
}

/** Remember served identities so no surface re-serves what another just played. */
export function recordServed(keys: string[]): void {
  if (!keys.length) return;
  try {
    const now = Date.now();
    const merged: ServedEntry[] = [...keys.map((k) => ({ k, t: now })), ...loadServed()];
    const seen = new Set<string>();
    const dedup: ServedEntry[] = [];
    for (const e of merged) {
      if (!seen.has(e.k)) {
        seen.add(e.k);
        dedup.push(e);
      }
    }
    window.localStorage.setItem(SERVED_KEY, JSON.stringify(dedup.slice(0, SERVED_CAP)));
  } catch {
    /* storage unavailable — memory-less rounds still work, just less varied */
  }
}

/** True when a title is a non-song artifact (dialogue strip, BGM cut, …). */
export function isJunkTitle(title: string): boolean {
  return JUNK_TITLE.test(title);
}

export interface HardFilterOpts {
  /** The locked language (seed's, else the listener's pinned). null = no lock. */
  language: string | null;
  /** Canonical keys that must not appear (queue, history, served memory). */
  exclude: Set<string>;
  /** Also grows as this call admits songs — pass ONE set across buckets. */
  dedup: Set<string>;
  /** Lock relaxation floor: unknown-language songs are appended only when the
   * locked pool lands below this. Off-language songs are NEVER admitted. */
  minPool?: number;
}

/**
 * The hard rules, enforced in code where a model can't argue: language lock,
 * canonical dedup, junk and sub-90s filtering. Order within a bucket is kept.
 */
export function hardFilter(songs: Song[], opts: HardFilterOpts): Song[] {
  const out: Song[] = [];
  const unknownLang: Song[] = [];
  for (const s of songs) {
    if (!s?.id || !s.title) continue;
    if (isJunkTitle(s.title)) continue;
    if (typeof s.duration === 'number' && s.duration > 0 && s.duration < 90) continue;
    const k = songKey(s);
    if (opts.exclude.has(k) || opts.dedup.has(k)) continue;
    if (opts.language) {
      if (s.language == null || s.language === 'unknown') {
        // Held back — only admitted if the locked pool starves.
        if (!unknownLang.some((u) => songKey(u) === k)) unknownLang.push(s);
        continue;
      }
      if (s.language !== opts.language) continue; // off-language: never
    }
    opts.dedup.add(k);
    out.push(s);
  }
  const floor = opts.minPool ?? 15;
  if (opts.language && out.length < floor) {
    for (const s of unknownLang) {
      if (out.length >= floor) break;
      const k = songKey(s);
      if (opts.dedup.has(k)) continue;
      opts.dedup.add(k);
      out.push(s);
    }
  }
  return out;
}

/** Crypto-seeded jitter in [-max, +max] — ties break differently every round. */
function jitter(max: number): number {
  const b = new Uint16Array(1);
  crypto.getRandomValues(b);
  return (b[0] / 65535) * 2 * max - max;
}

export interface FlowBuckets {
  /** The seed's own similar-songs neighborhood — closest vibe. */
  seed: Song[];
  /** A rotating recent-favourite's neighborhood — widens the orbit. */
  second: Song[];
  /** Seed-artist + taste-artist catalog hits. */
  artist: Song[];
  /** Fresh releases in the locked language. */
  fresh: Song[];
}

interface Scored {
  song: Song;
  key: string;
  artist: string;
  score: number;
}

/**
 * Stage 3 + 4: score every candidate (bucket weight + in-bucket rank decay +
 * per-round jitter), then greedily sequence under the diversity constraints —
 * a lead artist never twice in a row and at most twice overall. The result is
 * the deterministic queue; the AI may re-order it but never replace it.
 */
export function scoreAndSequence(buckets: FlowBuckets, limit: number): Song[] {
  const BASE: Array<[keyof FlowBuckets, number]> = [
    ['seed', 62],
    ['second', 50],
    ['artist', 45],
    ['fresh', 42],
  ];
  const pool: Scored[] = [];
  const seen = new Set<string>();
  for (const [name, base] of BASE) {
    buckets[name].forEach((song, i) => {
      const key = songKey(song);
      if (seen.has(key)) return;
      seen.add(key);
      pool.push({
        song,
        key,
        artist: primaryArtist(song).toLowerCase(),
        score: base - i * 0.45 + jitter(8),
      });
    });
  }
  pool.sort((a, b) => b.score - a.score);

  const out: Song[] = [];
  const artistCount = new Map<string, number>();
  let prevArtist = '';
  while (out.length < limit && pool.length) {
    let pickIdx = -1;
    for (let i = 0; i < pool.length; i += 1) {
      const c = pool[i];
      if (c.artist && c.artist === prevArtist) continue; // never twice in a row
      if ((artistCount.get(c.artist) ?? 0) >= 2) continue; // cap per queue
      pickIdx = i;
      break;
    }
    if (pickIdx === -1) pickIdx = 0; // constraints unsatisfiable — take best
    const [picked] = pool.splice(pickIdx, 1);
    out.push(picked.song);
    prevArtist = picked.artist;
    artistCount.set(picked.artist, (artistCount.get(picked.artist) ?? 0) + 1);
  }
  return out;
}

/** The scored top slice handed to the AI re-ranker (never more than this). */
export function rerankSlice(buckets: FlowBuckets, size: number): Song[] {
  return scoreAndSequence(buckets, size);
}
