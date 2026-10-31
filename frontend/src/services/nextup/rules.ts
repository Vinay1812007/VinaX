import type { Song } from '@/types';
import type { Mood } from '@/services/recommendation/mood';

/**
 * V2 — the pure rules of the Up Next engine: what may be picked, how a
 * candidate scores, and how a stretch is put in order. No stores, no network:
 * everything the rules need is passed in, so each one is tested on its own.
 */

/** Where a candidate came from. A song several sources agree on scores higher. */
export type Source =
  /** The catalogue's "similar songs" for a song the listener chose this session. */
  | 'anchor'
  /** Similar songs for one of the listener's liked songs. */
  | 'liked-similar'
  /** Top songs of an artist the listener has liked. */
  | 'liked-artist'
  /** One of the listener's liked songs itself. */
  | 'liked'
  /** A song the listener plays again and again (history). */
  | 'favourite-play'
  /** A "Tune this queue" search. */
  | 'tune'
  /** V2 1.4 — the personal engine's ranked list around the anchor (signed in, the setting on). */
  | 'personal';

export const SOURCE_BASE: Readonly<Record<Source, number>> = Object.freeze({
  anchor: 1,
  'liked-similar': 1.05,
  'liked-artist': 0.9,
  liked: 0.85,
  'favourite-play': 0.6,
  tune: 1.1,
  personal: 1.08,
});

export interface Candidate {
  song: Song;
  sources: Set<Source>;
  /** The title or artist that brought it in, for the "why this song" line. */
  via?: string;
  /** When it joined the warm pool. */
  at: number;
  /** The catalogue answered with streams for its neighbours but none for it: it cannot play. */
  unplayable?: boolean;
}

/** The lead artist, normalised the same way the session intent keys it. */
export function leadOf(song: Pick<Song, 'artists' | 'subtitle'>): string {
  return (song.artists?.[0]?.name ?? song.subtitle?.split(',')[0] ?? '').trim().toLowerCase();
}

export function languageOf(song: Pick<Song, 'language'>): string | null {
  return song.language && song.language !== 'unknown' ? song.language.toLowerCase() : null;
}

/** A stable 0..1 number per song and session, so the order varies between sessions but not between calls. */
export function jitter(id: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10_000) / 10_000;
}

/**
 * How well a candidate's mood fits the session's. Devotional music is kept
 * apart both ways: a devotional session stays devotional, and a film-song
 * session never drifts into bhajans — the drift listeners noticed most.
 */
export function moodFit(candidate: Mood, anchor: Mood | null): number {
  if (anchor === 'devotional') return candidate === 'devotional' ? 0.35 : -0.9;
  if (candidate === 'devotional') return anchor ? -0.9 : -0.5;
  if (!anchor || candidate === 'neutral') return 0;
  if (candidate === anchor) return 0.3;
  const calm = (m: Mood): boolean => m === 'chill' || m === 'melancholy';
  if ((anchor === 'energetic' && calm(candidate)) || (calm(anchor) && candidate === 'energetic')) return -0.45;
  return -0.1;
}

export interface ScoreContext {
  languages: readonly string[];
  mood: Mood | null;
  /** The session's median release year, when known. */
  year: number | null;
  /** lead artist → how many of the listener's liked songs are theirs. */
  likedLeads: ReadonlyMap<string, number>;
  likedIds: ReadonlySet<string>;
  /** This sitting's pull per lead artist (−1..1): likes and adds pull, skips push. */
  pull: Readonly<Record<string, number>>;
  /** Lead artists of the listener's long-term taste. */
  tasteLeads: ReadonlySet<string>;
  moodOf(song: Song): Mood;
  /** Shared exposure cost (0..~1) for a song shown, queued or played lately. */
  exposure(song: Song): number;
  /** A "Tune this queue" nudge. */
  tune?: (song: Song) => number;
  salt: number;
}

export const WEIGHTS = Object.freeze({
  agreement: 0.3,
  likedArtist: 0.55,
  likedSong: 0.25,
  pull: 0.6,
  taste: 0.15,
  unknownLanguage: -0.15,
  eraFree: 8,
  eraPerYear: 0.03,
  eraMax: 0.3,
  exposure: 0.7,
  jitter: 0.12,
});

export function scoreCandidate(c: Candidate, x: ScoreContext): number {
  const song = c.song;
  const lead = leadOf(song);
  let base = 0;
  for (const s of c.sources) base = Math.max(base, SOURCE_BASE[s]);
  let score = base + WEIGHTS.agreement * Math.min(2, c.sources.size - 1);
  const liked = x.likedLeads.get(lead) ?? 0;
  if (liked) score += WEIGHTS.likedArtist * Math.min(1, (liked + 1) / 4);
  if (x.likedIds.has(song.id)) score += WEIGHTS.likedSong;
  score += WEIGHTS.pull * Math.max(-1, Math.min(1, x.pull[lead] ?? 0));
  if (x.tasteLeads.has(lead)) score += WEIGHTS.taste;
  score += moodFit(x.moodOf(song), x.mood);
  if (!languageOf(song)) score += WEIGHTS.unknownLanguage;
  const year = Number(song.year);
  if (x.year && Number.isFinite(year) && year > 1900) score -= Math.min(WEIGHTS.eraMax, Math.max(0, Math.abs(year - x.year) - WEIGHTS.eraFree) * WEIGHTS.eraPerYear);
  score -= WEIGHTS.exposure * Math.max(0, x.exposure(song));
  if (x.tune) score += x.tune(song);
  score += WEIGHTS.jitter * jitter(song.id, x.salt);
  return score;
}

