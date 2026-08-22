import type { HistoryEntry, RegionInfo, Song } from '@/types';
import type { TuneIntent } from './tune';
import type { Mood } from './mood';
import type { TasteProfile } from '@/services/personalization/profile';

export type CandidateSource =
  | 'related'
  | 'favorite-artist'
  | 'favorite-album'
  | 'trending'
  | 'rediscovery'
  | 'history';

export interface Candidate {
  song: Song;
  source: CandidateSource;
  /** For "Because you played X" grouping. */
  seedTitle?: string;
}

export type ReasonKind =
  | 'language'
  | 'artist'
  | 'popularity'
  | 'low-skip'
  | 'trending'
  | 'rediscovery'
  | 'related'
  | 'time'
  | 'mood'
  | 'region';

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
  | 'fresh';

export interface Mix {
  id: string;
  kind: MixKind;
  title: string;
  /** Short, honest explanation of why this shelf exists. */
  explanation: string;
  songs: Song[];
}

export interface RecommendationContext {
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
  /** Active 'tune this queue' intent, if the listener requested one. */
  tuneIntent?: TuneIntent | null;
  /** Inferred mood of the current session/seed, for mood continuity. */
  sessionMood?: Mood | null;
}
