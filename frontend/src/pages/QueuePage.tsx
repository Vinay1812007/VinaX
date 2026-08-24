import { useRef, useState } from 'react';
import { usePageTitle } from '@/hooks/usePageTitle';
import { Link } from 'react-router-dom';
import { usePlayerStore, useCurrentSong } from '@/store/playerStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useReasonStore } from '@/store/reasonStore';
import { EmptyState } from '@/components/States';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { toast } from '@/store/toastStore';
import { XIcon, QueueIcon, ChevronDownIcon, GripIcon } from '@/components/Icons';
import { TUNE_OPTIONS, type TuneIntent } from '@/services/recommendation/tune';

const TUNES: Array<{ intent: TuneIntent; label: string }> = TUNE_OPTIONS.filter((o) => o.id !== 'surprise').map(
  (o) => ({ intent: o.id, label: o.label }),
);

/** Canvas 4d — Queue with the AI DJ: tuning chips, teal now-playing card,
 *  and "Up next — and why" rows carrying the DJ's real reasons. */
export default function QueuePage() {
  usePageTitle('Queue');
  const queue = usePlayerStore((s) => s.queue);
  const index = usePlayerStore((s) => s.index);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const playAt = usePlayerStore((s) => s.playAt);
  const removeAt = usePlayerStore((s) => s.removeAt);
  const clearFrom = usePlayerStore((s) => s.clearFrom);
  const sortUpcoming = usePlayerStore((s) => s.sortUpcoming);
  const moveInQueue = usePlayerStore((s) => s.moveInQueue);
  const tuneQueue = usePlayerStore((s) => s.tuneQueue);
  const song = useCurrentSong();
  const reasons = useReasonStore((s) => s.reasons);
  const upNext = queue.slice(index + 1);

  // ---- Drag-to-reorder (pointer events, zero deps) -----------------------
  // dragFrom/dragOver are 0-based positions within upNext; the store call
  // translates to absolute queue indexes. Works for touch AND mouse: the
  // handle sets touch-action:none so the gesture never fights page scroll.
  // Gesture truth lives in refs (pointer events outrun React state); the
  // mirrored state exists only so the rows restyle while dragging.
  const dragRef = useRef<{ from: number; over: number } | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const rowRefs = useRef<Array<HTMLLIElement | null>>([]);

  const slotFromY = (clientY: number): number => {
    const rows = rowRefs.current.filter(Boolean) as HTMLLIElement[];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i].getBoundingClientRect();
      if (clientY < r.top + r.height / 2) return i;
    }
    return Math.max(rows.length - 1, 0);
  };

  const startDrag = (i: number) => (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = { from: i, over: i };
    setDragFrom(i);
    setDragOver(i);
  };
  const onDragMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const over = slotFromY(e.clientY);
    if (over !== d.over) {
      d.over = over;
      setDragOver(over);
    }
  };
  const endDrag = () => {
    const d = dragRef.current;
    if (d && d.from !== d.over) {
      moveInQueue(index + 1 + d.from, index + 1 + d.over);
    }
    dragRef.current = null;
    setDragFrom(null);
    setDragOver(null);
  };
  /** Keyboard fallback on the handle: arrow keys nudge the row a slot. */
  const nudge = (i: number) => (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const to = e.key === 'ArrowUp' ? i - 1 : i + 1;
    if (to < 0 || to >= upNext.length) return;
    moveInQueue(index + 1 + i, index + 1 + to);
  };

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

  const tune = (intent: TuneIntent, label: string): void => {
    tuneQueue(intent);
    toast(`${label} — retuning what's next`);
  };
  const surprise = (): void => {
    const pick = TUNES[Math.floor(Math.random() * TUNES.length)];
    tuneQueue(pick.intent);
    toast('Surprise coming up ✦');
  };

  if (!queue.length) {
    return (
      <EmptyState
        icon={<QueueIcon className="w-8 h-8" />}
        title="Queue is empty"
        message="Play something and the AI DJ will build around it."
        action={<Link to="/" className="px-5 py-2.5 rounded-full btn-primary">Browse Home</Link>}
      />
    );
  }

  return (
    <div className="max-w-2xl mx-auto pb-8">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-extrabold tracking-tight">Queue</h1>
          <p className="text-xs font-semibold text-ink-400 mb-4">AI DJ · builds around what&rsquo;s playing</p>
        </div>
        {queue.length >= 2 && (
          <button
            onClick={saveAsPlaylist}
            className="shrink-0 mt-1 px-4 py-2 rounded-full glass-button text-xs font-bold"
          >
            Save as playlist
          </button>
        )}
      </div>

      {/* tune chips */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <button
          onClick={surprise}
          className="h-[38px] px-4 rounded-full text-xs font-extrabold text-ink-100 border border-ember-400/30 transition active:scale-95"
          style={{ background: 'linear-gradient(135deg, rgba(34,211,238,0.22), rgba(96,165,250,0.14))' }}
        >
          ✦ Surprise me
        </button>
        {TUNES.map((t) => (
          <button
            key={t.intent}
            onClick={() => tune(t.intent, t.label)}
            className="h-[38px] px-4 rounded-full text-xs font-bold bg-[var(--tile)] border border-[var(--glass-border)] text-ink-200 hover:bg-[var(--tile-hover)] transition active:scale-95"
          >
            {t.label}
          </button>
        ))}
      </div>

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

      {/* up next — and why */}
      <div className="flex items-center justify-between mb-2.5 gap-2">
        <h2 className="text-base font-extrabold">Up next — and why</h2>
        {/* D5 — sort the upcoming stretch; the playing song never moves. */}
        {upNext.length >= 3 && (
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar" role="group" aria-label="Sort upcoming songs">
            {(
              [
                ['energy', 'Energy'],
                ['calm', 'Calm first'],
                ['new', 'Newest'],
                ['old', 'Classics'],
                ['mood', 'Mood arc'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => {
                  sortUpcoming(k);
                  toast(`Sorted upcoming by ${label.toLowerCase()}`);
                }}
                className="shrink-0 px-2.5 py-1 rounded-full text-[10px] font-bold bg-[var(--tile)] border border-[var(--glass-border)] text-ink-300 hover:text-ink-100 transition active:scale-95"
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      {upNext.length === 0 ? (
        <p className="text-sm text-ink-400">Nothing queued — tap a tune chip and the DJ fills it.</p>
      ) : (
        <ul className="space-y-2">
          {upNext.map((s, i) => {
            const realIndex = index + 1 + i;
            const why = reasons[s.id] ?? 'Fits the vibe you’ve been building';
            const dragging = dragFrom === i;
            const dropTarget = dragFrom !== null && dragOver === i && dragFrom !== i;
            return (
              <li
                key={`${s.id}-${realIndex}`}
                ref={(el) => {
                  rowRefs.current[i] = el;
                }}
                className={`rounded-[18px] bg-[var(--tile)] border p-3 transition-shadow ${
                  dragging
                    ? 'border-ember-400/60 shadow-glow relative z-10 opacity-90'
                    : dropTarget
                      ? dragOver !== null && dragFrom !== null && dragOver < dragFrom
                        ? 'border-[var(--glass-border)] shadow-[0_-3px_0_0_rgb(var(--ember-500))]'
                        : 'border-[var(--glass-border)] shadow-[0_3px_0_0_rgb(var(--ember-500))]'
                      : 'border-[var(--glass-border)]'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <button
                    onPointerDown={startDrag(i)}
                    onPointerMove={onDragMove}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    onKeyDown={nudge(i)}
                    aria-label={`Reorder ${s.title} — drag, or use arrow keys`}
                    title="Drag to reorder"
                    className={`p-1.5 -ml-1 rounded-lg shrink-0 cursor-grab active:cursor-grabbing text-ink-500 hover:text-ink-200 hover:bg-[var(--tile-hover)] ${dragging ? 'text-ember-400' : ''}`}
                    style={{ touchAction: 'none' }}
                  >
                    <GripIcon className="w-4 h-4" />
                  </button>
                  <button onClick={() => playAt(realIndex)} className="flex items-center gap-3 min-w-0 flex-1 text-left">
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
                  {i < upNext.length - 1 && (
                    <button
                      onClick={() => clearFrom(realIndex)}
                      aria-label={`Clear the queue from ${s.title} down`}
                      title="Clear from here down"
                      className="p-1.5 rounded-full text-ink-500 hover:text-ink-100 hover:bg-[var(--tile-hover)] shrink-0 relative after:absolute after:inset-0 after:-m-[8px]"
                    >
                      <ChevronDownIcon className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={() => removeAt(realIndex)}
                    aria-label={`Remove ${s.title} from queue`}
                    className="p-1.5 rounded-full text-ink-400 hover:text-ink-100 hover:bg-[var(--tile-hover)] shrink-0 relative after:absolute after:inset-0 after:-m-[8px]"
                  >
                    <XIcon className="w-4 h-4" />
                  </button>
                </div>
                <p className="vx-reason mt-2 rounded-[11px] px-2.5 py-1.5 text-[11px] font-semibold truncate">{why}</p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
