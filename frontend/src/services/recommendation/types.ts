import type { HistoryEntry, RegionInfo, Song } from '@/types';
import type { Mood } from './mood';
import type { FestivalMusic } from './festival';
import type { TasteProfile } from '@/services/personalization/profile';
import type { UserRecommendationProfile, SessionRecommendationProfile } from './profiles';
import type { DiscoveryMode } from '@/store/settingsStore';
import type { SessionIntent } from '@/services/personalization/sessionIntent';
import type { MusicStyle } from './style';

export type CandidateSource =
  | 'related'
  | 'favorite-artist'
  | 'favorite-album'
  | 'trending'
  | 'rediscovery'
  | 'history'
  /** Package A4 — the exploration budget: deliberately unlike your usual. */
  | 'explore'
  /** v7.1.0 — fetched FOR the listener's stated intent (a tune, a pinned mood). */
  | 'intent'
  /** 8.2.0 — other songs from the seed song's own album. */
  | 'album'
  /** 8.2.0 — popular songs by artists who work with the seed's artist (co-credited in its catalogue). */
  | 'related-artist'
  /** 8.2.0 — the seed's genre or mood, in its language. */
  | 'genre'
  /** 8.2.0 — earlier automatic picks the listener finished or liked, and songs like them (./recMemory.ts). */
  | 'proven'
  /** 8.3.0 — the listener's style (DJ remixes, folk, devotional) in the seed's language (./style.ts). */
  | 'style'
  /**
   * 9.1.0 — a CATALOGUE SONG that a public chart or an editorial pick named,
   * matched with confidence by the server (/api/trends, see
   * services/trends/signal.ts). Note the difference from `trending`, which is
   * a catalogue SEARCH for popular-sounding words and carries no outside
   * evidence at all. Before 9.1 a verified trend could only ever add a small
   * bonus to a song some other source had already returned — a chart entry the
   * catalogue searches missed could never be recommended.
   */
  | 'verified-trend';

/**
 * 7.2.0 — which source a song "belongs to" when several found it: the first
 * of these it has. The listener's stated intent wins, then the seed and taste
 * sources, then the broad ones (the order of the scorer's source boosts).
 */
export const SOURCE_PRIORITY: readonly CandidateSource[] = ['intent', 'related', 'favorite-artist', 'album', 'favorite-album', 'related-artist', 'style', 'proven', 'verified-trend', 'history', 'rediscovery', 'genre', 'explore', 'trending'];

const rank = (s: CandidateSource): number => SOURCE_PRIORITY.indexOf(s);
const titlesOf = (c: Candidate): string[] => c.seedTitles ?? (c.seedTitle ? [c.seedTitle] : []);

/**
 * 7.2.0 — one candidate per catalogue id, keeping the evidence: every source
 * that found it (`sources`, priority order), every seed title it carried and,
 * as `source`, the strongest of them. Keeps first-appearance order. Used by
 * the gatherer and again by the hard filter (for callers that merge pools).
 *
 * 8.2.0 — a copy that can stream wins over one that cannot: when the first
 * arrival had no audio and a later one does, the later song object is kept.
 * 9.0.0 — a candidate marked `unplayable` stays so until a copy that carries
 * a stream URL arrives; a copy from a response with no URLs at all does not
 * clear the mark.
 */
