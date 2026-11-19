import type { Song } from '@/types';
import type { Mood } from '@/services/recommendation/mood';
import { MOOD_ENERGY } from '@/services/personalization/session';

/** 1.19 — the listener's Discovery setting, as the scorer reads it. */
export type DiscoveryLean = 'familiar' | 'balanced' | 'discover';
/** Sources that bring NEW music (as against the listener's own likes and plays). */
const NEW_MUSIC_SOURCES: ReadonlySet<Source> = new Set<Source>(['related-artist', 'genre', 'explore', 'anchor']);
const OWN_MUSIC_SOURCES: ReadonlySet<Source> = new Set<Source>(['liked', 'favourite-play', 'liked-artist', 'liked-similar']);

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
  /** 1.4 — Never repeat, widened: top songs of artists related to an anchor song's artist. */
  | 'related-artist'
  /** 1.4 — Never repeat, widened: deeper pages of a search for the anchor's genre or mood. */
  | 'genre'
  /** 1.4 — Never repeat, widened twice: popular songs in the session's own languages, past the first pages. */
  | 'explore';

export const SOURCE_BASE: Readonly<Record<Source, number>> = Object.freeze({
  anchor: 1,
  'liked-similar': 1.05,
  'liked-artist': 0.9,
  liked: 0.85,
  'favourite-play': 0.6,
  tune: 1.1,
  'related-artist': 0.8,
  genre: 0.7,
  explore: 0.55,
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
  /**
   * 1.12 — this listener's pattern for the moment of day (services/
   * personalization/moments): the languages and lead artists they usually
   * play now, and how much to trust it. Absent when the pattern is thin or
   * the listener switched the awareness off.
   */
  moment?: { languages: ReadonlySet<string>; artists: ReadonlySet<string>; confidence: number };
  /**
   * 1.19 — Discovery (Settings › Recommendations): `familiar` leans on the
   * listener's own likes and plays, `discover` on music they have not heard,
   * `balanced` (the default) does neither.
   */
  discovery?: DiscoveryLean;
  /** 1.19 — this year: a song from this year or last is fresh (a small lift, larger on `discover`). */
  year_now?: number;
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
  /** 1.12 — a song by an artist, or in a language, the listener plays at this time of day. */
  moment: 0.3,
  /** 1.19 — a song from this year or last. */
  fresh: 0.08,
  /** 1.19 — how far the Discovery setting moves a source's standing. */
  lean: 0.2,
  /** 1.19 — how much a jump in energy between one song and the next costs when a stretch is put in order. */
  flow: 0.35,
});

/** 1.19 — a song's place on the calm-to-energetic axis (0..1), from its mood. */
export function energyOf(mood: Mood): number {
  return MOOD_ENERGY[mood] ?? 0.5;
}

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
  if (x.moment?.confidence) {
    const l = languageOf(song);
    const fit = x.moment.artists.has(lead) ? 1 : l && x.moment.languages.has(l) ? 0.4 : 0;
    score += WEIGHTS.moment * x.moment.confidence * fit;
  }
  // 1.19 — Discovery: lean toward the listener's own music, or away from it.
  if (x.discovery && x.discovery !== 'balanced') {
    const own = [...c.sources].some((s) => OWN_MUSIC_SOURCES.has(s));
    const fresh = [...c.sources].some((s) => NEW_MUSIC_SOURCES.has(s)) && !x.likedIds.has(song.id) && !liked;
    if (x.discovery === 'familiar') score += own ? WEIGHTS.lean : fresh ? -WEIGHTS.lean : 0;
    else score += fresh ? WEIGHTS.lean : own ? -WEIGHTS.lean * 0.5 : 0;
  }
  // 1.19 — a new release gets a small lift (a larger one when the listener wants new music).
  if (x.year_now && Number.isFinite(year) && year >= x.year_now - 1) score += WEIGHTS.fresh * (x.discovery === 'discover' ? 2 : 1);
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
  | 'soft-muted'
  | 'heard-before';

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
  /**
   * 1.4 — Never repeat: has the listener ever heard this canonical song? A
   * heard song is never picked automatically, and no loosening step touches
   * this rule. Absent = the mode is off.
   */
  heard?: (key: string) => boolean;
  now: number;
  /** Cooldowns, relaxed only when nothing else is left. */
  playedCooldownMs: number;
  likedCooldownMs: number;
  servedCooldownMs: number;
}

