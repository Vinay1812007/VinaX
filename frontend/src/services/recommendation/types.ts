import type { HistoryEntry, RegionInfo, Song } from '@/types';
import type { Mood } from './mood';
import type { FestivalMusic } from './festival';
import type { TasteProfile } from '@/services/personalization/profile';
import type { UserRecommendationProfile, SessionRecommendationProfile } from './profiles';
import type { DiscoveryMode } from '@/store/settingsStore';
import type { SessionIntent } from '@/services/personalization/sessionIntent';

export type CandidateSource =
  | 'related'
  | 'favorite-artist'
  | 'favorite-album'
  | 'trending'
  | 'rediscovery'
  | 'history'
  /** Package A4 — the exploration budget: deliberately unlike your usual. */
  | 'explore';

export interface Candidate {
  song: Song;
  source: CandidateSource;
  /** For "Because you played X" grouping. */
  seedTitle?: string;
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
  | 'intent';

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
  surface?: 'home' | 'next' | 'radio' | 'playlist';
  userProfile?: UserRecommendationProfile;
  sessionProfile?: SessionRecommendationProfile;
  /** v7.0.0 — Familiar / Balanced / Discover. Absent = balanced (or discover when `explore` is set). */
  discoveryMode?: DiscoveryMode;
  /** v7.0.0 — short-term intent of this sitting; never written to the profile. */
  sessionIntent?: SessionIntent;
}

/** v7.0.0 — why a candidate never reached the ranked pool (developer score breakdowns). */
export type RejectReason = 'seed' | 'recently-played' | 'already-queued' | 'duplicate-version' | 'muted-language' | 'language-lock' | 'blocked' | 'explicit' | 'junk' | 'too-short' | 'skipped-this-session' | 'low-score' | 'artist-cap' | 'invalid';

export interface RejectedCandidate {
  song: Song;
  reason: RejectReason;
  stage: 'filter' | 'rank' | 'validate';
}