export function mergeCandidates(list: Candidate[]): Candidate[] {
  const out: Candidate[] = [];
  const at = new Map<string, number>();
  for (const c of list) {
    const id = c.song?.id;
    const i = id ? at.get(id) : undefined;
    if (i === undefined) {
      if (id) at.set(id, out.length);
      out.push({ ...c, sources: c.sources ?? [c.source], seedTitles: titlesOf(c) });
      continue;
    }
    const prev = out[i];
    const sources = [...new Set([...prev.sources!, ...(c.sources ?? [c.source])])].sort((a, b) => rank(a) - rank(b));
    const lead = rank(c.source) < rank(prev.source) ? c : prev;
    const streams = (x: Candidate): boolean => Array.isArray(x.song.audio) && x.song.audio.length > 0;
    const song = !streams(prev) && streams(c) ? c.song : prev.song;
    const merged: Candidate = { ...prev, song, source: sources[0], sources, seedTitles: [...new Set([...prev.seedTitles!, ...titlesOf(c)])], seedTitle: lead.seedTitle ?? prev.seedTitle };
    // 9.0.0 — a song a stream-carrying response could not stream stays
    // unplayable until a copy WITH a stream URL arrives. A copy from a response
    // that carried no URLs at all says nothing either way (that catalogue
    // resolves audio at play time); 8.x let such a copy clear the mark, so an
    // unplayable song found again by a search on another catalogue base shipped.
    const markedOnce = !!prev.unplayable || !!c.unplayable;
    if (markedOnce && !streams(prev) && !streams(c)) merged.unplayable = true;
    else delete merged.unplayable;
    out[i] = merged;
  }
  return out;
}

/** The song features a classifier can fill in (see `Candidate.classified`). */
export type SongFeature = 'mood' | 'energy' | 'tempo' | 'genre' | 'vibe' | 'dialect';

export interface Candidate {
  song: Song;
  /**
   * The primary source. When several sources found the same song it is the
   * strongest of them, in `SOURCE_PRIORITY` order (./candidates): intent,
   * related, favorite-artist, favorite-album, history, rediscovery, explore,
   * trending.
   */
  source: CandidateSource;
  /** For "Because you played X" grouping (the primary source's seed). */
  seedTitle?: string;
  /** 7.2.0 — every source that found this song, in priority order (absent = just `source`). */
  sources?: CandidateSource[];
  /** 7.2.0 — every distinct seed title those sources carried, in arrival order. */
  seedTitles?: string[];
  /**
   * 7.2.0 — features whose value came from the classifier rather than the
   * catalogue (the scorer trusts them less). Absent = every value present on
   * the song is catalogue metadata.
   */
  classified?: SongFeature[];
  /**
   * 8.2.0 — the response this song came in carried stream URLs for other
   * songs but none for this one: the catalogue cannot play it. The hard
   * filter turns it away ('no-audio') unless it is downloaded. Absent when
   * the response carried no stream URLs at all (a catalogue that resolves
   * audio at play time) and for songs from the device.
   */
  unplayable?: boolean;
}

export type ReasonKind =
  | 'language'
  | 'artist'
  | 'co-play'
  | 'popularity'
  | 'low-skip'
  | 'trending'
  | 'rediscovery'
  | 'related'
  | 'time'
  | 'mood'
  | 'session'
  | 'region'
  | 'discovery'
  | 'dialect'
  | 'genre'
  | 'vibe'
  | 'energy'
  | 'tempo'
  | 'history'
  | 'likes'
  | 'diversity'
  /** v6.4.0 */
  | 'song'
  | 'day'
  /** v7.0.0 — Familiar mode / a skip streak leaning on known ground. */
  | 'familiar'
  /** v7.0.0 — the lead artist has played a lot in the last few songs. */
  | 'fatigue'
  /** v7.0.0 — this sitting's behaviour (skips, likes, searches, queue-adds). */
  | 'intent'
  /** 7.2.0 — several candidate sources found the same song. */
  | 'agreement'
  /** 7.2.0 — a confidently matched entry of a public chart or an editorial pick (services/trends/signal.ts). */
  | 'chart'
  /** 7.2.0 — a release from this year or last. */
  | 'fresh'
  /** 7.2.0 — an active festival's languages or moods. */
  | 'festival'
  /** 7.2.0 — the listener's taste dials. */
  | 'dial'
  /** 8.2.0 — close to what the listener loves and plays (the on-device taste vector, ./vectors.ts). */
  | 'taste'
  /** 8.2.0 — recently shown on another surface, or opened the last continuation after this same song. */
  | 'served'
  /** 8.2.0 — from the seed song's own album. */
  | 'album'
  /** 8.2.0 — by an artist similar to, or credited with, the seed's artist. */
  | 'similar-artist'
  /** 8.2.0 — like (or one of) the automatic picks the listener finished or liked before. */
  | 'proven'
  /** 8.3.0 — in (or outside) the style the listener is in: DJ remixes, folk, devotional (./style.ts). */
  | 'style'
  /** 9.1.0 — the song IS a confidently matched entry of a public chart or editorial pick (the 'verified-trend' source). */
  | 'popular-now';

