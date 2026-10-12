/**
 * Compact listener-taste snapshot shared by every conversational AI surface
 * (VinaX AI, the settings assistant, AI Playlist). It combines listening
 * signals — language, time-of-day vibe, favourites, most-played
 * and recency — in a small, privacy-bounded payload built entirely from
 * on-device data. No ids, no timestamps: just human-readable song lines.
 */
import { useSettingsStore } from '@/store/settingsStore';
import { useHistoryStore } from '@/store/historyStore';
import { useLibraryStore } from '@/store/libraryStore';
import { loadProfile } from '@/services/personalization/storage';
import { getSliders, sliderDialLines } from '@/services/personalization/dials';
import { buildSessionContext } from '@/services/ai/sessionContext';
import type { Song } from '@/types';

export interface TasteSnapshot {
  timeOfDay: string;
  sessionVibe: string;
  dayOfWeek: string;
  isWeekend: boolean;
  listenerEnergy: string;
  festivalContext?: string;
  preferredLanguages: string[];
  avoidLanguages: string[];
  topArtists: string[];
  topSongs: string[];
  likedSongs: string[];
  recentlyPlayed: string[];
  /** Package C3 — one-liners for any hand-tuned taste dials (empty if neutral). */
  tasteDials: string[];
  /** Package B5 — songs already recommended earlier in THIS chat thread, so the
   *  model never re-serves them. Set by the chat page, not by the builder. */
  alreadyRecommendedThisChat?: string[];
  /** 11.7.0 — songs the assistant suggested in the listener's OTHER recent chats. Set by the chat page. */
  recentlyRecommended?: string[];
  /** 11.7.0 — artists the listener skips more than they finish: a "no", not a favourite. */
  skippedArtists: string[];
}

const line = (s: Song): string =>
  `${s.title} — ${s.artists.map((a) => a.name).join(', ')}`.slice(0, 90);

/**
 * 11.7.0 — the strongest `fixed` items, then `extra` more drawn at random from
 * the next `depth`. Every AI surface used to receive the SAME top-8 favourites
 * and top-10 artists on every call, and the model — told to favour them —
 * anchored on the same corner of the library every time. The head keeps the
 * profile honest; the rotating tail lets each request lean on a different part
 * of what the listener loves.
 */
export function headPlusSample<T>(list: readonly T[], fixed: number, extra: number, depth: number, random: () => number = Math.random): T[] {
  const head = list.slice(0, fixed);
  const tail = list.slice(fixed, fixed + depth);
  for (let i = tail.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [tail[i], tail[j]] = [tail[j], tail[i]];
  }
  return [...head, ...tail.slice(0, extra)];
}

/** Learning day by day: plays inside the last two weeks count triple, so what
 *  the listener is into THIS week outranks last month's binge — the same
 *  14-day horizon the local recommendation profile decays on. */
const RECENT_WINDOW_MS = 14 * 86_400_000;
const RECENT_WEIGHT = 3;

export function buildTasteSnapshot(now = Date.now(), random: () => number = Math.random): TasteSnapshot {
  const settings = useSettingsStore.getState();
  const entries = useHistoryStore.getState().entries;
  // Deep session context: weekday-aware vibe, live listener energy, festival.
  const session = buildSessionContext(entries, new Date(now));
  const favorites = useLibraryStore.getState().favorites;
  const weight = (ts: number): number => (now - ts <= RECENT_WINDOW_MS ? RECENT_WEIGHT : 1);

  // Most-played tracks — the strongest "you love this" signal, tilted fresh.
  const playCounts = new Map<string, { song: Song; n: number }>();
  for (const e of entries) {
    const w = weight(e.ts);
    const cur = playCounts.get(e.song.id);
    if (cur) cur.n += w;
    else playCounts.set(e.song.id, { song: e.song, n: w });
  }
  const topSongs = headPlusSample([...playCounts.values()].sort((a, b) => b.n - a.n), 5, 3, 30, random).map((x) => line(x.song));

  // Artists weighted by plays (recent plays count triple), favourites double.
  const artistCounts = new Map<string, number>();
  for (const e of entries) {
    const w = weight(e.ts);
    for (const a of e.song.artists) artistCounts.set(a.name, (artistCounts.get(a.name) ?? 0) + w);
  }
  for (const s of favorites) for (const a of s.artists) artistCounts.set(a.name, (artistCounts.get(a.name) ?? 0) + 2);
  const topArtists = headPlusSample([...artistCounts.entries()].sort((a, b) => b[1] - a[1]), 6, 4, 30, random).map(([name]) => name);
  const profile = loadProfile();
  // 11.7.0 — the "no" side of taste: artists skipped more than finished.
  const skippedArtists = Object.values(profile.artists ?? {})
    .filter((a) => a.name && a.skips >= 3 && a.skips > a.completes)
    .sort((a, b) => b.skips - b.completes - (a.skips - a.completes))
    .slice(0, 8)
    .map((a) => a.name);

  return {
    ...session,
    preferredLanguages: settings.pinnedLanguages.slice(0, 5),
    avoidLanguages: settings.mutedLanguages.slice(0, 5),
    topArtists: topArtists.filter((name) => !skippedArtists.includes(name)),
    topSongs,
    likedSongs: headPlusSample(favorites, 4, 4, 80, random).map(line),
    recentlyPlayed: entries.slice(0, 10).map((e) => line(e.song)),
    skippedArtists,
    tasteDials: sliderDialLines(getSliders(profile)),
  };
}
