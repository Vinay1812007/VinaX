import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import { toast } from '@/store/toastStore';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useDismissOnBack } from '@/hooks/useDismissOnBack';
import { fetchPickMatch, parseSongLine, pickQueryKey, type MatchResult, type SongPickRef } from '@/components/ai/SongPick';
import { cn } from '@/utils/cn';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import type { Song } from '@/types';

/**
 * v5.12.0 — Import a playlist from text. Paste anything list-shaped — a chat
 * reply, a screenshot's text, an exported list — one song per line as
 * "Title — Artist" (or "Title - Artist", or just a title) and VinaX resolves
 * each line to the real catalogue song and saves them as a playlist. Reuses
 * the same resolver the AI chat's song cards use.
 *
 * v6.1.0 — a REVIEW step: nothing is saved until the listener has seen what
 * each line resolved to. Matched, closest-match and not-found lines are
 * labelled; each can be swapped for an alternative, retried with an edited
 * query, skipped, or inspected against the original pasted text.
 *
 * Cancellation: Cancel, tapping the backdrop, Android back, navigating away
 * and unmount all abort the in-flight lookups AND invalidate the run, so a
 * lookup that finishes late can never create a collection or replace the
 * queue behind the listener's back.
 */
export interface ParsedLine extends SongPickRef {
  /** The pasted line, untouched. */
  raw: string;
}