export interface ReasonComponent {
  kind: ReasonKind;
  weight: number;
  detail?: string;
}

export interface ScoredCandidate {
  candidate: Candidate;
  score: number;
  reasons: ReasonComponent[];
}

export type MixKind =
  | 'made-for-you'
  | 'daily'
  | 'language'
  | 'time'
  | 'rediscover'
  | 'low-skip'
  | 'because'
  | 'fresh'
  | 'explore'
  | 'weekend'
  | 'late-night'
  | 'comeback'
  | 'artist-radio'
  | 'discover-weekly';

export interface Mix {
  id: string;
  kind: MixKind;
  title: string;
  /** Short, honest explanation of why this shelf exists. */
  explanation: string;
  songs: Song[];
}

export interface RecommendationContext {
  /** v6.4.0 — 0 = Sunday; defaults to today when absent. */
  dayOfWeek?: number;
  profile: TasteProfile;
  hour: number;
  region: RegionInfo | null;
  pinnedLanguages: string[];
  /** 8.1.0 — 'mix' lets the listener's other languages into a stretch (see settingsStore.queueLanguages); absent or 'one' = the seed's language only. */
  queueLanguages?: 'one' | 'mix';
  mutedLanguages: string[];
  /** 0..1 — recommendation intensity from settings. */
  intensity: number;
  favorites: Song[];
  history: HistoryEntry[];
  /** Per-session rotation salt — varies seeds/order so recs feel fresh each time. */
  salt: number;
  /** Inferred mood of the current session/seed, for mood continuity. */
  sessionMood?: Mood | null;
  /** Roadmap O.3 — the seed song for co-play similarity: candidates by
   *  artists this listener plays IN THE SAME SITTING as the seed's artists
   *  get a boost (computed on-device from local history only). */
  coPlaySeed?: Song | null;
  /** Package A1 — mean energy (0..1) of the rolling session window. */
  sessionEnergy?: number | null;
  /** Package A1 — dominant language of the rolling session window. */
  sessionLanguage?: string | null;
  /** Package A1 — window size; the scorer weights the vector lightly until
   *  a few songs have played this session (avoids over-reacting to 1 track). */
  sessionSize?: number;
  /** Package A10 — active festival's music-boost descriptor (languages/moods to
   *  lift during its window), or null/undefined off-season. */
  festival?: FestivalMusic | null;
  /** Package A4 — explore mode (Settings, default off): adds a ~15% discovery
   *  slot of trending-in-unheard-languages picks to the taste-generic shelves. */
  explore?: boolean;
  /** Optional seed/surface metadata used by autoplay, radio and continuation. */
  seedSong?: Song | null;
  /**
   * 9.0.0 — the song the new stretch follows in the queue, when it is not the
   * seed. Its album and its artist's related artists are read too, so the
   * album and related-artist sources follow where the sitting has moved.
   */
  anchorSong?: Song | null;
  surface?: 'home' | 'next' | 'radio' | 'playlist';
  userProfile?: UserRecommendationProfile;
  sessionProfile?: SessionRecommendationProfile;
  /** v7.0.0 — Familiar / Balanced / Discover. Absent = balanced (or discover when `explore` is set). */
  discoveryMode?: DiscoveryMode;
  /** v7.1.0 — the listener's pinned mood (Now Playing → Pin a mood), when one is active. */
  moodPin?: Mood | null;
  /** v7.1.0 — a catalogue query that gathers candidates for an active tune / pinned mood. */
  intentQuery?: string | null;
  /** v7.0.0 — short-term intent of this sitting; never written to the profile. */
  sessionIntent?: SessionIntent;
  /**
   * 7.2.0 — verified charts as one bounded signal: catalogue id → a small,
   * capped score bonus, and the source label for "Why this song?". Absent
   * when no chart is configured, matched or fresh; never a candidate source
   * of its own, and never able to overrule a rule.
   */
  trendBonus?: ReadonlyMap<string, number>;
  trendLabel?: ReadonlyMap<string, string>;
  /**
   * 9.1.0 — the verified chart / editorial entries themselves, so they can
   * ENTER the candidate pool (the 'verified-trend' source) rather than only
   * earn a bonus. Each is already matched to a catalogue id by the server.
   */
  trendItems?: readonly { catalogId: string; title: string; artist: string; language: string | null; sourceLabel: string; sourceRank: number }[];
  /**
   * 8.2.0 — a learned song embedding the device already holds (synchronous,
   * never fetches), for the taste term's optional refinement. Absent = the
   * on-device taste vector alone.
   */
  embeddingOf?: (songId: string) => Float32Array | null;
  /** 8.2.0 — canonical keys other surfaces showed recently (songIdentity's served memory): a small penalty, never a rule. */
  servedKeys?: ReadonlySet<string>;
  /**
   * 9.1.0 — what this listener's own exposure ledger (./exposure.ts) says a
   * candidate's recent history should cost it, in score units: shown on
   * another surface, queued, played, completed or skipped, each decaying at
   * its own rate, with favourites and explicit replays forgiven. It REPLACES
   * the flat `servedKeys` penalty where it is set (both are read, so a caller
   * that sets only `servedKeys` scores as it did in 9.0).
   *
   * Still a penalty, never a rule: a song that is clearly the best fit wins
   * anyway, and nothing here can admit a song the hard filter rejects.
   */
  exposurePenaltyOf?: (key: string) => number;
  /** 9.1.0 — canonical keys that opened the last accepted continuation after this same seed (./recMemory.ts): held back a little. */
  seedRepeatKeys?: ReadonlySet<string>;
  /** 8.2.0 — ids that opened the last accepted continuation after this same seed. Superseded by `seedRepeatKeys`. */
  seedRepeatIds?: ReadonlySet<string>;
  /**
   * 8.3.0 — the style the listener is in (DJ remixes, folk songs, devotional
   * songs), set by the next-song engine from the seed, the last plays and the
   * tune (./style.ts `sessionStyle`). It adds a style candidate source and a
   * same-style boost / off-style cost to the score (weights.ts STYLE_WEIGHTS).
   * Absent = no style: every surface that does not set it scores as before.
   */
  style?: MusicStyle | null;
  /**
   * 8.3.1 — the language the style source searches in, when it is not the
   * seed's: the language "Switch language" moves the queue to, or null when
   * there is none to switch to (the source is then skipped). Absent = the
   * seed's language.
   */
  styleLanguage?: string | null;
}