/** No song comes back automatically within three days of playing... */
export const PLAYED_COOLDOWN_MS = 72 * 3_600_000;
/** ...except a liked one, which may return after two days (1.14.4: was 18 hours, and favourites came back every day). */
export const LIKED_COOLDOWN_MS = 48 * 3_600_000;
/** A song queued automatically and never reached is held back for a day. */
export const SERVED_COOLDOWN_MS = 24 * 3_600_000;

export function rejectReason(song: Song, f: FilterContext): RejectReason | null {
  if (!song?.id) return 'no-audio';
  const key = f.keyOf(song);
  if (f.queuedIds.has(song.id) || f.queuedKeys.has(key)) return 'queued';
  if (f.heard?.(key)) return 'heard-before';
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
/**
 * 1.19 — flow: with `scoreOf` and `energyOf`, each slot weighs the best few
 * allowed candidates (`look`) and takes the one whose energy sits closest to
 * the song before it, so a stretch rises and falls instead of lurching from a
 * ballad to a dance number and back. Without them the best score wins.
 */
export interface SequenceFlow {
  scoreOf: (s: Song) => number;
  energyOf: (s: Song) => number;
  /** How many of the best allowed candidates a slot weighs. */
  look?: number;
  /** The cost of a full 0→1 energy jump, in score. */
  flow?: number;
}

export function pickSequence(ranked: readonly Song[], before: readonly Song[], n: number, keyOf: (s: Song) => string, flow?: SequenceFlow): { songs: Song[]; relaxed: string[] } {
  const out: Song[] = [];
  const relaxed: string[] = [];
  const used = new Set<string>();
  const usedKeys = new Set<string>();
  const context = before.slice(-12);
  const look = Math.max(1, flow?.look ?? 8);
  const cost = flow?.flow ?? WEIGHTS.flow;
  for (let slot = 0; slot < n; slot += 1) {
    let chosen: Song | null = null;
    for (let step = 0; step < SPACING_STEPS.length && !chosen; step += 1) {
      const rule = SPACING_STEPS[step];
      const seq = [...context, ...out];
      const recentLeads = rule.gap > 0 ? seq.slice(-rule.gap).map(leadOf) : [];
      const lastTen = seq.slice(-9).map(leadOf);
      const prevAlbum = seq[seq.length - 1]?.album?.id ?? null;
      const prev = seq[seq.length - 1];
      const prevEnergy = flow && prev ? flow.energyOf(prev) : null;
      let best: { song: Song; value: number } | null = null;
      let seen = 0;
      for (const song of ranked) {
        if (used.has(song.id) || usedKeys.has(keyOf(song))) continue;
        const lead = leadOf(song);
        if (lead && recentLeads.includes(lead)) continue;
        if (lead && lastTen.filter((l) => l === lead).length >= rule.maxPerTen) continue;
        if (prevAlbum && song.album?.id === prevAlbum && step < SPACING_STEPS.length - 1) continue;
        if (!flow) {
          best = { song, value: 0 };
          break;
        }
        const value = flow.scoreOf(song) - (prevEnergy === null ? 0 : cost * Math.abs(flow.energyOf(song) - prevEnergy));
        if (!best || value > best.value) best = { song, value };
        seen += 1;
        if (seen >= look) break;
      }
      if (best) {
        chosen = best.song;
        if (step > 0 && !relaxed.includes(`spacing-${step}`)) relaxed.push(`spacing-${step}`);
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
