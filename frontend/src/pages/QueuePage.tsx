import { lazy, memo, Suspense, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';

const QueueBuilderSheet = lazy(() => import('@/features/queue/QueueBuilderSheet').then((m) => ({ default: m.QueueBuilderSheet })));
import { usePageTitle } from '@/hooks/usePageTitle';
import { Link } from 'react-router-dom';
import { usePlayerStore, useCurrentSong } from '@/store/playerStore';
import { useLibraryStore } from '@/store/libraryStore';
import { EmptyState } from '@/components/States';
import { Chip } from '@/components/Chip';
import { occurrenceKeys, VirtualChunks } from '@/components/VirtualChunks';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { toast } from '@/store/toastStore';
import { TuneChips } from '@/features/queue/TuneChips';
import { useSettingsStore } from '@/store/settingsStore';
import { XIcon, QueueIcon, ChevronDownIcon, GripIcon } from '@/components/Icons';
import type { Song } from '@/types';

/** Row card (66px) + the list's 8px gap — the off-screen size estimate for list chunks. */
const ROW_HEIGHT = 74;

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
  isLast: boolean;
  dragging: boolean;
  dropEdge: DropEdge;
  setRowEl: (pos: number, el: HTMLLIElement | null) => void;
  onDragStart: (pos: number, e: React.PointerEvent<HTMLButtonElement>) => void;
  onDragMove: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
  onNudge: (pos: number, rowKey: string, e: React.KeyboardEvent<HTMLButtonElement>) => void;
}

/** Absolute queue index of an "Up next" position, read at call time so handlers never go stale. */
const absIndex = (pos: number): number => usePlayerStore.getState().index + 1 + pos;

/**
 * One "Up next" row. Memoised with stable handlers: a drag restyles the two
 * rows involved and a removal re-renders nothing above it.
 */
const QueueRow = memo(function QueueRow({ song: s, pos, rowKey, isLast, dragging, dropEdge, setRowEl, onDragStart, onDragMove, onDragEnd, onNudge }: QueueRowProps) {
  return (
    <li
      ref={(el) => setRowEl(pos, el)}
      className={`rounded-[18px] bg-[var(--tile)] border p-3 transition-shadow ${
        dragging
          ? 'border-ember-400/60 shadow-glow relative z-10 opacity-90'
          : dropEdge === 'above'
            ? 'border-[var(--glass-border)] shadow-[0_-3px_0_0_rgb(var(--ember-500))]'
            : dropEdge === 'below'
              ? 'border-[var(--glass-border)] shadow-[0_3px_0_0_rgb(var(--ember-500))]'
              : 'border-[var(--glass-border)]'
      }`}
    >
      <div className="flex items-center gap-2.5">
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
          className={`relative after:absolute after:inset-0 after:-m-[8px] p-1.5 -ml-1 rounded-lg shrink-0 cursor-grab active:cursor-grabbing text-ink-500 hover:text-ink-200 hover:bg-[var(--tile-hover)] ${dragging ? 'text-ember-400' : ''}`}
          style={{ touchAction: 'none' }}
        >
          <GripIcon className="w-4 h-4" />
        </button>
        <button type="button" onClick={() => usePlayerStore.getState().playAt(absIndex(pos))} className="flex items-center gap-3 min-w-0 flex-1 text-left">
          <img
            src={bestImage(s.images, 96)}
            onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)}
            alt=""
            loading="lazy"
            decoding="async"
            className="w-[42px] h-[42px] rounded-[10px] object-cover shrink-0"
          />
          <span className="min-w-0">
            <span className="block text-[13px] font-bold truncate">{s.title}</span>
            <span className="block text-[11px] font-semibold text-ink-400 truncate">{s.subtitle}</span>
          </span>
        </button>
        {!isLast && (
          <button
            type="button"
            onClick={() => usePlayerStore.getState().clearFrom(absIndex(pos))}
            aria-label={`Clear the queue from ${s.title} down`}
            title="Clear from here down"
            className="p-1.5 rounded-full text-ink-500 hover:text-ink-100 hover:bg-[var(--tile-hover)] shrink-0 relative after:absolute after:inset-0 after:-m-[8px]"
          >
            <ChevronDownIcon className="w-4 h-4" />
          </button>
        )}
        <button
          type="button"
          onClick={() => usePlayerStore.getState().removeAt(absIndex(pos))}
          aria-label={`Remove ${s.title} from queue`}
          className="p-1.5 rounded-full text-ink-400 hover:text-ink-100 hover:bg-[var(--tile-hover)] shrink-0 relative after:absolute after:inset-0 after:-m-[8px]"
        >
          <XIcon className="w-4 h-4" />
        </button>
      </div>
    </li>
  );
});