/** v7.0.0 — why a candidate never reached the ranked pool (developer score breakdowns). 'soft-muted' (7.2.0): an artist under an active "show fewer like this". */
export type RejectReason = 'seed' | 'recently-played' | 'already-queued' | 'duplicate-version' | 'muted-language' | 'soft-muted' | 'language-lock' | 'off-language' | 'blocked' | 'explicit' | 'junk' | 'too-short' | 'skipped-this-session' | 'low-score' | 'artist-cap' | 'discovery-share' | 'invalid' | 'no-audio' | 'snoozed';

/**
 * 7.2.0 — a soft rule the sequencer or the validator had to give up on
 * because the pool could not fill the stretch otherwise. Hard rules (the
 * `RejectReason`s the hard filter returns) are never relaxed.
 */
export type RelaxedRule = 'language-lock' | 'language-mix' | 'artist-cap' | 'discovery-share' | 'familiar-opening' | 'recent-version' | 'artist-spacing' | 'style' | 'sitting-avoid';

/** 7.2.0 — one relaxation, with what gave and why (the developer breakdown shows these). */
export interface Relaxation {
  rule: RelaxedRule;
  /** 1-based slot where it happened, when it is about one slot. */
  slot?: number;
  songId?: string;
  detail: string;
}

export interface RejectedCandidate {
  song: Song;
  reason: RejectReason;
  stage: 'filter' | 'rank' | 'validate';
}
