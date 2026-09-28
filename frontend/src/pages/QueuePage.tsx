import { Fragment, lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { songLine } from '@/utils/songLine';

const QueueBuilderSheet = lazy(() => import('@/features/queue/QueueBuilderSheet').then((m) => ({ default: m.QueueBuilderSheet })));
import { usePageTitle } from '@/hooks/usePageTitle';
import { Link } from 'react-router-dom';
import { usePlayerStore, useCurrentSong } from '@/store/playerStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useReasonStore } from '@/store/reasonStore';
import { EmptyState } from '@/components/States';
import { Chip } from '@/components/Chip';
import { occurrenceKeys, VirtualChunks } from '@/components/VirtualChunks';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { toast } from '@/store/toastStore';
import { TuneChips } from '@/features/queue/TuneChips';
import { SmartQueue } from '@/features/queue/SmartQueue';
import { OriginBadge } from '@/features/queue/OriginBadge';
import { originOf, type QueueOrigin } from '@/features/queue/origin';
import { TrackMenu, type TrackMenuItem } from '@/components/TrackMenu';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useSettingsStore } from '@/store/settingsStore';
import { XIcon, QueueIcon, GripIcon, SparkleIcon } from '@/components/Icons';
import type { Song } from '@/types';
import '@/styles/pages/player.css';

/** One row (48px art + two lines, 6px padding) — the off-screen size estimate for list chunks. */
const ROW_HEIGHT = 72;
/** How long a rebuild may take before the page offers to try again. */
const REBUILD_TIMEOUT_MS = 12_000;

/**
 * Which slot a pointer at `y` falls in, given each row's vertical midpoint
 * (ascending). Binary search: the first row whose midpoint is below the
 * pointer, else the last row.
 */
export function slotForY(mids: readonly number[], y: number): number {
  let lo = 0;
  let hi = mids.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (y < mids[mid]) hi = mid;
    else lo = mid + 1;
  }
  return Math.max(0, Math.min(lo, mids.length - 1));
}

const SORTS = [
  ['energy', 'Energy'],
  ['calm', 'Calm first'],
  ['new', 'Newest'],
  ['old', 'Classics'],
  ['mood', 'Mood arc'],
] as const;

type DropEdge = 'above' | 'below' | null;

interface QueueRowProps {
  song: Song;
  /** 0-based position within "Up next". */
  pos: number;
  rowKey: string;
  origin: QueueOrigin;
  /** The DJ's own one-line reason for an automatic pick, when it recorded one. */
  reason?: string;
  isFirst: boolean;
  isLast: boolean;
  dragging: boolean;
  dropEdge: DropEdge;
  setRowEl: (pos: number, el: HTMLLIElement | null) => void;
  onDragStart: (pos: number, e: React.PointerEvent<HTMLButtonElement>) => void;
  onDragMove: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
  onNudge: (pos: number, rowKey: string, e: React.KeyboardEvent<HTMLButtonElement>) => void;
  onMove: (rowKey: string, delta: -1 | 1) => void;
  onKeep: (rowKey: string) => void;
  onClearFrom: (rowKey: string) => void;
  onRemove: (rowKey: string) => void;
  onPlay: (rowKey: string) => void;
}

/**
 * One "Up next" row. Memoised with stable handlers: a drag restyles the two
 * rows involved and a removal re-renders nothing above it.
 *
 * Every action a row offers is reachable without a pointer: the grip takes
 * arrow keys, and the row's "⋯" menu repeats Move up / Move down alongside
 * Keep this song, Clear from here down and the usual song actions. Positions
 * are looked up by row key when the action runs, never captured, so a queue
 * that moved on under an open menu cannot move the wrong song.
 */