export default function QueuePage() {
  usePageTitle('Queue');
  const queue = usePlayerStore((s) => s.queue);
  const djTakeover = useSettingsStore((s) => s.djTakeover);
  const index = usePlayerStore((s) => s.index);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const song = useCurrentSong();
  const upNext = useMemo(() => queue.slice(index + 1), [queue, index]);
  // Index-free keys, numbered over the WHOLE queue so they also survive the
  // playing song advancing. `${id}-${index}` remounted the moved row on every
  // keyboard step (dropping focus) and every row below a removed one.
  const rowKeys = useMemo(() => occurrenceKeys(queue.map((s) => s.id)).slice(index + 1), [queue, index]);
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
  const setRowEl = useCallback((pos: number, el: HTMLLIElement | null) => {
    rowRefs.current[pos] = el;
  }, []);

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
      moveInQueue(at + 1 + d.from, at + 1 + d.over);
      setAnnouncement(`Moved to position ${d.over + 1} of ${q.length - at - 1}`);
    }
    dragRef.current = null;
    setDragFrom(null);
    setDragOver(null);
  }, []);

  /** Keyboard fallback on the handle: arrow keys nudge the row a slot. */
  const refocusKey = useRef<string | null>(null);
  const nudge = useCallback((pos: number, rowKey: string, e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const { index: at, queue: q, moveInQueue } = usePlayerStore.getState();
    const count = q.length - at - 1;
    const to = e.key === 'ArrowUp' ? pos - 1 : pos + 1;
    if (to < 0 || to >= count) return;
    refocusKey.current = rowKey;
    moveInQueue(at + 1 + pos, at + 1 + to);
    setAnnouncement(`Moved to position ${to + 1} of ${count}`);
  }, []);
  // Re-ordering DOM nodes can drop focus from the moved one (the browser
  // blurs a node that is re-inserted). Put it back on the same handle so
  // repeated arrow presses keep working.
  useLayoutEffect(() => {
    const key = refocusKey.current;
    if (!key) return;
    refocusKey.current = null;
    const handles = listRef.current?.querySelectorAll<HTMLButtonElement>('[data-reorder-key]') ?? [];
    for (const h of handles) {
      if (h.dataset.reorderKey === key) {
        if (document.activeElement !== h) h.focus({ preventScroll: true });
        h.scrollIntoView?.({ block: 'nearest' });
        break;
      }
    }
  }, [queue]);

  const total = upNext.length;
  const renderRow = useCallback(
    (s: Song, i: number) => (
      <QueueRow
        song={s}
        pos={i}
        rowKey={rowKeys[i]}
        isLast={i === total - 1}
        dragging={dragFrom === i}
        dropEdge={dragFrom !== null && dragOver === i && dragFrom !== i ? (dragOver < dragFrom ? 'above' : 'below') : null}
        setRowEl={setRowEl}
        onDragStart={startDrag}
        onDragMove={onDragMove}
        onDragEnd={endDrag}
        onNudge={nudge}
      />
    ),
    [rowKeys, total, dragFrom, dragOver, setRowEl, startDrag, onDragMove, endDrag, nudge],
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
              <button onClick={() => setBuilding(true)} className="px-5 py-2.5 rounded-full btn-primary">Build a queue</button>
              <Link to="/" className="px-5 py-2.5 rounded-full btn-secondary">Browse Home</Link>
            </span>
          }
        />
      </>
    );
  }

  return (
    <div className="max-w-2xl mx-auto pb-8">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-extrabold tracking-tight">Queue</h1>
          <p className="text-xs font-semibold text-ink-400 mb-4">{djTakeover ? 'AI DJ · builds around what’s playing' : 'Your selected songs, in order'}</p>
        </div>
        <div className="flex gap-2 shrink-0 mt-1">
          <button onClick={() => setBuilding(true)} className="px-4 py-2 rounded-full btn-primary text-xs font-bold">Build a queue</button>
          {queue.length >= 2 && (
            <button onClick={saveAsPlaylist} className="px-4 py-2 rounded-full glass-button text-xs font-bold">
              Save as playlist
            </button>
          )}
        </div>
      </div>
      {building && <Suspense fallback={null}><QueueBuilderSheet onClose={() => setBuilding(false)} /></Suspense>}

      {/* v6.5.0 — tune chips */}
      <section aria-label="Tune this queue" className="mb-5">
        <h2 className="text-[11px] font-extrabold tracking-[0.22em] text-ink-400 uppercase mb-2">Tune this queue</h2>
        <TuneChips />
      </section>

      {/* now playing */}
      {song && (
        <div
          className="vx-nowcard rounded-2xl border border-[var(--glass-border)] p-3.5 flex items-center gap-3 mb-6"
        >
          <img
            src={bestImage(song.images, 120)}
            onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)}
            alt=""
            loading="lazy"
            decoding="async"
            className="w-12 h-12 rounded-xl object-cover shrink-0"
          />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-extrabold truncate">{song.title}</p>
            <p className="text-[11px] font-semibold text-ink-300">Now playing</p>
          </div>
          {isPlaying && (
            <span className="vx-eq" style={{ height: 16 }} aria-hidden>
              <i />
              <i />
              <i />
            </span>
          )}
        </div>
      )}

      {/* Reorder results for screen readers — a moved row is otherwise silent. */}
      <p role="status" aria-live="polite" className="sr-only">{announcement}</p>

      {/* up next — and why */}
      <div className="flex items-center justify-between mb-2.5 gap-2">
        <h2 className="text-base font-extrabold">Up next</h2>
        {/* D5 — sort the upcoming stretch; the playing song never moves. */}
        {upNext.length >= 3 && (
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar" role="group" aria-label="Sort upcoming songs">
            {SORTS.map(([k, label]) => (
              <Chip
                key={k}
                onClick={() => {
                  usePlayerStore.getState().sortUpcoming(k);
                  toast(`Sorted upcoming by ${label.toLowerCase()}`);
                }}
              >
                {label}
              </Chip>
            ))}
          </div>
        )}
      </div>
      {upNext.length === 0 ? (
        <p className="text-sm text-ink-400">Nothing queued — add songs using Play next or Add to queue.</p>
      ) : (
        <ul ref={listRef} className="space-y-2">
          <VirtualChunks items={upNext} keyOf={keyOfRow} renderItem={renderRow} rowHeight={ROW_HEIGHT} chunkClassName="space-y-2" />
        </ul>
      )}
    </div>
  );
}
