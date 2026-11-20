import { Fragment, memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { songLine } from '@/utils/songLine';
import { usePageTitle } from '@/hooks/usePageTitle';
import { usePlayerStore, useCurrentSong, type QueueRun } from '@/store/playerStore';
import { useHistoryStore } from '@/store/historyStore';
import { useSettingsStore } from '@/store/settingsStore';
import { EmptyState } from '@/components/States';
import { occurrenceKeys, VirtualChunks } from '@/components/VirtualChunks';
import { TrackMenu, type TrackMenuItem } from '@/components/TrackMenu';
import { Toggle } from '@/features/settings/SettingsControls';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { toast } from '@/store/toastStore';
import { cn } from '@/utils/cn';
import { XIcon, QueueIcon, GripIcon, ShuffleIcon, RepeatIcon } from '@/components/Icons';
import type { Song } from '@/types';
import '@/styles/pages/player.css';

/**
 * 1.20 — the Queue, rebuilt to read and work like Spotify's.
 *
 *   Now playing
 *   Next in queue        songs you added (Add to queue) · Clear queue
 *   Next from: <list>    the rest of the album, playlist or page you played
 *   Autoplay             similar songs once your list ends
 *
 * A second tab, Recently played, lists what this device played. The rules
 * behind every action live in store/queueRules.ts: tap a row to play it, drag
 * (or arrow keys on the handle) to reorder — a row dropped among Next in queue
 * becomes a song you added — and × to remove it.
 */

/** One row (48px art + two lines, 6px padding) — the off-screen size estimate for list chunks. */
const ROW_HEIGHT = 68;
/** How many plays Recently played lists. */
const RECENT_MAX = 50;

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

type DropEdge = 'above' | 'below' | null;

interface QueueRowProps {
  song: Song;
  /** 0-based position after the playing song. */
  pos: number;
  rowKey: string;
  isFirst: boolean;
  isLast: boolean;
  dragging: boolean;
  dropEdge: DropEdge;
  setRowEl: (pos: number, el: HTMLLIElement | null) => void;
  onDragStart: (pos: number, e: React.PointerEvent<HTMLButtonElement>) => void;
  onDragMove: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
  onNudge: (rowKey: string, e: React.KeyboardEvent<HTMLButtonElement>) => void;
  onMove: (rowKey: string, delta: -1 | 1) => void;
  onRemove: (rowKey: string) => void;
  onPlay: (rowKey: string) => void;
}

/**
 * One upcoming row. Memoised with stable handlers: a drag restyles the two
 * rows involved and a removal re-renders nothing above it. Positions are
 * looked up by row key when an action runs, never captured, so a queue that
 * moved on under an open menu cannot move the wrong song.
 */
const QueueRow = memo(function QueueRow({
  song: s,
  pos,
  rowKey,
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
  onRemove,
  onPlay,
}: QueueRowProps) {
  const line = songLine(s);
  const menuItems: TrackMenuItem[] = [
    { label: 'Remove from queue', action: () => onRemove(rowKey) },
    ...(isFirst ? [] : [{ label: 'Move up', action: () => onMove(rowKey, -1) }]),
    ...(isLast ? [] : [{ label: 'Move down', action: () => onMove(rowKey, 1) }]),
  ];
  return (
    <li
      ref={(el) => setRowEl(pos, el)}
      data-row-key={rowKey}
      className={cn('vx-queue-row', dragging ? 'is-dragging' : dropEdge === 'above' ? 'drop-above' : dropEdge === 'below' ? 'drop-below' : '')}
    >
      <div className="vx-queue-row-main">
        <button
          type="button"
          data-reorder-key={rowKey}
          onPointerDown={(e) => onDragStart(pos, e)}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
          onKeyDown={(e) => onNudge(rowKey, e)}
          aria-label={`Reorder ${s.title} — drag, or use arrow keys`}
          title="Drag to reorder"
          // 28px grip, 44px hit area (IconButton's invisible-pad pattern).
          className="vx-queue-grip after:absolute after:inset-0 after:-m-[8px]"
        >
          <GripIcon className="w-4 h-4" />
        </button>
        <button type="button" onClick={() => onPlay(rowKey)} className="vx-queue-play">
          <img src={bestImage(s.images, 96)} onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)} alt="" loading="lazy" decoding="async" />
          <span className="vx-queue-row-text">
            <span className="vx-queue-row-title font-bold">{line.title}</span>
            <span className="vx-queue-row-meta">{[line.album, line.artist].filter(Boolean).join(' – ')}</span>
          </span>
        </button>
        <span className="vx-queue-row-end">
          <TrackMenu song={s} label={`More options for ${s.title}`} leadItems={menuItems} />
          <button type="button" onClick={() => onRemove(rowKey)} aria-label={`Remove ${s.title} from queue`} title="Remove from queue" className="vx-queue-remove">
            <XIcon className="w-4 h-4" />
          </button>
        </span>
      </div>
    </li>
  );
});

