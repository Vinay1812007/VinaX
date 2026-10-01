import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Shelf } from '@/components/Shelf';
import { MediaCard } from '@/components/MediaCard';
import { ChevronDownIcon } from '@/components/Icons';
import { usePlayerStore } from '@/store/playerStore';
import { useHistoryStore } from '@/store/historyStore';
import { getSessionIntent } from '@/services/personalization/sessionIntent';
import { servedKeySet } from '@/services/recommendation/songIdentity';
import { NO_SIGNALS, surfaceOrder, surfaceSignals, type SurfaceKind, type SurfaceSignals } from '@/services/recommendation/surfacePolicy';
import { songPath } from '@/utils/slug';
import { bestImage } from '@/utils/images';
import { useShelfSafety } from '../useShelfSafety';
import type { Song } from '@/types';

/**
 * 9.0.0 — the pieces every Home block is built from.
 *
 * A Home list goes through one lens before it is shown: the listener's
 * CURRENT safety settings (live — a new hide, mute, Kid mode or "Less like
 * this" removes a song at once, cached lists included), then the surface's
 * repetition rule (services/recommendation/surfacePolicy.ts), read once per
 * Home visit so nothing reorders while the listener scrolls. Cross-shelf
 * de-duplication (../shelfLedger.ts) runs after the lens, in display order.
 */
const HomeSignals = createContext<SurfaceSignals>(NO_SIGNALS);

/**
 * Read the repetition signals once per Home generation: when Home opens, and
 * again after an explicit refresh — never while the listener scrolls. (The
 * blocks are not remounted for a new generation: their queries move to the
 * new keys and keep the previous shelves on screen until the new ones land.)
 */
export function HomeSignalsProvider({ generation, children }: { generation: number; children: ReactNode }) {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- read the stores once per generation, on purpose
  const signals = useMemo(() => surfaceSignals(useHistoryStore.getState().entries, getSessionIntent().skippedSongIds, servedKeySet()), [generation]);
  return <HomeSignals.Provider value={signals}>{children}</HomeSignals.Provider>;
}

export type ShelfLens = (songs: readonly Song[] | undefined, surface: SurfaceKind) => Song[];

/** Safety (live), then the surface rule (frozen for the visit). */
export function useShelfLens(): ShelfLens {
  const allowed = useShelfSafety();
  const signals = useContext(HomeSignals);
  return useCallback((songs, surface) => surfaceOrder((songs ?? []).filter(allowed), surface, signals), [allowed, signals]);
}

/**
 * Mounts a home block only when it scrolls within ~800px of the viewport
 * (4.18.3 TBT pass). Until then it holds a fixed-height placeholder so the
 * page keeps scroll depth (without one, every collapsed block would sit
 * inside the observer margin at once and everything would mount together).
 * The swap happens ~a screen before the block is visible, so listeners never
 * see the placeholder and CLS stays 0. Falls back to mounting immediately
 * when IntersectionObserver is unavailable. A block that is not mounted does
 * not fetch.
 */
export function DeferredBlock({ render }: { render?: () => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (on) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setOn(true);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setOn(true);
    }, { rootMargin: '800px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [on]);
  if (on) return <>{render?.()}</>;
  return <div ref={ref} className="h-56" aria-hidden />;
}

/** A shelf of songs: tap a card to open the song, its play button plays the shelf from that song. */
export function SongShelf({ title, explanation, songs, seeAllTo, action }: { title: string; explanation?: string; songs: Song[]; seeAllTo?: string; action?: ReactNode }) {
  const playQueue = usePlayerStore((s) => s.playQueue);
  if (!songs.length) return null;
  return (
    <Shelf title={title} explanation={explanation} seeAllTo={seeAllTo} action={action} layout={songs.length <= 8 ? 'grid' : 'rail'}>
      {songs.map((song, i) => (
        <MediaCard
          key={song.id}
          to={songPath(song)}
          image={bestImage(song.images)}
          images={song.images}
          title={song.title}
          subtitle={song.subtitle}
          song={song}
          onPlay={() => playQueue(songs, i)}
        />
      ))}
    </Shelf>
  );
}

/** Session-remembered open state for a disclosure (so returning to Home keeps what the listener opened). */
function useRemembered(key: string): [boolean, (v: boolean) => void] {
  const storageKey = `vinax.home.open.${key}`;
  const [open, setOpen] = useState(() => {
    try {
      return sessionStorage.getItem(storageKey) === '1';
    } catch {
      return false;
    }
  });
  const set = (v: boolean): void => {
    setOpen(v);
    try {
      if (v) sessionStorage.setItem(storageKey, '1');
      else sessionStorage.removeItem(storageKey);
    } catch {
      /* the open state is a convenience */
    }
  };
  return [open, set];
}

/**
 * Progressive disclosure: a labelled button that reveals more shelves. Closed,
 * nothing inside mounts (and so nothing inside fetches). The open state is
 * remembered for this tab's session.
 */
export function MoreShelves({ id, label, hint, children }: { id: string; label: string; hint?: string; children: () => ReactNode }) {
  const [open, setOpen] = useRemembered(id);
  const region = useId();
  return (
    <div className={open ? 'vxh-more-open' : 'vxh-more-closed'}>
      {open && <div id={region}>{children()}</div>}
      <button type="button" className="vxh-disclose" aria-expanded={open} aria-controls={open ? region : undefined} onClick={() => setOpen(!open)}>
        <span className="vxh-disclose-text">
          <span>{open ? 'Show less' : label}</span>
          {!open && hint && <span className="vxh-disclose-hint">{hint}</span>}
        </span>
        <ChevronDownIcon className={open ? 'w-5 h-5 rotate-180' : 'w-5 h-5'} />
      </button>
    </div>
  );
}
