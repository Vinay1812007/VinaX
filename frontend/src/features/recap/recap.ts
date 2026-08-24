import type { HistoryEntry } from '@/types';
import type { TasteProfile } from '@/services/personalization/profile';
import { topArtists, topLanguages } from '@/services/personalization/profile';

/**
 * "Your Year in Music" — a Wrapped-style recap computed ENTIRELY on-device
 * from the taste profile's lifetime aggregates plus recent history. Nothing
 * is fetched, nothing is uploaded; sharing renders a local image the
 * listener chooses to send (the founding invariant).
 *
 * Honesty rules: the profile keeps exact lifetime play/complete/favorite
 * counts and per-artist plays, so those are stated as facts. Listening time
 * is an ESTIMATE (recent history's average track length × lifetime plays) —
 * always presented with a ≈. History itself caps at 150 entries, so the
 * "on repeat" pick is labeled as recent, not all-time.
 */

export interface RecapArtist {
  name: string;
  plays: number;
}

export interface RecapData {
  year: number;
  /** Days since the profile was born (capped to the year), for "with you for N days". */
  daysTogether: number;
  totalPlays: number;
  completes: number;
  favorites: number;
  /** Estimated minutes listened — derived, always show with ≈. */
  estMinutes: number;
  topArtists: RecapArtist[];
  /** [language id, share 0-100] */
  topLanguages: Array<{ id: string; pct: number }>;
  /** Most-played song title in RECENT history (150-entry window), or null. */
  onRepeat: { title: string; subtitle: string; count: number } | null;
  /** Fun persona from the hour histogram + skip behavior. */
  persona: string;
  /** 0-23 — the listener's single biggest listening hour. */
  peakHour: number;
}

const DAY = 86_400_000;
/** Fallback track length when history is empty (median filmi track). */
const DEFAULT_TRACK_SEC = 210;

function persona(hourHistogram: number[], plays: number, skips: number): string {
  const sum = (a: number, b: number) => a + b;
  const total = hourHistogram.reduce(sum, 0) || 1;
  const night = hourHistogram.slice(0, 5).reduce(sum, 0) + hourHistogram.slice(22).reduce(sum, 0);
  const morning = hourHistogram.slice(5, 11).reduce(sum, 0);
  const evening = hourHistogram.slice(17, 22).reduce(sum, 0);
  const skipRate = plays > 0 ? skips / plays : 0;
  if (night / total > 0.4) return 'Midnight Melophile';
  if (morning / total > 0.4) return 'Sunrise Raga';
  if (evening / total > 0.45) return 'Evening Unwinder';
  if (skipRate > 0.35) return 'Restless Explorer';
  if (skipRate < 0.08 && plays >= 50) return 'Loyal Listener';
  return 'All-Day Tunesmith';
}

export function buildRecap(profile: TasteProfile, history: HistoryEntry[], favoritesCount: number, now: number): RecapData {
  const d = new Date(now);
  const year = d.getFullYear();
  const yearStart = new Date(year, 0, 1).getTime();
  const since = Math.max(profile.createdAt || now, yearStart);
  const daysTogether = Math.max(1, Math.floor((now - since) / DAY) + 1);

  const totalPlays = profile.totals.plays;
  // Estimated minutes: average known duration over recent history × lifetime plays.
  const durs = history.map((e) => e.song.duration).filter((x): x is number => typeof x === 'number' && x > 30);
  const avgSec = durs.length ? durs.reduce((a, b) => a + b, 0) / durs.length : DEFAULT_TRACK_SEC;
  const estMinutes = Math.round((totalPlays * avgSec) / 60);

  const artists = topArtists(profile, 5).map((a) => ({ name: a.affinity.name, plays: a.affinity.plays }));

  const langs = topLanguages(profile, 3);
  const langTotal = langs.reduce((n, l) => n + l.affinity.plays, 0) || 1;
  const topLangs = langs
    .filter((l) => l.affinity.plays > 0)
    .map((l) => ({ id: l.id, pct: Math.round((l.affinity.plays / langTotal) * 100) }));

  // Recent on-repeat: most played song id in the 150-entry history window.
  const counts = new Map<string, { title: string; subtitle: string; count: number }>();
  for (const e of history) {
    const cur = counts.get(e.song.id) ?? { title: e.song.title, subtitle: e.song.subtitle, count: 0 };
    cur.count += 1;
    counts.set(e.song.id, cur);
  }
  let onRepeat: RecapData['onRepeat'] = null;
  for (const v of counts.values()) if (!onRepeat || v.count > onRepeat.count) onRepeat = v;
  if (onRepeat && onRepeat.count < 2) onRepeat = null; // one play is not "on repeat"

  const hh = profile.hourHistogram?.length === 24 ? profile.hourHistogram : new Array<number>(24).fill(0);
  let peakHour = 0;
  for (let h = 1; h < 24; h++) if (hh[h] > hh[peakHour]) peakHour = h;

  return {
    year,
    daysTogether,
    totalPlays,
    completes: profile.totals.completes,
    favorites: favoritesCount,
    estMinutes,
    topArtists: artists,
    topLanguages: topLangs,
    onRepeat,
    persona: persona(hh, totalPlays, profile.totals.skips),
    peakHour,
  };
}

/** Enough signal to make the recap worth showing at all. */
export function recapReady(r: RecapData): boolean {
  return r.totalPlays >= 20 && r.topArtists.length >= 1;
}
