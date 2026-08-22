import { useQuery } from '@tanstack/react-query';
import { loadProfile, profileStamp } from '@/services/personalization/storage';
import { profileConfidence, topArtists, topLanguages } from '@/services/personalization/profile';
import { getRecentEvents } from '@/services/storage/idb';
import { languageLabel } from '@/constants/languages';
import { useHistoryStore } from '@/store/historyStore';

export interface TasteInsights {
  topLanguages: Array<{ id: string; label: string; score: number; plays: number }>;
  topArtists: Array<{ name: string; score: number; plays: number }>;
  mostReplayed: Array<{ songId: string; title: string; count: number }>;
  hourHistogram: number[];
  totals: { plays: number; completes: number; skips: number; favorites: number; queueAdds: number };
  completionRate: number | null;
  confidence: number;
  listeningMinutes: number;
  recentTrend: Array<{ day: string; plays: number }>;
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

  const { completes, skips } = profile.totals;
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