/** Why a candidate may not be picked at all; null when it may. */
export type RejectReason =
  | 'no-audio'
  | 'queued'
  | 'played-recently'
  | 'served-recently'
  | 'skipped'
  | 'artist-skipped'
  | 'blocked'
  | 'explicit'
  | 'muted-language'
  | 'other-language'
  | 'soft-muted';

export interface FilterContext {
  /** Languages the stretch may use; empty = any. */
  languages: ReadonlySet<string>;
  mutedLanguages: ReadonlySet<string>;
  queuedIds: ReadonlySet<string>;
  queuedKeys: ReadonlySet<string>;
  keyOf(song: Song): string;
  /** key → when it last started playing (history). */
  playedAt: ReadonlyMap<string, number>;
  /** key → when the engine last queued it automatically. */
  servedAt: ReadonlyMap<string, number>;
  likedIds: ReadonlySet<string>;
  skippedIds: ReadonlySet<string>;
  /** Lead artists this sitting pushed away (a skip of their song). */
  avoidLeads: ReadonlySet<string>;
  blocked(song: Song): boolean;
  softMuted(song: Song): boolean;
  hideExplicit: boolean;
  now: number;
  /** Cooldowns, relaxed only when nothing else is left. */
  playedCooldownMs: number;
  likedCooldownMs: number;
  servedCooldownMs: number;
}

/** No song comes back automatically within three days of playing... */
export const PLAYED_COOLDOWN_MS = 72 * 3_600_000;
/** ...except a liked one, which may return after 18 hours. */
export const LIKED_COOLDOWN_MS = 18 * 3_600_000;
/** A song queued automatically and never reached is held back for a day. */
export const SERVED_COOLDOWN_MS = 24 * 3_600_000;

export function rejectReason(song: Song, f: FilterContext): RejectReason | null {
  if (!song?.id) return 'no-audio';
  const key = f.keyOf(song);
  if (f.queuedIds.has(song.id) || f.queuedKeys.has(key)) return 'queued';
  if (f.skippedIds.has(song.id)) return 'skipped';
  if (f.blocked(song)) return 'blocked';
  if (f.hideExplicit && song.explicit) return 'explicit';
  const lang = languageOf(song);
  if (lang && f.mutedLanguages.has(lang)) return 'muted-language';
  if (lang && f.languages.size && !f.languages.has(lang)) return 'other-language';
  if (f.avoidLeads.has(leadOf(song))) return 'artist-skipped';
  if (f.softMuted(song)) return 'soft-muted';
  const played = f.playedAt.get(key);
  const cooldown = f.likedIds.has(song.id) ? f.likedCooldownMs : f.playedCooldownMs;
  if (played != null && f.now - played < cooldown) return 'played-recently';
  const served = f.servedAt.get(key);
  if (served != null && f.now - served < f.servedCooldownMs && !f.likedIds.has(song.id)) return 'served-recently';
  return null;
}

export interface Spacing {
  /** The same lead artist never comes back within this many songs. */
  gap: number;
  /** ...and appears at most this many times in any ten in a row. */
  maxPerTen: number;
}

export const SPACING: Spacing = Object.freeze({ gap: 4, maxPerTen: 2 });
/** Looser steps, tried in order when the pool cannot fill a stretch at the full rule. */
export const SPACING_STEPS: readonly Spacing[] = Object.freeze([SPACING, { gap: 3, maxPerTen: 3 }, { gap: 1, maxPerTen: 10 }, { gap: 0, maxPerTen: 10 }]);

/**
 * Put a stretch in order: best score first, under the spacing rule, across
 * the songs before it (`before`: history and the queue up to the append
 * point, oldest first). No artist within `gap` songs of itself, at most
 * `maxPerTen` per ten, not the same album twice in a row, never the same
 * work twice. When the full rule cannot fill the stretch it loosens step by
 * step (the last step — any order, albums included — only when nothing else
 * is left), and says so in `relaxed`.
 */
export function pickSequence(ranked: readonly Song[], before: readonly Song[], n: number, keyOf: (s: Song) => string): { songs: Song[]; relaxed: string[] } {
  const out: Song[] = [];
  const relaxed: string[] = [];
  const used = new Set<string>();
  const usedKeys = new Set<string>();
  const context = before.slice(-12);
  for (let slot = 0; slot < n; slot += 1) {
    let chosen: Song | null = null;
    for (let step = 0; step < SPACING_STEPS.length && !chosen; step += 1) {
      const rule = SPACING_STEPS[step];
      const seq = [...context, ...out];
      const recentLeads = rule.gap > 0 ? seq.slice(-rule.gap).map(leadOf) : [];
      const lastTen = seq.slice(-9).map(leadOf);
      const prevAlbum = seq[seq.length - 1]?.album?.id ?? null;
      for (const song of ranked) {
        if (used.has(song.id) || usedKeys.has(keyOf(song))) continue;
        const lead = leadOf(song);
        if (lead && recentLeads.includes(lead)) continue;
        if (lead && lastTen.filter((l) => l === lead).length >= rule.maxPerTen) continue;
        if (prevAlbum && song.album?.id === prevAlbum && step < SPACING_STEPS.length - 1) continue;
        chosen = song;
        if (step > 0 && !relaxed.includes(`spacing-${step}`)) relaxed.push(`spacing-${step}`);
        break;
      }
    }
    if (!chosen) break;
    out.push(chosen);
    used.add(chosen.id);
    usedKeys.add(keyOf(chosen));
  }
  return { songs: out, relaxed };
}

/** The median of the known release years in a list. */
export function medianYear(songs: readonly Song[]): number | null {
  const years = songs.map((s) => Number(s.year)).filter((y) => Number.isFinite(y) && y > 1900).sort((a, b) => a - b);
  if (!years.length) return null;
  return years[Math.floor(years.length / 2)];
}