/** Where focus goes after the list re-orders or loses the control that had it. */
type Refocus = { key: string; target: 'grip' | 'menu' | 'remove' } | { key: null; target: 'heading' } | null;

/** The section a run opens, in words (never colour alone). */
function SectionHead({ run, onClear }: { run: QueueRun; onClear: () => void }) {
  const context = usePlayerStore((s) => s.context);
  if (run === 'queued') {
    return (
      <li role="presentation" className="vx-queue-group">
        <span className="vx-queue-group-title">Next in queue</span>
        <button type="button" onClick={onClear} className="vx-queue-group-action">
          Clear queue
        </button>
      </li>
    );
  }
  if (run === 'context') {
    return (
      <li role="presentation" className="vx-queue-group">
        <span className="vx-queue-group-title">
          Next from: {context?.path ? <Link to={context.path}>{context.label}</Link> : context?.label ?? 'your list'}
        </span>
      </li>
    );
  }
  return (
    <li role="presentation" className="vx-queue-group is-auto">
      <span className="vx-queue-group-title">Autoplay</span>
      <span className="vx-queue-group-note">Similar songs play when your music ends</span>
    </li>
  );
}

/** Recently played: what this device played, newest first. A tap plays the song. */
function RecentlyPlayed() {
  const entries = useHistoryStore((s) => s.entries);
  const recent = useMemo(() => entries.slice(0, RECENT_MAX), [entries]);
  if (!recent.length) return <p className="vx-queue-empty">Songs you play show up here.</p>;
  return (
    <ul className="vx-queue-list">
      {recent.map((e) => {
        const line = songLine(e.song);
        return (
          <li key={e.ts} className="vx-queue-row is-played">
            <div className="vx-queue-row-main">
              <button type="button" onClick={() => usePlayerStore.getState().playSong(e.song)} className="vx-queue-play" title="Play">
                <img src={bestImage(e.song.images, 96)} onError={(ev) => ((ev.target as HTMLImageElement).src = FALLBACK_ART)} alt="" loading="lazy" decoding="async" />
                <span className="vx-queue-row-text">
                  <span className="vx-queue-row-title font-bold">{line.title}</span>
                  <span className="vx-queue-row-meta">{[line.album, line.artist].filter(Boolean).join(' – ')}</span>
                </span>
              </button>
              <span className="vx-queue-row-end">
                <TrackMenu song={e.song} label={`More options for ${e.song.title}`} />
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default function QueuePage() {
  usePageTitle('Queue');
  const queue = usePlayerStore((s) => s.queue);
  const runs = usePlayerStore((s) => s.runs);
  const index = usePlayerStore((s) => s.index);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const repeat = usePlayerStore((s) => s.repeat);
  const autoplayLoading = usePlayerStore((s) => s.autoplayLoading);
  const following = usePlayerStore((s) => s.followMode);
  const autoplay = useSettingsStore((s) => s.autoplay);
  const song = useCurrentSong();
  const [tab, setTab] = useState<'queue' | 'recent'>('queue');
  const upNext = useMemo(() => queue.slice(index + 1), [queue, index]);
  const upRuns = useMemo(() => runs.slice(index + 1), [runs, index]);
  // Index-free keys, numbered over the WHOLE queue so they survive the playing
  // song advancing: a moved row is the same DOM node (focus stays on it).
  const allKeys = useMemo(() => occurrenceKeys(queue.map((s) => s.id)), [queue]);
  const rowKeys = useMemo(() => allKeys.slice(index + 1), [allKeys, index]);
  const rowKeysRef = useRef(rowKeys);
  rowKeysRef.current = rowKeys;
  /** Spoken through the polite live region below — reorders are otherwise silent. */
  const [announcement, setAnnouncement] = useState('');

  // ---- Drag-to-reorder (pointer events, zero deps) -----------------------
  // Positions are 0-based within what comes next; the store gets absolute
  // indexes. Row geometry is snapshotted once at drag start and
  // binary-searched per move.
  const dragRef = useRef<{ from: number; over: number; mids: number[] } | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const rowRefs = useRef<Array<HTMLLIElement | null>>([]);
  const listRef = useRef<HTMLUListElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
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
      const title = q[at + 1 + d.from]?.title ?? 'Song';
      moveInQueue(at + 1 + d.from, at + 1 + d.over);
      setAnnouncement(`${title} moved to position ${d.over + 1} of ${q.length - at - 1}`);
    }
    dragRef.current = null;
    setDragFrom(null);
    setDragOver(null);
  }, []);

  // ---- Keyboard reorder and the row actions ------------------------------
  // Each restores focus itself: re-ordering or removing a DOM node blurs
  // whatever had focus.
  const refocus = useRef<Refocus>(null);

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
  const nudge = useCallback(
    (rowKey: string, e: React.KeyboardEvent<HTMLButtonElement>) => {
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
    refocus.current = { key: null, target: 'heading' };
    playAt(at + 1 + pos);
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
  }, []);

  // Spotify's "Clear queue": only the songs you added go.
  const clearQueued = useCallback(() => {
    const { runs: r, index: at, clearUserQueue } = usePlayerStore.getState();
    const n = r.slice(at + 1).filter((x) => x === 'queued').length;
    if (!n) return;
    refocus.current = { key: null, target: 'heading' };
    clearUserQueue();
    setAnnouncement('Cleared the queue');
    toast(n === 1 ? 'Cleared 1 song from your queue' : `Cleared ${n} songs from your queue`);
  }, []);

  // Put focus back where the listener was working — only if it was lost.
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
    // Row keys carry a "#n" suffix for a repeated song: read the dataset, not a selector.
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

  const total = upNext.length;
  const renderRow = useCallback(
    (s: Song, i: number) => {
      const run = upRuns[i] ?? 'context';
      const opens = i === 0 || upRuns[i - 1] !== run;
      return (
        <Fragment>
          {opens ? <SectionHead key="head" run={run} onClear={clearQueued} /> : null}
          <QueueRow
            key="row"
            song={s}
            pos={i}
            rowKey={rowKeys[i]}
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
            onRemove={onRemove}
            onPlay={onPlay}
          />
        </Fragment>
      );
    },
    [upRuns, rowKeys, total, dragFrom, dragOver, setRowEl, startDrag, onDragMove, endDrag, nudge, onMove, onRemove, onPlay, clearQueued],
  );
  const keyOfRow = useCallback((_s: Song, i: number) => rowKeys[i], [rowKeys]);

  const tabs = (
    <div role="tablist" aria-label="Queue views" className="vx-queue-tabs">
      {(
        [
          ['queue', 'Queue'],
          ['recent', 'Recently played'],
        ] as const
      ).map(([id, label]) => (
        <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cn('vx-queue-tab', tab === id && 'is-on')}>
          {label}
        </button>
      ))}
    </div>
  );

  if (!queue.length && tab === 'queue') {
    return (
      <div className="vx-queue">
        <header className="vx-queue-head">
          <h1>Queue</h1>
          {tabs}
        </header>
        <EmptyState
          icon={<QueueIcon className="w-8 h-8" />}
          title="Your queue is empty"
          message="Play a song, album or playlist, or use Add to queue in any song menu."
          action={
            <span className="flex flex-wrap gap-2 justify-center">
              <Link to="/" className="vx-tap px-5 py-2.5 rounded-full btn-primary inline-flex items-center">Browse Home</Link>
              <Link to="/radio" className="vx-tap px-5 py-2.5 rounded-full btn-secondary inline-flex items-center">Start radio</Link>
            </span>
          }
        />
      </div>
    );
  }

  const cycleRepeat = (): void => {
    const st = usePlayerStore.getState();
    st.cycleRepeat();
    const now = usePlayerStore.getState().repeat;
    setAnnouncement(now === 'off' ? 'Repeat off' : now === 'all' ? 'Repeat on' : 'Repeat one song');
  };

  return (
    <div className="vx-queue">
      {/* Reorders and removals for screen readers — otherwise silent. */}
      <p role="status" aria-live="polite" className="sr-only">{announcement}</p>

      <header className="vx-queue-head">
        <h1>Queue</h1>
        {tabs}
      </header>

      {tab === 'recent' ? (
        <section className="vx-queue-section" aria-label="Recently played">
          <RecentlyPlayed />
        </section>
      ) : (
        <>
          {song && (
            <section className="vx-queue-section" aria-labelledby="vx-queue-now-title">
              <h2 id="vx-queue-now-title" className="vx-queue-title mb-3">Now playing</h2>
              <div className="vx-queue-now">
                <span className="vx-queue-now-art">
                  <img src={bestImage(song.images, 150)} onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)} alt="" loading="lazy" decoding="async" />
                </span>
                <div className="vx-queue-now-text">
                  <p className="vx-queue-now-title">{song.title}</p>
                  <p className="vx-queue-now-meta">{song.subtitle}</p>
                  <p className="vx-queue-now-state">
                    {isPlaying ? (
                      <>
                        <span className="vx-eq" aria-hidden>
                          <i />
                          <i />
                          <i />
                        </span>
                        Playing
                      </>
                    ) : (
                      'Paused'
                    )}
                  </p>
                </div>
                <Link to="/now-playing" className="vx-queue-now-open">
                  Open player
                </Link>
              </div>
            </section>
          )}

          <section className="vx-queue-section" aria-labelledby="vx-queue-next-title">
            <div className="vx-queue-titlebar">
              <h2 id="vx-queue-next-title" ref={headingRef} tabIndex={-1} className="vx-queue-title">
                Up next
              </h2>
              {/* Spotify keeps shuffle and repeat with the queue. A Listen Together guest's queue is the room's. */}
              {!following && (
                <span className="vx-queue-modes">
                  <button type="button" onClick={() => usePlayerStore.getState().toggleShuffle()} aria-pressed={shuffle} aria-label="Shuffle" title="Shuffle" className={cn('vx-queue-mode', shuffle && 'is-on')}>
                    <ShuffleIcon className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={cycleRepeat}
                    aria-pressed={repeat !== 'off'}
                    aria-label={repeat === 'one' ? 'Repeat one song' : repeat === 'all' ? 'Repeat' : 'Repeat off'}
                    title="Repeat"
                    className={cn('vx-queue-mode', repeat !== 'off' && 'is-on')}
                  >
                    <RepeatIcon className="w-5 h-5" />
                    {repeat === 'one' && <span className="vx-queue-mode-one" aria-hidden>1</span>}
                  </button>
                </span>
              )}
            </div>

            {upNext.length === 0 ? (
              <p className="vx-queue-empty">
                {autoplayLoading ? (
                  <>
                    <span className="vx-np-spinner" aria-hidden />
                    Autoplay is finding songs like this one…
                  </>
                ) : (
                  <span>
                    Nothing up next. Use <b>Add to queue</b> in any song menu.
                  </span>
                )}
              </p>
            ) : (
              <ul ref={listRef} className="vx-queue-list">
                <VirtualChunks items={upNext} keyOf={keyOfRow} renderItem={renderRow} rowHeight={ROW_HEIGHT} />
              </ul>
            )}
          </section>

          {/* Spotify's Autoplay switch: similar songs when the music ends. */}
          {!following && (
            <section className="vx-queue-section vx-queue-autoplay" aria-label="Autoplay">
              <div className="min-w-0">
                <p className="vx-queue-autoplay-title">Autoplay</p>
                <p className="vx-queue-note">
                  {repeat !== 'off' ? 'Paused while repeat is on.' : 'When your music ends, keep playing similar songs.'}
                </p>
              </div>
              <Toggle on={autoplay} onChange={(v) => useSettingsStore.getState().setAutoplay(v)} label="Autoplay" />
            </section>
          )}
        </>
      )}
    </div>
  );
}