const QueueRow = memo(function QueueRow({
  song: s,
  pos,
  rowKey,
  origin,
  reason,
  isFirst,
  isLast,
  dragging,
  dropEdge,
  setRowEl,
  onDragStart,
  onDragMove,
  onDragEnd,
  onNudge,
  onMove,
  onKeep,
  onClearFrom,
  onRemove,
  onPlay,
}: QueueRowProps) {
  const line = songLine(s);
  const menuItems: TrackMenuItem[] = [
    ...(origin === 'auto' ? [{ label: 'Keep this song', action: () => onKeep(rowKey) }] : []),
    ...(isFirst ? [] : [{ label: 'Move up', action: () => onMove(rowKey, -1) }]),
    ...(isLast ? [] : [{ label: 'Move down', action: () => onMove(rowKey, 1) }]),
    ...(isLast ? [] : [{ label: 'Clear from here down', action: () => onClearFrom(rowKey) }]),
    { label: 'Remove from queue', action: () => onRemove(rowKey) },
  ];
  return (
    <li
      ref={(el) => setRowEl(pos, el)}
      data-row-key={rowKey}
      className={`vx-queue-row${dragging ? ' is-dragging' : dropEdge === 'above' ? ' drop-above' : dropEdge === 'below' ? ' drop-below' : ''}`}
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          data-reorder-key={rowKey}
          onPointerDown={(e) => onDragStart(pos, e)}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
          onKeyDown={(e) => onNudge(pos, rowKey, e)}
          aria-label={`Reorder ${s.title} — drag, or use arrow keys`}
          title="Drag to reorder"
          // 28px grip, 44px hit area (IconButton's invisible-pad pattern).
          className={`relative after:absolute after:inset-0 after:-m-[8px] p-1.5 -ml-1 rounded-md shrink-0 cursor-grab active:cursor-grabbing text-ink-400 hover:text-ink-100 ${dragging ? 'text-ink-100' : ''}`}
          style={{ touchAction: 'none' }}
        >
          <GripIcon className="w-4 h-4" />
        </button>
        <button type="button" onClick={() => onPlay(rowKey)} className="flex items-center gap-3 min-w-0 flex-1 text-left">
          <img
            src={bestImage(s.images, 96)}
            onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)}
            alt=""
            loading="lazy"
            decoding="async"
          />
          <span className="min-w-0 flex-1">
            {/* Song – Movie/Album – Artist, then who queued it and why */}
            <span className="vx-queue-row-title font-bold">{line.title}</span>
            <span className="vx-queue-row-meta">{[line.album, line.artist].filter(Boolean).join(' – ')}</span>
            {/* The marker keeps its own line: on a phone it would otherwise
                leave the film and artist with a few characters. */}
            {(origin !== 'list' || reason) && (
              <span className="mt-1 flex items-center gap-1.5 min-w-0">
                <OriginBadge origin={origin} />
                {reason && (
                  <>
                    <SparkleIcon className="w-3 h-3 shrink-0 text-ink-400" aria-hidden />
                    <span className="block text-[12px] text-ink-400 truncate">{reason}</span>
                  </>
                )}
              </span>
            )}
          </span>
        </button>
        <TrackMenu song={s} label={`More options for ${s.title}`} leadItems={menuItems} />
        <button
          type="button"
          onClick={() => onRemove(rowKey)}
          aria-label={`Remove ${s.title} from queue`}
          className="vx-queue-remove p-1.5 rounded-full text-ink-400 hover:text-ink-100 hover:bg-ink-800 shrink-0 relative after:absolute after:inset-0 after:-m-[8px]"
        >
          <XIcon className="w-4 h-4" />
        </button>
      </div>
    </li>
  );
});

/** Where focus goes after the list re-orders or loses the control that had it. */
type Refocus = { key: string; target: 'grip' | 'menu' | 'remove' } | { key: null; target: 'heading' } | null;

