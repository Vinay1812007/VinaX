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
import { inferMood, moodMatchScore, type Mood } from './mood';

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
 * Flow v2 (v5.6.0) — vibe affinity. The v1 scorer knew bucket + rank only;
 * "matching" lives in these signals: songs from the seed's own film, songs
 * sharing a credited artist (that's how the composer connects film music),
 * the listener's favourite artists, era proximity, and fatigue for artists
 * the queue has served a lot lately.
 */
export interface FlowAffinity {
  seedAlbum?: string | null;
  seedArtists?: string[];
  seedYear?: number | null;
  favArtists?: string[];
  /** normalized-artist -> how many recent served entries (fatigue). */
  artistFatigue?: Map<string, number>;
  /** Flow v3 (v5.7.1) — the vibe layer. The target mood is the pinned mood
   * when the listener set one, else the seed's inferred mood; candidates that
   * match it rise, clashing vibes sink. hourMood is a soft time-of-day pull
   * (late night → chill) applied only when nothing stronger is present. */
  seedMood?: Mood | null;
  pinnedMood?: Mood | null;
  hourMood?: Mood | null;
}

/** Soft time-of-day vibe: late night leans chill, weekend evening leans up. */
export function hourMoodNow(now = new Date()): Mood | null {
  const h = now.getHours();
  const d = now.getDay();
  if (h >= 22 || h < 5) return 'chill';
  if (h >= 18 && h <= 21 && (d === 5 || d === 6 || d === 0)) return 'energetic';
  return null;
}

function normName(x: string): string {
  return x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * Stage 3 + 4: score every candidate (bucket weight + in-bucket rank decay +
 * per-round jitter), then greedily sequence under the diversity constraints —
 * a lead artist never twice in a row and at most twice overall. The result is
 * the deterministic queue; the AI may re-order it but never replace it.
 */
export function scoreAndSequence(buckets: FlowBuckets, limit: number, affinity?: FlowAffinity): Song[] {
  const BASE: Array<[keyof FlowBuckets, number]> = [
    ['seed', 62],
    ['second', 50],
    ['artist', 45],
    ['fresh', 42],
  ];
  const seedAlbum = affinity?.seedAlbum ? affinity.seedAlbum.toLowerCase() : '';
  const seedArtists = new Set((affinity?.seedArtists ?? []).map(normName));
  const favArtists = new Set((affinity?.favArtists ?? []).map(normName));
  const seedYear = affinity?.seedYear ?? null;
  // Flow v3 — the vibe target: an explicit pin beats the seed's inferred
  // mood; a neutral seed leaves only the soft hour pull.
  const pinned = affinity?.pinnedMood ?? null;
  const seedMood = affinity?.seedMood && affinity.seedMood !== 'neutral' ? affinity.seedMood : null;
  const targetMood: Mood | null = pinned ?? seedMood;
  const hourMood = affinity?.hourMood ?? null;
  const thisYear = new Date().getFullYear();
  const pool: Scored[] = [];
  const seen = new Set<string>();
  for (const [name, base] of BASE) {
    buckets[name].forEach((song, i) => {
      const key = songKey(song);
      if (seen.has(key)) return;
      seen.add(key);
      // Flow v2 affinity bonus.
      let bonus = 0;
      // Flow v3 — vibe match: same mood +12, neutral 0, clash −6. The pin
      // weighs double the inferred seed mood; the hour vibe is a half-weight
      // nudge that only acts when no stronger target exists.
      const m = inferMood(song);
      if (targetMood) {
        const w = pinned ? 24 : 18;
        bonus += (moodMatchScore(targetMood, m) - 0.4) * w;
      } else if (hourMood) {
        bonus += (moodMatchScore(hourMood, m) - 0.4) * 8;
      }
      // Flow v3 — the trend bucket rewards what is genuinely NEW and HOT:
      // this year's releases and big play counts rise; last year still helps.
      if (name === 'fresh') {
        const y = song.year != null ? Number(song.year) : NaN;
        if (Number.isFinite(y)) {
          if (y >= thisYear) bonus += 6;
          else if (y === thisYear - 1) bonus += 3;
        }
        if (typeof song.playCount === 'number' && song.playCount > 0) {
          bonus += Math.min(4, Math.log10(song.playCount + 1));
        }
      }
      const names = song.artists.map((a) => normName(a.name));
      if (seedAlbum && song.album?.name && song.album.name.toLowerCase() === seedAlbum) bonus += 10;
      if (seedArtists.size && names.some((n) => n && seedArtists.has(n))) bonus += 7;
      if (favArtists.size && names.some((n) => n && favArtists.has(n))) bonus += 4;
      if (seedYear != null) {
        const y = song.year != null ? Number(song.year) : NaN;
        if (Number.isFinite(y)) bonus -= Math.min(8, Math.abs(y - seedYear) * 0.35);
      }
      const lead = normName(primaryArtist(song));
      const fatigue = affinity?.artistFatigue?.get(lead) ?? 0;
      bonus -= Math.min(9, fatigue * 3);
      pool.push({
        song,
        key,
        artist: primaryArtist(song).toLowerCase(),
        score: base - i * 0.45 + jitter(8) + bonus,
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
export function rerankSlice(buckets: FlowBuckets, size: number, affinity?: FlowAffinity): Song[] {
  return scoreAndSequence(buckets, size, affinity);
}
