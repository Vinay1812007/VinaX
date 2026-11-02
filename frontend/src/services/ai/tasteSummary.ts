import type { HistoryEntry, Song } from '@/types';
import type { RecommendationContext } from '@/services/recommendation/types';
import { topArtists, topLanguages } from '@/services/personalization/profile';
import { energyOfSong } from '@/services/personalization/session';
import { inferMood } from '@/services/recommendation/mood';
import { isSkippedPlay } from '@/utils/plays';
import type { TuneIntent } from '@/services/recommendation/tune';

/**
 * The COMPACT summaries the music AI routes receive (docs/data-and-privacy.md
 * lists every field). They are built here, on the device, from the taste
 * profile and the last plays, and nothing else about the listener leaves:
 * never the history, the heard-set, a song title or a catalogue id.
 */
export interface TasteSummary {
  /** The most-played languages, at most four. */
  languages: string[];
  /** The most-played lead artists, at most eight names. */
  artists: string[];
  /** The commonest moods of the last plays, at most four. */
  moods: string[];
  /** Mean energy 0..1 of plays at night (0–5), morning (6–11), afternoon (12–17), evening (18–23); null with no plays then. */
  energyByHour: Array<number | null>;
  discovery: 'familiar' | 'balanced' | 'discover';
  /** Skips in a row in this sitting. */
  skipStreak: number;
  hour: number;
  weekday: number;
}

/** This sitting's intent, in a few numbers and words. */
export interface SittingIntent {
  mood: string | null;
  tune: string | null;
  language: string | null;
  energySteer: number;
  completionStreak: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The plays a summary reads: the last 120 the listener let run. */
const heardPlays = (history: readonly HistoryEntry[]): HistoryEntry[] => history.filter((e) => e?.song && !isSkippedPlay(e)).slice(0, 120);

export function buildTasteSummary(ctx: RecommendationContext, now = new Date()): TasteSummary {
  const plays = heardPlays(ctx.history ?? []);
  const moods = new Map<string, number>();
  const energy: Array<{ sum: number; n: number }> = [0, 1, 2, 3].map(() => ({ sum: 0, n: 0 }));
  for (const e of plays) {
    const m = inferMood(e.song);
    if (m && m !== 'neutral') moods.set(m, (moods.get(m) ?? 0) + 1);
    const slot = Math.min(3, Math.floor(new Date(e.ts).getHours() / 6));
    energy[slot].sum += energyOfSong(e.song);
    energy[slot].n += 1;
  }
  const languages = [...new Set([...topLanguages(ctx.profile, 4).map((l) => l.id), ...ctx.pinnedLanguages])].filter((l) => l && l !== 'unknown' && !ctx.mutedLanguages.includes(l)).slice(0, 4);
  return {
    languages,
    artists: topArtists(ctx.profile, 8).map((a) => a.affinity.name).filter(Boolean).slice(0, 8),
    moods: [...moods.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([m]) => m),
    energyByHour: energy.map((b) => (b.n ? round2(b.sum / b.n) : null)),
    discovery: ctx.discoveryMode ?? (ctx.explore ? 'discover' : 'balanced'),
    skipStreak: ctx.sessionIntent?.skipStreak ?? 0,
    hour: ctx.hour ?? now.getHours(),
    weekday: ctx.dayOfWeek ?? now.getDay(),
  };
}

export function buildSittingIntent(ctx: RecommendationContext, opts: { tune?: TuneIntent | null; language?: string | null } = {}): SittingIntent {
  return {
    mood: ctx.moodPin ?? ctx.sessionMood ?? null,
    tune: opts.tune ?? null,
    language: opts.language ?? ctx.sessionLanguage ?? null,
    energySteer: round2(ctx.sessionIntent?.energySteer ?? 0),
    completionStreak: ctx.sessionIntent?.completionStreak ?? 0,
  };
}

/** What the rerank sends about one candidate: no title, no id, no album. */
export interface CandidateFeatures {
  key: string;
  language: string | null;
  mood: string | null;
  energy: number | null;
  genre: string | null;
  leadArtist: string | null;
}

export function candidateFeatures(song: Song, key: string): CandidateFeatures {
  const mood = inferMood(song);
  return {
    key,
    language: song.language && song.language !== 'unknown' ? song.language : null,
    mood: mood && mood !== 'neutral' ? mood : null,
    energy: round2(energyOfSong(song)),
    genre: song.genre?.trim().toLowerCase() || null,
    leadArtist: song.artists?.[0]?.name ?? null,
  };
}
