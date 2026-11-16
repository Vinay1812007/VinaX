import { useCallback, useEffect, useRef, useState } from 'react';
import { searchVideosPage, type Video } from '@/services/api/videos';
import type { Song } from '@/types';
import { useDailyMix } from '@/features/home/useDailyMix';
import { useTrendingNow } from '@/features/home/useHomeShelves';
import { seededShuffle } from '@/features/home/freshRotation';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { appendReels, notePageAsked, notePageCount, readSeen, reelQueries, searchableTitle, type PageBook } from './reels';

/** Reels asked for per search. */
const PER_QUERY = 10;
/** Rounds of searches one visit makes at most (each is about six searches). */
const MAX_ROUNDS = 30;
/** A round that adds fewer reels than this starts the next one straight away. */
const MIN_NEW = 3;
/** This many rounds in a row with nothing new: the catalogue has nothing more. */
const EMPTY_ROUNDS = 3;
/** This many rounds in a row where every search failed: give up until the listener taps Try again. */
const FAILED_ROUNDS = 3;
/** The wait before asking again after a failed round, times the failures so far. */
const RETRY_MS = 1_500;

const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

/**
 * 1.14.4 — Flow's reels. `more()` loads the next round; the page calls it
 * when the listener nears the end.
 *
 * 1.14.5 — every visit reads its own random pages of each language's video
 * list (the first page used to come first every time, so Flow always opened
 * on the same reels); only reels labelled with the listener's languages
 * join, and only titles of songs in those languages are asked; reels watched
 * before wait until nothing new is left; a round where every search failed
 * is asked again after a pause instead of ending the feed, and after a few
 * the page offers Try again.
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
  const [failed, setFailed] = useState(false);
  const round = useRef(0);
  const busy = useRef(false);
  const asked = useRef(new Set<string>());
  const book = useRef<PageBook>(new Map());
  /** Reels watched on an earlier visit, held back until nothing new is left. */
  const held = useRef<Video[]>([]);
  const [seen] = useState(readSeen);
  const [salt] = useState(() => Math.floor(Math.random() * 1_000_000));
  const titles = useRef<string[]>([]);

  const langs = (pinned.length ? pinned : ['telugu', 'hindi']).map((l) => l.toLowerCase()).filter((l) => !muted.includes(l));
  const langKey = langs.join(',');
  const langsRef = useRef(langs);
  langsRef.current = langs;

  // The titles to look up: liked songs (shuffled per visit), then the Daily mix and Trending,
  // only songs in the listener's languages (a liked English song finds English videos).
  useEffect(() => {
    const want = new Set(langKey.split(','));
    const mine = (s: Song) => !!s.language && want.has(s.language.toLowerCase());
    const liked = seededShuffle(useLibraryStore.getState().favorites.filter(mine).slice(0, 80), salt).slice(0, 20);
    const list = [...liked, ...(daily.data ?? []).filter(mine), ...(trending.data ?? []).filter(mine)].map((s) => s.title);
    const seenTitles = new Set<string>();
    titles.current = seededShuffle(list, salt + 1).filter((t) => {
      const k = searchableTitle(t).toLowerCase();
      if (!k || seenTitles.has(k)) return false;
      seenTitles.add(k);
      return true;
    });
  }, [daily.data, trending.data, salt, langKey]);

  const more = useCallback(async (): Promise<void> => {
    if (busy.current || round.current >= MAX_ROUNDS) return;
    const mine = epoch.current;
    busy.current = true;
    setLoading(true);
    try {
      let added = 0;
      let empty = 0;
      let failures = 0;
      // A round of repeats simply asks the next round.
      while (added < MIN_NEW && round.current < MAX_ROUNDS && mine === epoch.current) {
        const plan = reelQueries({
          languages: langsRef.current,
          titles: titles.current,
          round: round.current,
          asked: asked.current,
          book: book.current,
          rand: Math.random,
        });
        round.current += 1;
        for (const q of plan) {
          asked.current.add(q.query.toLowerCase());
          notePageAsked(book.current, q);
        }
        const answers = await Promise.all(plan.map((q) => searchVideosPage(q.query, q.page, PER_QUERY)));
        if (mine !== epoch.current) return;
        if (answers.every((a) => a === null)) {
          // Offline, or the catalogue hiccuped: not "nothing more". Ask again after a pause.
          failures += 1;
          round.current -= 1;
          if (failures >= FAILED_ROUNDS) {
            if (!reelsRef.current.length) setFailed(true);
            break;
          }
          await wait(RETRY_MS * failures);
          continue;
        }
        failures = 0;
        answers.forEach((a, k) => a && notePageCount(book.current, plan[k].query, a.total, PER_QUERY));
        // Round-robin across the answers, so one search never fills a whole stretch.
        const lists = answers.map((a) => a?.results ?? []);
        const mixed: Video[] = [];
        for (let i = 0; i < PER_QUERY; i += 1) for (const l of lists) if (l[i]) mixed.push(l[i]);
        const prev = reelsRef.current;
        const opts = { languages: langsRef.current, seen };
        const first = appendReels(prev, mixed, opts);
        let next = first.reels;
        held.current.push(...first.held);
        if (next.length === prev.length && held.current.length) {
          // Nothing new this round: the reels watched before may join now.
          next = appendReels(prev, held.current, { ...opts, includeSeen: true }).reels;
          held.current = [];
        }
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

  const start = useCallback(() => {
    epoch.current += 1;
    busy.current = false;
    round.current = 0;
    asked.current = new Set();
    book.current = new Map();
    held.current = [];
    reelsRef.current = [];
    setReels([]);
    setDone(false);
    setFailed(false);
    void more();
  }, [more]);

  // First screen; a language change starts over.
  useEffect(() => {
    start();
  }, [langKey, start]);

  return { reels, loading, done: done || failed, failed, more, retry: start };
}
