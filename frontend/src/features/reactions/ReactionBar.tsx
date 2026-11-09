import { useEffect, useRef, useState } from 'react';
import type { Song } from '@/types';
import { toast } from '@/store/toastStore';
import { cn } from '@/utils/cn';
import { applyLocally, fetchReactions, REACTIONS, setReaction, toggled, type Reaction, type ReactionCounts } from './api';

/**
 * 1.12 — the five reactions under a song, with everyone's counts. Tapping
 * one is this device's reaction (one per song; the same one again takes it
 * away); the bar moves at once and settles on the Worker's answer. Hidden
 * entirely while nothing has been fetched yet and the Worker is away, so an
 * offline page shows no stale controls.
 */
export function ReactionBar({ song, compact }: { song: Song; compact?: boolean }) {
  const [data, setData] = useState<ReactionCounts | null>(null);
  const [busy, setBusy] = useState<Reaction | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    setData(null);
    fetchReactions(song.id).then((c) => { if (alive.current) setData(c); }).catch(() => undefined);
    return () => { alive.current = false; };
  }, [song.id]);
  if (!data) return null;

  const tap = async (emoji: Reaction): Promise<void> => {
    if (busy) return;
    const next = toggled(data.mine, emoji);
    const before = data;
    setData(applyLocally(data, next));
    setBusy(emoji);
    try {
      const fresh = await setReaction(song, next);
      if (alive.current) setData(fresh);
    } catch {
      if (alive.current) { setData(before); toast('Could not save your reaction right now'); }
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  return (
    <div className={cn('vx-reactions', compact && 'is-compact')} role="group" aria-label="Reactions">
      {REACTIONS.map((r) => {
        const n = data.counts[r.id] ?? 0;
        const mine = data.mine === r.id;
        return (
          <button key={r.id} type="button" onClick={() => void tap(r.id)} aria-pressed={mine} aria-label={`${r.label}${n ? `, ${n}` : ''}${mine ? ', yours' : ''}`} title={r.label} className={cn('vx-tap vx-reaction', mine && 'is-mine', busy === r.id && 'is-busy')}>
            <span className="vx-reaction-glyph" aria-hidden>{r.glyph}</span>
            {n > 0 && <span className="vx-reaction-n tabular-nums">{n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : n}</span>}
          </button>
        );
      })}
      {!compact && <span className="vx-reactions-total">{data.total ? `${data.total.toLocaleString('en-IN')} reaction${data.total === 1 ? '' : 's'}` : 'Be the first to react'}</span>}
    </div>
  );
}