export function parseLines(text: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  const seen = new Set<string>();
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/^\s*(?:[-*•]\s*|\d+[.)]\s*)/, '').trim();
    if (!line || line.length > 140) continue;
    const pick = parseSongLine(line) ?? (() => {
      const m = /^(.{2,80}?)\s+[-–—|]\s+(.{2,60})$/.exec(line);
      if (m) return { title: m[1].trim(), artist: m[2].trim() };
      // A bare title still resolves — the artist is a hint, not a requirement.
      return { title: line.replace(/["“”]/g, ''), artist: '' };
    })();
    const key = `${pick.title}|${pick.artist}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...pick, raw: rawLine.trim() });
    if (out.length >= 100) break;
  }
  return out;
}

const BATCH = 4;

interface Run {
  controller: AbortController;
}

export interface ReviewItem {
  line: ParsedLine;
  /** The pick actually looked up (edited on retry). */
  pick: SongPickRef;
  match: MatchResult | null;
  /** What will be saved: the match's song, or an alternative the listener chose. */
  chosen: Song | null;
  skipped: boolean;
  retrying: boolean;
}

const statusOf = (it: ReviewItem): 'matched' | 'uncertain' | 'missing' => {
  if (!it.match) return 'missing';
  if (it.chosen && it.match.song && it.chosen.id !== it.match.song.id) return 'matched'; // listener picked explicitly
  return it.match.status;
};

export function ImportPlaylistSheet({ onClose }: { onClose(): void }) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [review, setReview] = useState<ReviewItem[] | null>(null);
  const [editing, setEditing] = useState<Record<number, string>>({});
  const [showRaw, setShowRaw] = useState<Record<number, boolean>>({});
  const ref = useRef<HTMLDivElement>(null);
  const runRef = useRef<Run | null>(null);
  const createCollection = useLibraryStore((s) => s.createCollection);
  const addManyToCollection = useLibraryStore((s) => s.addManyToCollection);
  const playQueue = usePlayerStore((s) => s.playQueue);

  /** Abort whatever is in flight and forget the run (late results are ignored). */
  const cancelRun = () => {
    runRef.current?.controller.abort();
    runRef.current = null;
    setBusy(false);
  };
  const close = () => {
    cancelRun();
    onClose();
  };
  useFocusTrap(ref, true, close);
  useDismissOnBack(true, close);
  // Unmount (route change, parent re-render without the sheet) aborts too.
  useEffect(() => () => runRef.current?.controller.abort(), []);

  const lines = parseLines(text);

  const lookUp = async () => {
    if (!lines.length || busy) return;
    const run: Run = { controller: new AbortController() };
    runRef.current = run;
    const { signal } = run.controller;
    setBusy(true);
    setProgress({ done: 0, total: lines.length });
    const items: ReviewItem[] = [];
    // Small batches keep the catalogue API happy and the progress honest.
    for (let i = 0; i < lines.length && !signal.aborted; i += BATCH) {
      const batch = lines.slice(i, i + BATCH);
      const found = await Promise.all(batch.map((p) => fetchPickMatch(qc, p, signal).catch(() => null)));
      if (signal.aborted) break;
      batch.forEach((line, k) => {
        const match = found[k];
        items.push({ line, pick: { title: line.title, artist: line.artist }, match, chosen: match && match.status !== 'missing' ? match.song : null, skipped: false, retrying: false });
      });
      setProgress({ done: Math.min(lines.length, i + batch.length), total: lines.length });
    }
    // The run was cancelled (Cancel / backdrop / back / unmount) or replaced —
    // nothing below may touch state that leads to a save.
    if (signal.aborted || runRef.current !== run) return;
    runRef.current = null;
    setBusy(false);
    setReview(items);
  };

  const retry = async (index: number) => {
    const item = review?.[index];
    if (!item) return;
    const edited = (editing[index] ?? '').trim();
    const pick: SongPickRef = edited ? (parseSongLine(edited) ?? { title: edited, artist: '' }) : item.pick;
    setReview((r) => r && r.map((it, i) => (i === index ? { ...it, retrying: true } : it)));
    // A retry must hit the catalogue again, not the hour-long pick cache.
    await qc.invalidateQueries({ queryKey: pickQueryKey(pick) });
    const controller = new AbortController();
    const run: Run = { controller };
    runRef.current = run;
    const match = await fetchPickMatch(qc, pick, controller.signal).catch(() => null);
    if (controller.signal.aborted || runRef.current !== run) return;
    runRef.current = null;
    setReview((r) =>
      r && r.map((it, i) => (i === index ? { ...it, pick, match, chosen: match && match.status !== 'missing' ? match.song : null, retrying: false, skipped: false } : it)),
    );
  };

  const toSave = (review ?? []).filter((it) => !it.skipped && it.chosen);
  const commit = (playAfter: boolean) => {
    const seen = new Set<string>();
    const songs = toSave.map((it) => it.chosen as Song).filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
    if (!songs.length) {
      toast('Nothing selected to save');
      return;
    }
    const title = name.trim() || `Imported ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;
    const id = createCollection(title);
    addManyToCollection(id, songs);
    const skipped = (review ?? []).length - songs.length;
    toast(skipped ? `Saved “${title}” — ${songs.length} saved, ${skipped} left out` : `Saved “${title}” with ${songs.length} songs`);
    if (playAfter) playQueue(songs, 0);
    onClose();
  };

  const counts = (review ?? []).reduce(
    (acc, it) => {
      acc[statusOf(it)] += 1;
      return acc;
    },
    { matched: 0, uncertain: 0, missing: 0 },
  );

  // Portal: see note in SmartCollectionSheet — fixed overlays must not live inside a transformed page section.
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-6" onClick={close}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-playlist-title"
        className="w-full sm:max-w-2xl glass-modal rounded-t-3xl sm:rounded-3xl p-5 max-h-[92vh] overflow-y-auto animate-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="import-playlist-title" className="text-lg font-bold">{review ? 'Review your import' : 'Import a playlist'}</h2>

        {!review ? (
          <>
            <p className="text-xs text-ink-400 mt-0.5 mb-3">One song per line — <b>Title — Artist</b> works best; a bare title is fine too. You will review every match before anything is saved.</p>
            <label htmlFor="import-playlist-name" className="sr-only">Playlist name (optional)</label>
            <input
              id="import-playlist-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Playlist name (optional)"
              disabled={busy}
              className="w-full mb-2 px-3 py-2 rounded-full bg-ink-800 text-sm outline-none placeholder:text-ink-400 focus:ring-1 focus:ring-ink-100 disabled:opacity-60"
            />
            <label htmlFor="import-playlist-text" className="sr-only">Songs, one per line</label>
            <textarea
              id="import-playlist-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={7}
              disabled={busy}
              placeholder={'Kesariya — Arijit Singh\nSrivalli — Sid Sriram\nNaatu Naatu'}
              className="w-full px-3 py-2 rounded-2xl bg-ink-800 text-sm outline-none resize-none placeholder:text-ink-500 focus:ring-1 focus:ring-ink-100 font-mono disabled:opacity-60"
            />
            <div className="mt-2 flex items-center justify-between text-[11px] text-ink-400">
              <span>{lines.length ? `${lines.length} song${lines.length === 1 ? '' : 's'} to look up` : 'Paste a list to begin'}</span>
              {/* Announced politely so screen-reader users hear the count move. */}
              <span role="status" aria-live="polite" aria-atomic="true">
                {busy ? `Finding ${progress.done} of ${progress.total}…` : ''}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 justify-end">
              <button type="button" onClick={close} className="btn-secondary px-4 py-2 text-sm min-h-[44px]">
                {busy ? 'Cancel import' : 'Cancel'}
              </button>
              <button type="button" onClick={() => void lookUp()} disabled={!lines.length || busy} className="btn-primary px-4 py-2 text-sm min-h-[44px] disabled:opacity-50">
                {busy ? 'Looking up…' : 'Find songs'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-xs text-ink-400 mt-0.5 mb-3" role="status">
              {counts.matched} matched · {counts.uncertain} closest match{counts.uncertain === 1 ? '' : 'es'} · {counts.missing} not found. Nothing is saved until you confirm.
            </p>
            <ul className="space-y-2" aria-label="Import results">
              {review.map((it, index) => {
                const status = statusOf(it);
                const alternatives = it.match?.alternatives ?? [];
                return (
                  <li key={`${it.line.raw}-${index}`} className={cn('rounded-2xl border p-3', it.skipped ? 'border-ink-700 opacity-60' : status === 'matched' ? 'border-emerald-500/30' : status === 'uncertain' ? 'border-amber-400/40' : 'border-red-400/30')}>
                    <div className="flex items-start gap-3">
                      {it.chosen ? (
                        <img src={bestImage(it.chosen.images, 150)} onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)} alt="" className="w-11 h-11 rounded-lg object-cover shrink-0" />
                      ) : (
                        <span className="w-11 h-11 rounded-lg bg-ink-800 shrink-0" aria-hidden />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-bold tracking-widest uppercase">
                          <span className={status === 'matched' ? 'text-emerald-400' : status === 'uncertain' ? 'text-amber-300' : 'text-red-300'}>
                            {status === 'matched' ? 'Matched' : status === 'uncertain' ? 'Closest match' : 'Not found'}
                          </span>
                          {it.skipped && <span className="text-ink-500"> · skipped</span>}
                        </p>
                        <p className="text-sm font-semibold truncate">{it.chosen ? it.chosen.title : it.pick.title}</p>
                        <p className="text-xs text-ink-400 truncate">{it.chosen ? it.chosen.subtitle : it.pick.artist || 'no artist given'}</p>
                        {it.chosen && (it.chosen.title !== it.pick.title || status === 'uncertain') && (
                          <p className="text-[11px] text-ink-500 truncate">You asked for “{it.pick.title}”{it.pick.artist ? ` by ${it.pick.artist}` : ''}</p>
                        )}
                      </div>
                      <label className="flex items-center gap-1.5 text-xs shrink-0 min-h-[36px]">
                        <input type="checkbox" checked={!it.skipped && !!it.chosen} disabled={!it.chosen} onChange={() => setReview((r) => r && r.map((x, i) => (i === index ? { ...x, skipped: !x.skipped } : x)))} aria-label={`Include ${it.pick.title}`} className="w-4 h-4 accent-[rgb(var(--ember-400))]" />
                        Save
                      </label>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {alternatives.length > 1 && (
                        <>
                          <label htmlFor={`alt-${index}`} className="sr-only">Alternative for {it.pick.title}</label>
                          <select
                            id={`alt-${index}`}
                            value={it.chosen?.id ?? ''}
                            onChange={(e) => {
                              const pickSong = alternatives.find((s) => s.id === e.target.value) ?? null;
                              setReview((r) => r && r.map((x, i) => (i === index ? { ...x, chosen: pickSong, skipped: false } : x)));
                            }}
                            className="bg-ink-800 border border-ink-600 rounded-xl px-2 py-1.5 text-xs text-ink-100 outline-none focus:border-ember-500 max-w-full min-h-[36px]"
                          >
                            {alternatives.map((s) => (
                              <option key={s.id} value={s.id}>{s.title} — {s.subtitle}</option>
                            ))}
                          </select>
                        </>
                      )}
                      <label htmlFor={`retry-${index}`} className="sr-only">Edit the search for {it.pick.title}</label>
                      <input
                        id={`retry-${index}`}
                        value={editing[index] ?? ''}
                        onChange={(e) => setEditing((m) => ({ ...m, [index]: e.target.value }))}
                        placeholder="Edit: Title — Artist"
                        className="glass-input flex-1 min-w-[9rem] px-2 py-1.5 rounded-xl text-xs"
                      />
                      <button type="button" onClick={() => void retry(index)} disabled={it.retrying} className="px-3 py-1.5 rounded-full border border-ink-600 text-xs font-semibold hover:border-ink-400 disabled:opacity-50 min-h-[36px]">
                        {it.retrying ? 'Searching…' : 'Retry'}
                      </button>
                      <button type="button" onClick={() => setShowRaw((m) => ({ ...m, [index]: !m[index] }))} aria-expanded={!!showRaw[index]} className="px-3 py-1.5 rounded-full border border-ink-600 text-xs font-semibold hover:border-ink-400 min-h-[36px]">
                        {showRaw[index] ? 'Hide original' : 'Original'}
                      </button>
                    </div>
                    {showRaw[index] && <pre className="mt-2 text-[11px] text-ink-300 whitespace-pre-wrap break-words font-mono bg-ink-900/50 rounded-lg px-2 py-1.5">{it.line.raw}</pre>}
                  </li>
                );
              })}
            </ul>
            <div className="mt-4 flex flex-wrap gap-2 justify-end items-center">
              <span className="text-[11px] text-ink-400 mr-auto" role="status" aria-live="polite">{toSave.length} of {review.length} will be saved</span>
              <button type="button" onClick={() => setReview(null)} className="btn-secondary px-4 py-2 text-sm min-h-[44px]">Back</button>
              <button type="button" onClick={() => commit(true)} disabled={!toSave.length} className="btn-secondary px-4 py-2 text-sm min-h-[44px] disabled:opacity-50">Save &amp; play</button>
              <button type="button" onClick={() => commit(false)} disabled={!toSave.length} className="btn-primary px-4 py-2 text-sm min-h-[44px] disabled:opacity-50">Save {toSave.length} song{toSave.length === 1 ? '' : 's'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  , document.body);
}
