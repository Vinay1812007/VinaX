import { useCallback, useEffect, useRef, useState } from 'react';
import { searchVideos, type Video } from '@/services/api/videos';
import { useDailyMix } from '@/features/home/useDailyMix';
import { useTrendingNow } from '@/features/home/useHomeShelves';
import { seededShuffle } from '@/features/home/freshRotation';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { appendReels, readSeen, reelQueries, searchableTitle } from './reels';

/** Reels asked for per search. */
const PER_QUERY = 10;
/** Rounds of searches one visit makes at most (each is about six searches). */
const MAX_ROUNDS = 30;
/** A round that adds fewer reels than this starts the next one straight away. */
const MIN_NEW = 3;
/** This many rounds in a row with nothing new: the catalogue has nothing more (or is down). */
const EMPTY_ROUNDS = 3;

/**
 * 1.14.4 — Flow's reels. The first round starts as soon as Flow opens with
 * the plain searches in the listener's languages; song titles from the Daily
 * mix, Trending now (both usually already in the query cache from Home) and
 * the listener's likes join each later round. `more()` loads the next round;
 * the page calls it when the listener nears the end.
 */
export function useFlowReels() {
  const pinned = useSettingsStore((s) => s.pinnedLanguages);
  const muted = useSettingsStore((s) => s.mutedLanguages);
  const daily = useDailyMix();
  const trending = useTrendingNow();
  const [reels, setReels] = useState<Video[]>([]);
  const reelsRef = useRef<Video[]>([]);
  /** Moves when the languages change: a round started for the old ones stops adding. */
  const epoch = useRef(0);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const round = useRef(0);
  const busy = useRef(false);
  const asked = useRef(new Set<string>());
  const [seen] = useState(readSeen);
  const [salt] = useState(() => Math.floor(Math.random() * 1_000_000));
  const titles = useRef<string[]>([]);

  const langs = (pinned.length ? pinned : ['telugu', 'hindi']).map((l) => l.toLowerCase()).filter((l) => !muted.includes(l));
  const langKey = langs.join(',');
  const langsRef = useRef(langs);
  langsRef.current = langs;

  // The titles to look up: liked songs (shuffled per visit), then the Daily mix and Trending.
  useEffect(() => {
    const liked = seededShuffle(useLibraryStore.getState().favorites.slice(0, 80), salt).slice(0, 20);
    const list = [...liked, ...(daily.data ?? []), ...(trending.data ?? [])].map((s) => s.title);
    const seenTitles = new Set<string>();
    titles.current = seededShuffle(list, salt + 1).filter((t) => {
      const k = searchableTitle(t).toLowerCase();
      if (!k || seenTitles.has(k)) return false;
      seenTitles.add(k);
      return true;
    });
  }, [daily.data, trending.data, salt]);

  const more = useCallback(async (): Promise<void> => {
    if (busy.current || round.current >= MAX_ROUNDS) return;
    const mine = epoch.current;
    busy.current = true;
    setLoading(true);
    try {
      let added = 0;
      let empty = 0;
      // A round of repeats (or a flaky answer) simply asks the next round.
      while (added < MIN_NEW && round.current < MAX_ROUNDS && mine === epoch.current) {
        const plan = reelQueries({ languages: langsRef.current, titles: titles.current, round: round.current, asked: asked.current });
        round.current += 1;
        for (const q of plan) asked.current.add(q.query.toLowerCase());
        const answers = await Promise.allSettled(plan.map((q) => searchVideos(q.query, q.page, PER_QUERY)));
        if (mine !== epoch.current) return;
        // Round-robin across the answers, so one search never fills a whole stretch.
        const lists = answers.map((a) => (a.status === 'fulfilled' ? a.value : []));
        const mixed: Video[] = [];
        for (let i = 0; i < PER_QUERY; i += 1) for (const l of lists) if (l[i]) mixed.push(l[i]);
        const prev = reelsRef.current;
        const next = appendReels(prev, mixed, { languages: langsRef.current, seen });
        const gained = next.length - prev.length;
        added += gained;
        reelsRef.current = next;
        setReels(next);
        empty = gained ? 0 : empty + 1;
        if (round.current >= MAX_ROUNDS || empty >= EMPTY_ROUNDS) {
          setDone(true);
          break;
        }
      }
    } finally {
      if (mine === epoch.current) {
        busy.current = false;
        setLoading(false);
      }
    }
  }, [seen]);

  // First screen; a language change starts over.
  useEffect(() => {
    epoch.current += 1;
    busy.current = false;
    round.current = 0;
    asked.current = new Set();
    reelsRef.current = [];
    setReels([]);
    setDone(false);
    void more();
  }, [langKey, more]);

  return { reels, loading, done, more };
}
