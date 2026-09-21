import { useCallback, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { toast } from '@/store/toastStore';
import {
  clearSoftMutes,
  daysLeft,
  restoreSoftMutes,
  softMutesSnapshot,
  subscribeSoftMutes,
  unmuteArtist,
  type SoftMute,
} from '@/services/personalization/softMutes';

const fmt = (ts: number): string => new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/**
 * 7.2 — the listener's view of "Less like this": every artist they asked to
 * hear less of, when it ends, and one tap to end it now (with Undo). A soft
 * mute is temporary by design, so the list says the end date out loud and
 * points at "Never play" for the permanent block.
 *
 * Focus is the reason this list is a little longer than it looks: removing
 * the row you are standing on takes its button with it, so focus moves to
 * the next row's button, or to the heading when the list empties.
 */
export function SoftMuteList({ labelledBy }: { labelledBy?: string }) {
  // A snapshot that only changes when the mutes do — the list is read from
  // the taste profile, which is not a store.
  const mutes = useSyncExternalStore(subscribeSoftMutes, softMutesSnapshot, softMutesSnapshot);
  const focusAfter = useRef<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const emptyRef = useRef<HTMLParagraphElement>(null);

  useLayoutEffect(() => {
    const want = focusAfter.current;
    if (!want) return;
    focusAfter.current = null;
    const active = document.activeElement;
    if (active && active !== document.body && listRef.current?.contains(active)) return;
    const next = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[data-mute-key]') ?? []).find(
      (el) => el.dataset.muteKey === want,
    );
    (next ?? emptyRef.current)?.focus({ preventScroll: true });
  }, [mutes]);

  const undoToast = useCallback((message: string, removed: SoftMute[]) => {
    toast(message, {
      duration: 8000,
      action: {
        label: 'Undo',
        onClick: () => restoreSoftMutes(removed),
      },
    });
  }, []);

  const unmute = (mute: SoftMute, at: number): void => {
    focusAfter.current = mutes[at + 1]?.key ?? mutes[at - 1]?.key ?? null;
    const removed = unmuteArtist(mute.key);
    if (removed) undoToast(`${removed.name} is back in your recommendations`, [removed]);
  };

  const clearAll = (): void => {
    const removed = clearSoftMutes();
    if (!removed.length) return;
    focusAfter.current = null;
    undoToast(`${removed.length} ${removed.length === 1 ? 'artist is' : 'artists are'} back in your recommendations`, removed);
  };

  if (!mutes.length) {
    return (
      <p ref={emptyRef} tabIndex={-1} className="text-xs text-ink-400 outline-none">
        Nothing muted right now. Use <span className="text-ink-200 font-semibold">Less like this</span> in any song menu to hear an
        artist less for a week or a month.
      </p>
    );
  }

  return (
    <div>
      <ul ref={listRef} aria-labelledby={labelledBy} className="space-y-1.5">
        {mutes.map((m, i) => {
          const left = daysLeft(m.until);
          return (
            <li key={m.key} className="flex items-center gap-3 rounded-xl border border-[var(--glass-border)] bg-ink-850/60 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold break-words">{m.name}</span>
                <span className="block text-[11px] text-ink-400">
                  Back on {fmt(m.until)} · {left} {left === 1 ? 'day' : 'days'} left
                </span>
              </span>
              <button
                type="button"
                data-mute-key={m.key}
                onClick={() => unmute(m, i)}
                className="shrink-0 px-3 py-1.5 min-h-touch rounded-full glass-button text-xs font-bold"
              >
                Unmute<span className="sr-only"> {m.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {mutes.length > 1 && (
        <button type="button" onClick={clearAll} className="mt-2 px-3 py-1.5 min-h-touch rounded-full glass-button text-xs font-bold">
          Unmute all
        </button>
      )}
    </div>
  );
}
