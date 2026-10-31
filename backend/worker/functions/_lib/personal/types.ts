/**
 * The personal engine — the shapes it stores and the shapes it sends
 * (docs/personalisation.md). Rows mirror backend/supabase/schema.sql § 9b;
 * wire shapes are what the device's services/personal/api.ts validates.
 */

// ------------------------------------------------------------------ songs --

export interface ArtistRef { id: string | null; name: string }

/** A song the way the device reports it and the engine keeps it. */
export interface SongFacts {
  id: string;
  title: string;
  artist: string;
  artistId: string | null;
  artists: ArtistRef[];
  album: string | null;
  albumId: string | null;
  language: string | null;
  year: number | null;
  duration: number | null;
  image: string | null;
  facets: SongFacets;
}

export interface SongFacets {
  mood?: string;
  genre?: string;
  vibe?: string;
  energy?: number;
  tempo?: number;
}

/** personal_songs. */
export interface SongRow {
  id: string;
  title: string;
  artist: string;
  artist_id: string | null;
  artists: ArtistRef[];
  album: string | null;
  album_id: string | null;
  language: string | null;
  year: number | null;
  duration: number | null;
  image: string | null;
  key: string;
  facets: SongFacets;
  embed_model: string | null;
  embedded_at: string | null;
  plays: number;
  completes: number;
  skips: number;
  likes: number;
  first_seen: string;
  last_seen: string;
}

/** The columns a page needs (never the vector). */
export const SONG_COLUMNS = 'id,title,artist,artist_id,artists,album,album_id,language,year,duration,image,key,facets,embed_model,embedded_at,plays,completes,skips,likes,first_seen,last_seen';

/** A song on the wire: what a shelf or a playlist carries. */
export interface SongRecord extends SongFacts {
  /** Why this song, when the ranking had a reason worth showing. */
  reason?: string;
}

// ----------------------------------------------------------------- events --

export const EVENT_KINDS = ['play', 'complete', 'skip', 'like', 'unlike', 'dislike', 'save', 'queue', 'search_play', 'shown', 'radio_start'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export interface EventContext {
  hour?: number;
  dow?: number;
  tz?: string;
  shelf?: string;
  position?: number;
}

/** One event as the device sends it (songs travel beside the batch, once each). */
export interface PersonalEvent {
  id: string;
  kind: EventKind;
  at: number;
  songId: string;
  heardSec?: number;
  durationSec?: number;
  source?: string;
  context?: EventContext;
}

// ------------------------------------------------------------------ taste --

export interface Affinity {
  score: number;
  plays: number;
  completes: number;
  skips: number;
  /** ms since epoch of the last event that touched it. */
  last: number;
}
export interface ArtistAffinity extends Affinity { name: string }
export interface SongAffinity extends Affinity { likes: number }

export interface TasteFacets {
  moods: Record<string, number>;
  genres: Record<string, number>;
  decades: Record<string, number>;
  energy: { sum: number; n: number };
}

export type TasteMode = 'familiar' | 'balanced' | 'discover';

export interface TasteSummary {
  topArtists: Array<{ id: string; name: string; score: number }>;
  topLanguages: Array<{ id: string; share: number }>;
  moods: string[];
  decades: string[];
  peakHours: number[];
  totals: { plays: number; completes: number; skips: number; likes: number };
  /** A few plain lines the composer reads. */
  lines: string[];
}

/** The JSON half of personal_taste (the vector stays in the database). */
export interface Taste {
  artists: Record<string, ArtistAffinity>;
  languages: Record<string, Affinity>;
  facets: TasteFacets;
  /** 24 counts per language, plus `_all`. */
  hours: Record<string, number[]>;
  songs: Record<string, SongAffinity>;
  summary: TasteSummary;
  mode: TasteMode;
  eventsSeen: number;
  version: number;
  updatedAt: number;
}

export interface TasteRow {
  account_id: string;
  embed_model: string | null;
  artists: Record<string, ArtistAffinity>;
  languages: Record<string, Affinity>;
  facets: TasteFacets;
  hours: Record<string, number[]>;
  songs: Record<string, SongAffinity>;
  summary: TasteSummary;
  mode: TasteMode;
  events_seen: number;
  version: number;
  updated_at: string;
}

export const TASTE_COLUMNS = 'account_id,embed_model,artists,languages,facets,hours,songs,summary,mode,events_seen,version,updated_at';

// --------------------------------------------------------------- exposure --

export interface ExposureRow {
  song_id: string;
  shown: number;
  queued: number;
  played: number;
  completed: number;
  skipped: number;
  liked: boolean;
  disliked: boolean;
  last_shown: string | null;
  last_queued: string | null;
  last_played: string | null;
  last_completed: string | null;
  last_skipped: string | null;
}

// ------------------------------------------------------------- candidates --

export type CandidateSource = 'neighbours' | 'similar' | 'artist' | 'colisten' | 'trending' | 'own' | 'search';

export interface Candidate {
  id: string;
  sources: Set<CandidateSource>;
  /** Cosine similarity to the taste vector or the seed, when a vector source found it. */
  similarity?: number;
  /** Summed co-listening weight, raw. */
  colisten?: number;
  /** Position in a catalogue list (0 = first), when a catalogue source found it. */
  rank?: number;
  trendPlays?: number;
  seedId?: string;
}

export interface Reason { kind: string; weight: number }

export interface Scored {
  song: SongRow;
  candidate: Candidate;
  score: number;
  reasons: Reason[];
  /** Inside a cooling window: shown after everything that is not. */
  cooling: boolean;
}

// ------------------------------------------------------------------ pages --

export interface Shelf {
  key: string;
  title: string;
  reason: string;
  songs: SongRecord[];
}

export interface HomePage {
  generatedAt: string;
  expiresAt: string;
  greeting: string | null;
  shelves: Shelf[];
  /** The model that composed it, or null for the deterministic page. */
  model: string | null;
  tasteVersion: number;
}

export interface PlaylistPlan {
  title: string;
  languages: string[];
  moods: string[];
  artists: string[];
  eras: string[];
  energy: 'low' | 'medium' | 'high' | 'any';
  familiarity: 'known' | 'mixed' | 'new';
  queries: string[];
}

export interface PlaylistPage {
  id: string;
  title: string;
  description: string;
  songs: SongRecord[];
  plan: PlaylistPlan;
  model: string | null;
  generatedAt: string;
}