export default function QueuePage() {
  usePageTitle('Queue');
  const queue = usePlayerStore((s) => s.queue);
  const djTakeover = useSettingsStore((s) => s.djTakeover);
  const index = usePlayerStore((s) => s.index);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const song = useCurrentSong();
  const online = useOnlineStatus();
  const reasons = useReasonStore((s) => s.reasons);
  const upNext = useMemo(() => queue.slice(index + 1), [queue, index]);
  // Index-free keys, numbered over the WHOLE queue so they also survive the
  // playing song advancing. `${id}-${index}` remounted the moved row on every
  // keyboard step (dropping focus) and every row below a removed one.
  const rowKeys = useMemo(() => occurrenceKeys(queue.map((s) => s.id)).slice(index + 1), [queue, index]);
  // 7.2 — who queued each upcoming entry. Read from the player's own sets;
  // every ownership change replaces `queue`, so this recomputes with it.
  const origins = useMemo(() => upNext.map((s) => originOf(s.id)), [upNext]);
  const mix = useMemo(() => {
    const counts: Record<QueueOrigin, number> = { auto: 0, manual: 0, list: 0 };
    for (const o of origins) counts[o] += 1;
    return counts;
  }, [origins]);
  // v6.3.0 — Queue Builder.
  const [building, setBuilding] = useState(false);
  /** Spoken through the polite live region below — reorders are otherwise silent. */
  const [announcement, setAnnouncement] = useState('');

  // ---- Drag-to-reorder (pointer events, zero deps) -----------------------
  // dragFrom/dragOver are 0-based positions within upNext; the store call
  // translates to absolute queue indexes. Works for touch AND mouse: the
  // handle sets touch-action:none so the gesture never fights page scroll.
  // Gesture truth lives in refs (pointer events outrun React state); the
  // mirrored state exists only so the rows restyle while dragging.
  //
  // Row geometry is snapshotted ONCE at drag start (midpoints relative to the
  // list) and binary-searched per move; each pointermove then costs a single
  // rect read on the list — which also keeps it right if the page scrolls —
  // instead of a getBoundingClientRect on every row.
  const dragRef = useRef<{ from: number; over: number; mids: number[] } | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const rowRefs = useRef<Array<HTMLLIElement | null>>([]);
  const listRef = useRef<HTMLUListElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const setRowEl = useCallback((pos: number, el: HTMLLIElement | null) => {
    rowRefs.current[pos] = el;
  }, []);
  /** The live row keys, for handlers that must not capture a stale position. */
  const rowKeysRef = useRef(rowKeys);
  rowKeysRef.current = rowKeys;

  const startDrag = useCallback((pos: number, e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const state = usePlayerStore.getState();
    const count = state.queue.length - state.index - 1;
    const listTop = listRef.current?.getBoundingClientRect().top ?? 0;
    const mids: number[] = [];
    for (let i = 0; i < count; i++) {
      const r = rowRefs.current[i]?.getBoundingClientRect();
      mids.push(r ? r.top - listTop + r.height / 2 : (mids[i - 1] ?? 0) + ROW_HEIGHT);
    }
    dragRef.current = { from: pos, over: pos, mids };
    setDragFrom(pos);
    setDragOver(pos);
  }, []);
  const onDragMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const listTop = listRef.current?.getBoundingClientRect().top ?? 0;
    const over = slotForY(d.mids, e.clientY - listTop);
    if (over !== d.over) {
      d.over = over;
      setDragOver(over);
    }
  }, []);
  const endDrag = useCallback(() => {
    const d = dragRef.current;
    if (d && d.from !== d.over) {
      const { index: at, queue: q, moveInQueue } = usePlayerStore.getState();
      const title = q[at + 1 + d.from]?.title ?? 'Song';
      moveInQueue(at + 1 + d.from, at + 1 + d.over);
      setAnnouncement(`${title} moved to position ${d.over + 1} of ${q.length - at - 1}`);
    }
    dragRef.current = null;
    setDragFrom(null);
    setDragOver(null);
  }, []);

  // ---- Keyboard reorder and the row actions ------------------------------
  // Every one of these restores focus itself: re-ordering or removing a DOM
  // node blurs whatever had focus, and a queue you can only drive with a
  // mouse is not a queue everyone can drive.
  const refocus = useRef<Refocus>(null);

  /** Move the row with this key one slot, announce it, and keep focus on `target`. */
  const moveRow = useCallback((rowKey: string, delta: -1 | 1, target: 'grip' | 'menu') => {
    const pos = rowKeysRef.current.indexOf(rowKey);
    if (pos < 0) return;
    const { index: at, queue: q, moveInQueue } = usePlayerStore.getState();
    const count = q.length - at - 1;
    const to = pos + delta;
    if (to < 0 || to >= count) return;
    const title = q[at + 1 + pos]?.title ?? 'Song';
    refocus.current = { key: rowKey, target };
    moveInQueue(at + 1 + pos, at + 1 + to);
    setAnnouncement(`${title} moved to position ${to + 1} of ${count}`);
  }, []);

  /** Keyboard fallback on the handle: arrow keys nudge the row a slot. */
  const nudge = useCallback(
    (_pos: number, rowKey: string, e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      moveRow(rowKey, e.key === 'ArrowUp' ? -1 : 1, 'grip');
    },
    [moveRow],
  );
  const onMove = useCallback((rowKey: string, delta: -1 | 1) => moveRow(rowKey, delta, 'menu'), [moveRow]);

  const onPlay = useCallback((rowKey: string) => {
    const pos = rowKeysRef.current.indexOf(rowKey);
    if (pos < 0) return;
    const { index: at, playAt } = usePlayerStore.getState();
    playAt(at + 1 + pos);
  }, []);

  const onKeep = useCallback((rowKey: string) => {
    const pos = rowKeysRef.current.indexOf(rowKey);
    if (pos < 0) return;
    const { index: at, queue: q, keepSong } = usePlayerStore.getState();
    const target = q[at + 1 + pos];
    if (!target) return;
    refocus.current = { key: rowKey, target: 'menu' };
    keepSong(target.id);
    setAnnouncement(`${target.title} is yours now — it stays when the DJ picks change`);
    toast(`Keeping “${target.title}” — new DJ picks won’t replace it`);
  }, []);

  const onClearFrom = useCallback((rowKey: string) => {
    const pos = rowKeysRef.current.indexOf(rowKey);
    if (pos < 0) return;
    const { index: at, clearFrom } = usePlayerStore.getState();
    const above = rowKeysRef.current[pos - 1] ?? null;
    refocus.current = above ? { key: above, target: 'menu' } : { key: null, target: 'heading' };
    clearFrom(at + 1 + pos);
    setAnnouncement('Cleared the rest of the queue');
  }, []);

  const onRemove = useCallback((rowKey: string) => {
    const pos = rowKeysRef.current.indexOf(rowKey);
    if (pos < 0) return;
    const { index: at, queue: q, removeAt } = usePlayerStore.getState();
    const target = q[at + 1 + pos];
    if (!target) return;
    // Focus lands on the row that takes this one's place, else the one above.
    const nextKey = rowKeysRef.current[pos + 1] ?? rowKeysRef.current[pos - 1] ?? null;
    refocus.current = nextKey ? { key: nextKey, target: 'remove' } : { key: null, target: 'heading' };
    removeAt(at + 1 + pos);
    setAnnouncement(`Removed ${target.title}`);
    toast(`Removed “${target.title}”`, {
      duration: 8000,
      action: {
        label: 'Undo',
        onClick: () => {
          if (usePlayerStore.getState().undoRemove()) {
            refocus.current = { key: rowKey, target: 'remove' };
            setAnnouncement(`${target.title} is back in the queue`);
          } else {
            toast('Could not put it back — the queue has moved on');
          }
        },
      },
    });
  }, []);

  // Re-ordering DOM nodes can drop focus from the moved one (the browser
  // blurs a node that is re-inserted), and removing a row takes its button
  // with it. Put focus back where the listener was working — but only if it
  // was lost, so this can never steal focus from somewhere else.
  useLayoutEffect(() => {
    const want = refocus.current;
    if (!want) return;
    refocus.current = null;
    const active = document.activeElement;
    const list = listRef.current;
    if (active && active !== document.body && !list?.contains(active)) return;
    if (want.key === null) {
      headingRef.current?.focus({ preventScroll: true });
      return;
    }
    // Row keys carry a "#n" suffix for a repeated song, which an attribute
    // selector would have to escape — read the dataset instead.
    const row = Array.from(list?.querySelectorAll<HTMLElement>('[data-row-key]') ?? []).find((el) => el.dataset.rowKey === want.key);
    const el =
      want.target === 'grip'
        ? row?.querySelector<HTMLElement>('[data-reorder-key]')
        : want.target === 'menu'
          ? row?.querySelector<HTMLElement>('button[aria-haspopup="menu"]')
          : row?.querySelector<HTMLElement>('button[aria-label^="Remove"]');
    if (!el) return;
    if (document.activeElement !== el) el.focus({ preventScroll: true });
    el.scrollIntoView?.({ block: 'nearest' });
  }, [queue]);

  // ---- "Refresh up next": a deliberate rebuild, with its own states -------
  // `base` is how many automatic entries were left the moment the rebuild was
  // asked for (the player drops them synchronously): the wait ends when more
  // than that many are back, never merely because some already were.
  const [rebuild, setRebuild] = useState<{ phase: 'idle' | 'working' | 'failed'; base: number }>({ phase: 'idle', base: 0 });
  const rebuildTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(rebuildTimer.current), []);
  useEffect(() => {
    if (rebuild.phase === 'working' && mix.auto > rebuild.base) {
      window.clearTimeout(rebuildTimer.current);
      setRebuild({ phase: 'idle', base: 0 });
      setAnnouncement(`${mix.auto} new DJ ${mix.auto === 1 ? 'pick' : 'picks'} in the queue`);
    }
  }, [rebuild, mix.auto]);
  const regenerate = useCallback(() => {
    setAnnouncement('Refreshing up next. Songs you added stay.');
    const player = usePlayerStore.getState();
    player.regenerateAutoTail();
    setRebuild({ phase: 'working', base: player.autoTail().length });
    window.clearTimeout(rebuildTimer.current);
    rebuildTimer.current = window.setTimeout(
      () => setRebuild((r) => (r.phase === 'working' ? { ...r, phase: 'failed' } : r)),
      REBUILD_TIMEOUT_MS,
    );
  }, []);

  const total = upNext.length;
  const renderRow = useCallback(
    (s: Song, i: number) => {
      // 8.0 — the list reads in two runs: what the listener queued (their adds
      // and the list they started) and what the DJ picked. A title opens each run.
      const group = origins[i] === 'auto' ? 'dj' : 'yours';
      const prevGroup = i > 0 ? (origins[i - 1] === 'auto' ? 'dj' : 'yours') : null;
      return (
      <Fragment>
        {group !== prevGroup ? (
          <li key="group" role="presentation" className="vx-queue-group">
            {group === 'dj' ? 'Next from the DJ' : 'Next in queue'}
          </li>
        ) : null}
      <QueueRow
        key="row"
        song={s}
        pos={i}
        rowKey={rowKeys[i]}
        origin={origins[i]}
        reason={origins[i] === 'auto' ? reasons[s.id] : undefined}
        isFirst={i === 0}
        isLast={i === total - 1}
        dragging={dragFrom === i}
        dropEdge={dragFrom !== null && dragOver === i && dragFrom !== i ? (dragOver < dragFrom ? 'above' : 'below') : null}
        setRowEl={setRowEl}
        onDragStart={startDrag}
        onDragMove={onDragMove}
        onDragEnd={endDrag}
        onNudge={nudge}
        onMove={onMove}
        onKeep={onKeep}
        onClearFrom={onClearFrom}
        onRemove={onRemove}
        onPlay={onPlay}
      />
      </Fragment>
      );
    },
    [rowKeys, origins, reasons, total, dragFrom, dragOver, setRowEl, startDrag, onDragMove, endDrag, nudge, onMove, onKeep, onClearFrom, onRemove, onPlay],
  );
  const keyOfRow = useCallback((_s: Song, i: number) => rowKeys[i], [rowKeys]);

  // Package D5 — freeze this queue into a Collection the listener keeps.
  const saveAsPlaylist = (): void => {
    const name = window.prompt('Playlist name', 'My queue');
    if (!name || !name.trim()) return;
    const { createCollection, addToCollection } = useLibraryStore.getState();
    const cid = createCollection(name.trim());
    const seen = new Set<string>();
    let n = 0;
    for (const s of queue) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      addToCollection(cid, s);
      n += 1;
    }
    toast(`Saved ${n} songs to “${name.trim()}”`);
  };

  if (!queue.length) {
    return (
      <>
        {building && <Suspense fallback={null}><QueueBuilderSheet onClose={() => setBuilding(false)} /></Suspense>}
        <EmptyState
          icon={<QueueIcon className="w-8 h-8" />}
          title="Queue is empty"
          message="Play a song, album or playlist to start your queue — or let VinaX build one from your taste."
          action={
            <span className="flex flex-wrap gap-2 justify-center">
              <button onClick={() => setBuilding(true)} className="vx-tap px-5 py-2.5 rounded-full btn-primary">Build a queue</button>
              <Link to="/radio" className="vx-tap px-5 py-2.5 rounded-full btn-secondary inline-flex items-center">Start AI Radio</Link>
              <Link to="/" className="vx-tap px-5 py-2.5 rounded-full btn-secondary inline-flex items-center">Browse Home</Link>
            </span>
          }
        />
      </>
    );
  }

  // What a rebuild would replace, in the listener's own terms: only the DJ's picks.
  const rebuildNote =
    mix.auto > 0
      ? `Replaces the ${mix.auto} DJ ${mix.auto === 1 ? 'pick' : 'picks'} after this song. Songs you added, and the list you started, stay.`
      : 'Asks the DJ for songs that follow what’s playing. Songs you added, and the list you started, stay.';
  const canRebuild = !!song;

  return (
    <div className="vx-queue">
      {/* A sticky header: the title and the queue's actions stay in reach while the list scrolls. */}
      <header className="vx-queue-head">
        <div className="min-w-0">
          <h1>Queue</h1>
          <p>{djTakeover ? 'The DJ builds around what’s playing — the songs you add always stay' : 'Your selected songs, in order'}</p>
        </div>
        <div className="vx-queue-actions">
          <button onClick={() => setBuilding(true)} className="vx-queue-btn is-primary">Build a queue</button>
          {canRebuild && (
            <button
              type="button"
              onClick={regenerate}
              disabled={rebuild.phase === 'working'}
              aria-describedby="vx-rebuild-note"
              className="vx-queue-btn is-outline"
            >
              {rebuild.phase === 'working' ? 'Refreshing…' : 'Refresh up next'}
            </button>
          )}
          {queue.length >= 2 && (
            <button onClick={saveAsPlaylist} className="vx-queue-btn is-outline">
              Save as playlist
            </button>
          )}
        </div>
      </header>

      {/* now playing */}
      {song && (
        <section className="vx-queue-section" aria-labelledby="vx-queue-now-title">
          <h2 id="vx-queue-now-title" className="vx-queue-title mb-3">Now playing</h2>
          <div className="vx-queue-now vx-nowcard">
            <img
              src={bestImage(song.images, 120)}
              onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)}
              alt=""
              loading="lazy"
              decoding="async"
            />
            <div className="min-w-0 flex-1">
              <p className="vx-queue-now-title">{song.title}</p>
              <p className="vx-queue-now-meta">{song.subtitle}</p>
            </div>
            {isPlaying && (
              <span className="vx-eq mr-2" style={{ height: 16 }} aria-hidden>
                <i />
                <i />
                <i />
              </span>
            )}
          </div>
        </section>
      )}

      {/* 8.2.0 — Smart Queue: Autoplay + "DJ builds every queue" as one switch, explained. */}
      <SmartQueue />

      {/* v6.5.0 — tune chips */}
      <section aria-label="Tune this queue" className="vx-queue-tune">
        <TuneChips compact />
      </section>

      {/* Reorder, removal and rebuild results for screen readers — otherwise silent. */}
      <p role="status" aria-live="polite" className="sr-only">{announcement}</p>

      {/* up next — who queued what, and how to change it */}
      <section className="vx-queue-section" aria-labelledby="vx-queue-next-title">
        <div className="vx-queue-titlebar">
          <h2 id="vx-queue-next-title" ref={headingRef} tabIndex={-1} className="vx-queue-title">Up next</h2>
        </div>
        <p id="vx-rebuild-note" className="vx-queue-note">
          {mix.auto > 0 || mix.manual > 0 ? (
            <>
              {mix.auto > 0 && `${mix.auto} DJ ${mix.auto === 1 ? 'pick' : 'picks'}`}
              {mix.auto > 0 && mix.manual > 0 && ' · '}
              {mix.manual > 0 && `${mix.manual} added by you`}
              {'. '}
            </>
          ) : null}
          {canRebuild ? rebuildNote : 'Songs you add by hand play before anything the DJ picks.'}
        </p>
        {!online && (
          <p className="mb-3 rounded-lg bg-ink-850 px-3 py-2.5 text-[13px] text-ink-300">
            You’re offline. The queue keeps playing; new DJ picks need a connection.
          </p>
        )}
        {rebuild.phase === 'failed' && (
          <div role="alert" className="mb-3 flex items-center justify-between gap-3 rounded-lg bg-ink-850 px-3 py-2 text-[13px] text-ink-200">
            <span>Couldn’t refresh up next just now.</span>
            <button type="button" onClick={regenerate} className="vx-queue-btn is-outline shrink-0">
              Try again
            </button>
          </div>
        )}

        {/* D5 — sort the upcoming stretch; the playing song never moves. */}
        {upNext.length >= 3 && (
          <div className="flex gap-2 overflow-x-auto no-scrollbar mb-1 py-1 -mx-1 px-1" role="group" aria-label="Sort upcoming songs">
            {SORTS.map(([k, label]) => (
              <Chip
                key={k}
                onClick={() => {
                  usePlayerStore.getState().sortUpcoming(k);
                  toast(`Sorted upcoming by ${label.toLowerCase()}`);
                  setAnnouncement(`Upcoming songs sorted by ${label.toLowerCase()}`);
                }}
              >
                {label}
              </Chip>
            ))}
          </div>
        )}

        {upNext.length === 0 ? (
          rebuild.phase === 'working' ? (
            <p className="flex items-center gap-2 text-[15px] text-ink-300 py-4">
              <span className="w-4 h-4 rounded-full border-2 border-ink-600 border-t-ember-400 animate-spin" aria-hidden />
              Finding songs that follow this one…
            </p>
          ) : (
            <p className="text-[15px] text-ink-400 py-4">
              Nothing queued yet — use <span className="text-ink-100 font-semibold">Play next</span> or{' '}
              <span className="text-ink-100 font-semibold">Add to queue</span> in any song menu
              {canRebuild ? ', or use Refresh up next above.' : '.'}
            </p>
          )
        ) : (
          <ul ref={listRef} className="vx-queue-list">
            <VirtualChunks items={upNext} keyOf={keyOfRow} renderItem={renderRow} rowHeight={ROW_HEIGHT} />
          </ul>
        )}
      </section>
      {building && <Suspense fallback={null}><QueueBuilderSheet onClose={() => setBuilding(false)} /></Suspense>}
    </div>
  );
}
