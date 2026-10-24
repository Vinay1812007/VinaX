import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { HistoryEntry, Song } from '@/types';
import { usePlayerStore } from '@/store/playerStore';
import { isSongBlocked, useLibraryStore } from '@/store/libraryStore';
import { useReasonStore } from '@/store/reasonStore';
import { toast } from '@/store/toastStore';
import { BookmarkIcon, PlayIcon, XIcon } from '@/components/Icons';
import { FALLBACK_ART, bestImage } from '@/utils/images';
import { songPath } from '@/utils/slug';
import { recommendFromSeeds } from '@/services/recs/similar';
import { localDateKey } from '@/features/home/useBecauseYouLiked';
import { getLocal, setLocal } from '@/services/storage/local';

/**
 * 15.0 — "Discover 5": five songs a day the listener has not met, one at a
 * time. Keep saves the song to Listen Later; Skip moves on; Play plays it.
 * A swipe does the same on a phone (right keeps, left skips). The five are
 * picked once a day from the Worker's seeded recommendations
 * (services/recs/similar.ts), seeded by what the listener plays most, and
 * the day's progress is kept on the device so the card does not start over
 * after a reload. It hides itself when there is nothing to seed from or
 * once the five are done.
 */

const KEY = 'vinax.discover5.v1';
const SWIPE_PX = 56;

interface DayState { day: string; ids: string[]; decided: Record<string, 'keep' | 'skip'> }

function loadDay(day: string): DayState {
  const st = getLocal<DayState | null>(KEY, null);
  return st && st.day === day && Array.isArray(st.ids) ? { ...st, decided: st.decided ?? {} } : { day, ids: [], decided: {} };
}

/** Seeds: the most-played songs with a fallback to favourites, five at most. */
function seedsFrom(entries: HistoryEntry[], favorites: Song[]): Song[] {
  const plays = new Map<string, { song: Song; n: number }>();
  for (const e of entries) {
    const cur = plays.get(e.song.id);
    if (cur) cur.n += 1;
    else plays.set(e.song.id, { song: e.song, n: 1 });
  }
  const top = [...plays.values()].sort((a, b) => b.n - a.n).map((x) => x.song);
  const seen = new Set(top.map((s) => s.id));
  return [...top, ...favorites.filter((s) => !seen.has(s.id))].slice(0, 5);
}

export function useDiscoverFive(entries: HistoryEntry[], favorites: Song[]) {
  const day = localDateKey();
  const seeds = useMemo(() => seedsFrom(entries, favorites), [entries, favorites]);
  const known = useMemo(() => {
    const ids = new Set<string>();
    for (const e of entries) ids.add(e.song.id);
    for (const s of favorites) ids.add(s.id);
    return ids;
  }, [entries, favorites]);
  const seedKey = seeds.map((s) => s.id).join(',');
  return useQuery({
    queryKey: ['discover5', day, seedKey],
    enabled: seeds.length > 0,
    staleTime: Infinity,
    gcTime: 86_400_000,
    queryFn: async () => {
      const stored = loadDay(day);
      const songs = await recommendFromSeeds(seeds, { limit: 12, exclude: [...known].slice(0, 90) });
      const lib = useLibraryStore.getState();
      const fresh = songs.filter((s) => !known.has(s.id) && !isSongBlocked(s, lib)).slice(0, 5);
      // A day's five are fixed on first fetch; a later fetch (another tab, a
      // reload) keeps the same order so the progress still lines up.
      const ids = stored.ids.length ? stored.ids : fresh.map((s) => s.id);
      if (!stored.ids.length) setLocal(KEY, { ...stored, ids });
      const byId = new Map(fresh.map((s) => [s.id, s]));
      return ids.map((id) => byId.get(id)).filter((s): s is Song => !!s);
    },
  });
}

export function DiscoverFiveCard({ entries, favorites }: { entries: HistoryEntry[]; favorites: Song[] }) {
  const day = localDateKey();
  const { data: songs } = useDiscoverFive(entries, favorites);
  const [decided, setDecided] = useState<Record<string, 'keep' | 'skip'>>(() => loadDay(day).decided);
  const [drag, setDrag] = useState(0);
  const startX = useRef<number | null>(null);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const toggleLater = useLibraryStore((s) => s.toggleLater);
  const later = useLibraryStore((s) => s.later);
  const reasons = useReasonStore((s) => s.reasons);

  useEffect(() => {
    const st = loadDay(day);
    setLocal(KEY, { ...st, day, decided });
  }, [day, decided]);

  const remaining = useMemo(() => (songs ?? []).filter((s) => !decided[s.id]), [songs, decided]);
  const current = remaining[0];
  const total = songs?.length ?? 0;
  const doneCount = total - remaining.length;

  const decide = useCallback(
    (song: Song, choice: 'keep' | 'skip') => {
      if (choice === 'keep' && !later.some((s) => s.id === song.id)) {
        toggleLater(song);
        toast(`Saved ${song.title} to Listen Later`);
      }
      setDecided((d) => ({ ...d, [song.id]: choice }));
      setDrag(0);
    },
    [later, toggleLater],
  );

  if (!songs || !total || !current) return null;

  const onTouchStart = (e: React.TouchEvent) => { startX.current = e.touches[0].clientX; };
  const onTouchMove = (e: React.TouchEvent) => {
    if (startX.current === null) return;
    setDrag(Math.max(-120, Math.min(120, e.touches[0].clientX - startX.current)));
  };
  const onTouchEnd = () => {
    const dx = drag;
    startX.current = null;
    if (dx > SWIPE_PX) decide(current, 'keep');
    else if (dx < -SWIPE_PX) decide(current, 'skip');
    else setDrag(0);
  };
  const why = reasons[current.id];

  return (
    <div
      className="vxh-card vxh-d5"
      role="group"
      aria-label={`Discover 5: song ${doneCount + 1} of ${total}`}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      style={{ transform: drag ? `translateX(${drag}px) rotate(${drag / 40}deg)` : undefined, transition: drag ? 'none' : undefined }}
      data-lean={drag > 24 ? 'keep' : drag < -24 ? 'skip' : undefined}
    >
      <Link to={songPath(current)} className="shrink-0" aria-label={`Open ${current.title}`}>
        <img
          src={bestImage(current.images, 150)}
          onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)}
          alt=""
          loading="lazy"
          decoding="async"
          width={56}
          height={56}
          className="vxh-card-art"
        />
      </Link>
      <div className="min-w-0 flex-1">
        <p className="vxh-card-label">
          Discover 5
          <span className="vxh-d5-dots" aria-hidden>
            {songs.map((s) => <i key={s.id} data-state={decided[s.id] ?? (s.id === current.id ? 'now' : undefined)} />)}
          </span>
        </p>
        <p className="vxh-card-title">{current.title}</p>
        <p className="vxh-card-sub">{why ?? current.subtitle}</p>
      </div>
      <div className="vxh-card-actions">
        <button type="button" onClick={() => decide(current, 'skip')} aria-label={`Skip ${current.title}`} title="Skip" className="vxh-round">
          <XIcon />
        </button>
        <button type="button" onClick={() => playQueue([current, ...remaining.slice(1)], 0)} aria-label={`Play ${current.title}`} title="Play" className="vxh-round is-play">
          <PlayIcon />
        </button>
        <button type="button" onClick={() => decide(current, 'keep')} aria-label={`Keep ${current.title} in Listen Later`} title="Keep" className="vxh-round">
          <BookmarkIcon />
        </button>
      </div>
    </div>
  );
}
