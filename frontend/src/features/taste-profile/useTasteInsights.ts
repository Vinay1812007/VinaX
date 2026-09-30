import { useQuery } from '@tanstack/react-query';
import { loadProfile, profileStamp } from '@/services/personalization/storage';
import { profileConfidence, topArtists, topLanguages } from '@/services/personalization/profile';
import { getRecentEvents } from '@/services/storage/idb';
import { languageLabel } from '@/constants/languages';
import { useHistoryStore } from '@/store/historyStore';
import { useLibraryStore } from '@/store/libraryStore';
import { resolveDiscoveryMode, useSettingsStore, type DiscoveryMode } from '@/store/settingsStore';
import { inferMood, type Mood } from '@/services/recommendation/mood';
import { buildUserRecommendationProfile } from '@/services/recommendation/profiles';
import type { TasteProfile } from '@/services/personalization/profile';
import type { StoredEvent } from '@/services/storage/idb';

export interface TasteInsights {
  topLanguages: Array<{ id: string; label: string; score: number; plays: number }>;
  topArtists: Array<{ name: string; score: number; plays: number }>;
  mostReplayed: Array<{ songId: string; title: string; count: number }>;
  hourHistogram: number[];
  totals: TasteProfile['totals'];
  completionRate: number | null;
  /** 8.5.0 — skips per counted play (null before any play). */
  skipRate: number | null;
  /** 8.5.0 — share of the last 30 days' plays by artists the profile has barely heard (null with too few plays to say). */
  newToYouShare: number | null;
  /** 8.5.0 — the Discover setting and the Adventurous dial, as the engine reads them. */
  exploration: { mode: DiscoveryMode; adventurous: number };
  /** 8.5.0 — moods of what you play and keep, most frequent first (neutral left out). */
  topMoods: Array<{ mood: Mood; share: number }>;
  /** 8.5.0 — genres and vibes the catalogue or titles name, strongest first. */
  topGenres: string[];
  confidence: number;
  listeningMinutes: number;
  recentTrend: Array<{ day: string; plays: number }>;
}

const NEW_ARTIST_MAX_PLAYS = 3;
const NEW_WINDOW_MS = 30 * 86_400_000;
const MIN_PLAYS_FOR_SHARE = 10;

/**
 * 8.5.0 — how much of the last 30 days was new to the listener: plays whose
 * lead artist has at most three counted plays in the whole profile. The
 * event log is capped, so "first heard" cannot be read from it; the profile's
 * per-artist play count can. Null below ten plays — too few to be a habit.
 */
export function newToYouShare(profile: TasteProfile, events: Pick<StoredEvent, 'type' | 'ts' | 'artistNames'>[], now = Date.now()): number | null {
  const playsByName = new Map<string, number>();
  for (const a of Object.values(profile.artists)) {
    const key = a.name.trim().toLowerCase();
    playsByName.set(key, (playsByName.get(key) ?? 0) + a.plays);
  }
  let total = 0;
  let fresh = 0;
  for (const e of events) {
    if (e.type !== 'play' || now - e.ts > NEW_WINDOW_MS) continue;
    const lead = e.artistNames?.[0]?.trim().toLowerCase();
    if (!lead) continue;
    total += 1;
    if ((playsByName.get(lead) ?? 0) <= NEW_ARTIST_MAX_PLAYS) fresh += 1;
  }
  return total >= MIN_PLAYS_FOR_SHARE ? fresh / total : null;
}

/** 8.5.0 — mood shares over the songs you keep and play; 'neutral' says nothing and is left out. */
export function topMoods(songs: Parameters<typeof inferMood>[0][], limit = 4): Array<{ mood: Mood; share: number }> {
  const counts = new Map<Mood, number>();
  let n = 0;
  for (const song of songs) {
    const mood = inferMood(song);
    if (mood === 'neutral') continue;
    counts.set(mood, (counts.get(mood) ?? 0) + 1);
    n += 1;
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([mood, c]) => ({ mood, share: c / n }));
}

function topGenres(profile: TasteProfile, favorites: Parameters<typeof buildUserRecommendationProfile>[1], history: Parameters<typeof buildUserRecommendationProfile>[2], limit = 6): string[] {
  const user = buildUserRecommendationProfile(profile, favorites, history);
  const merged = new Map<string, number>();
  for (const [k, v] of [...Object.entries(user.genres), ...Object.entries(user.vibes)]) merged.set(k, (merged.get(k) ?? 0) + v);
  return [...merged.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([k]) => k);
}

async function compute(): Promise<TasteInsights> {
  const profile = loadProfile();
  const events = await getRecentEvents(1000);

  const replayCounts = new Map<string, { title: string; count: number }>();
  for (const e of events) {
    if (e.type !== 'play') continue;
    const cur = replayCounts.get(e.songId) ?? { title: e.title, count: 0 };
    cur.count += 1;
    replayCounts.set(e.songId, cur);
  }
  const mostReplayed = [...replayCounts.entries()]
    .map(([songId, v]) => ({ songId, ...v }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  // Last 7 days of plays.
  const dayMs = 86_400_000;
  const recentTrend: Array<{ day: string; plays: number }> = [];
  for (let i = 6; i >= 0; i--) {
    const dayStart = new Date(Date.now() - i * dayMs);
    dayStart.setHours(0, 0, 0, 0);
    const plays = events.filter(
      (e) => e.type === 'play' && e.ts >= dayStart.getTime() && e.ts < dayStart.getTime() + dayMs,
    ).length;
    recentTrend.push({
      day: dayStart.toLocaleDateString(undefined, { weekday: 'short' }),
      plays,
    });
  }

  let listeningSeconds = 0;
  for (const e of events) {
    if (e.type === 'complete') listeningSeconds += e.songDuration ?? e.playedSec ?? 0;
    else if (e.type === 'skip') listeningSeconds += e.playedSec ?? 0;
  }

  const { completes, skips, plays } = profile.totals;
  const favorites = useLibraryStore.getState().favorites;
  const history = useHistoryStore.getState().entries;
  const settings = useSettingsStore.getState();
  return {
    topLanguages: topLanguages(profile, 6).map(({ id, affinity }) => ({
      id,
      label: languageLabel(id),
      score: affinity.score,
      plays: affinity.plays,
    })),
    topArtists: topArtists(profile, 8).map(({ affinity }) => ({
      name: affinity.name,
      score: affinity.score,
      plays: affinity.plays,
    })),
    mostReplayed,
    hourHistogram: profile.hourHistogram,
    totals: profile.totals,
    completionRate: completes + skips > 0 ? completes / (completes + skips) : null,
    skipRate: plays > 0 ? Math.min(1, skips / plays) : null,
    newToYouShare: newToYouShare(profile, events),
    exploration: { mode: resolveDiscoveryMode(settings), adventurous: profile.sliders?.adventurous ?? 0.5 },
    topMoods: topMoods([...favorites, ...history.slice(0, 100).map((h) => h.song)]),
    topGenres: topGenres(profile, favorites, history),
    confidence: profileConfidence(profile),
    listeningMinutes: Math.round(listeningSeconds / 60),
    recentTrend,
  };
}

export function useTasteInsights() {
  const historyCount = useHistoryStore((s) => s.entries.length);
  return useQuery({
    queryKey: ['taste-insights', profileStamp(), historyCount],
    queryFn: compute,
    staleTime: 60_000,
  });
}
