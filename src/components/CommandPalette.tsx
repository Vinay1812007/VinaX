import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Song } from '@/types';
import { searchSongs } from '@/services/api';
import { usePlayerStore } from '@/store/playerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { resolveTheme } from '@/utils/theme';
import { TUNE_OPTIONS } from '@/services/recommendation/tune';
import { toast } from '@/store/toastStore';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { NAV_GROUPS } from '@/constants/nav';
import { cn } from '@/utils/cn';

interface Entry {
  id: string;
  label: string;
  hint?: string;
  kind: 'song' | 'action' | 'nav';
  song?: Song;
  run: () => void;
}

/** Substring beats subsequence; both beat nothing. -1 = no match. */
function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase().trim();
  if (!q) return 1;
  const t = text.toLowerCase();
  const idx = t.indexOf(q);
  if (idx >= 0) return 100 - Math.min(idx, 50);
  let ti = 0;
  let gaps = 0;
  for (const ch of q) {
    if (ch === ' ') continue;
    const found = t.indexOf(ch, ti);
    if (found < 0) return -1;
    gaps += found - ti;
    ti = found + 1;
  }
  return 50 - Math.min(gaps, 45);
}

/**
 * ⌘/Ctrl+K command palette (v2.4.0) — mirrors the owner console's palette UX:
 * one input, fuzzy-filtered list, ↑↓ + Enter, Esc closes. Sources: sidebar
 * navigation, player quick actions, and live song search (debounced, top 5,
 * Enter plays). Lazy-loaded — costs nothing until first opened.
 */
export default function CommandPalette({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);
  const [songs, setSongs] = useState<Song[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const dq = useDebouncedValue(query, 200);

  // Live song search — top 5 via the existing search service.
  useEffect(() => {
    let alive = true;
    const q = dq.trim();
    if (q.length < 2) {
      setSongs([]);
      return;
    }
    searchSongs(q, 5)
      .then((r) => {
        if (alive) setSongs(r.slice(0, 5));
      })
      .catch(() => {
        if (alive) setSongs([]);
      });
    return () => {
      alive = false;
    };
  }, [dq]);

  const staticEntries = useMemo<Entry[]>(() => {
    const p = () => usePlayerStore.getState();
    const actions: Entry[] = [
      { id: 'a-play', label: 'Play / Pause', hint: 'Player', kind: 'action', run: () => p().togglePlay() },
      { id: 'a-next', label: 'Next track', hint: 'Player', kind: 'action', run: () => p().next(true) },
      { id: 'a-prev', label: 'Previous track', hint: 'Player', kind: 'action', run: () => p().prev() },
      { id: 'a-shuffle', label: 'Toggle shuffle', hint: 'Player', kind: 'action', run: () => p().toggleShuffle() },
      { id: 'a-repeat', label: 'Cycle repeat', hint: 'Player', kind: 'action', run: () => p().cycleRepeat() },
      { id: 'a-mute', label: 'Mute / Unmute', hint: 'Player', kind: 'action', run: () => p().toggleMute() },
      {
        id: 'a-theme',
        label: 'Toggle theme',
        hint: 'Appearance',
        kind: 'action',
        run: () => {
          const s = useSettingsStore.getState();
          const resolved = resolveTheme(s.theme, window.matchMedia('(prefers-color-scheme: dark)').matches);
          s.setTheme(resolved === 'light' ? 'dark' : 'light');
        },
      },
      {
        id: 'a-surprise',
        label: 'Surprise me',
        hint: 'AI DJ',
        kind: 'action',
        run: () => {
          const st = p();
          if (!st.queue.length) {
            toast('Play something first — then I can surprise you');
            return;
          }
          const pool = TUNE_OPTIONS.filter((o) => o.id !== 'surprise');
          const pick = pool[Math.floor(Math.random() * pool.length)];
          st.tuneQueue(pick.id);
          toast('Surprise coming up ✦');
        },
      },
    ];
    const nav: Entry[] = NAV_GROUPS.flatMap((g) =>
      g.items.map((it) => ({
        id: `n-${it.to}`,
        label: it.label,
        hint: `Go to · ${g.label}`,
        kind: 'nav' as const,
        run: () => navigate(it.to),
      })),
    );
    return [...actions, ...nav];
  }, [navigate]);

  const list = useMemo<Entry[]>(() => {
    const q = query.trim();
    const scored = staticEntries
      .map((e) => ({ e, s: fuzzyScore(q, `${e.label} ${e.hint ?? ''}`) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.e);
    if (!q) return scored;
    const songEntries: Entry[] = songs.map((s) => ({
      id: `s-${s.id}`,
      label: s.title,
      hint: s.subtitle,
      kind: 'song',
      song: s,
      run: () => usePlayerStore.getState().playQueue([s], 0),
    }));
    return [...songEntries, ...scored].slice(0, 12);
  }, [query, songs, staticEntries]);

  // Keep the selection inside the list as results change.
  useEffect(() => {
    setSel((s) => Math.min(s, Math.max(0, list.length - 1)));
  }, [list.length]);

  // Keep the selected row in view.
  useEffect(() => {
    const opts = listRef.current?.querySelectorAll<HTMLElement>('[role=option]');
    opts?.[sel]?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const runSel = (i: number) => {
    const it = list[i];
    onClose();
    it?.run();
  };

  return (
    <div
      className="fixed inset-0 z-[95] bg-black/50 backdrop-blur-sm flex items-start justify-center pt-[12vh] px-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-full max-w-lg rounded-2xl bg-[color:var(--surface-modal)] border border-[color:var(--glass-border)] shadow-2xl overflow-hidden animate-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSel((s) => Math.min(s + 1, list.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSel((s) => Math.max(s - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              runSel(sel);
            }
          }}
          placeholder="Jump to, run, or search songs…"
          aria-label="Search commands and songs"
          role="combobox"
          aria-expanded="true"
          aria-controls="vx-palette-list"
          aria-activedescendant={list[sel]?.id}
          className="w-full px-4 py-3.5 bg-transparent outline-none text-sm border-b border-[color:var(--glass-border)] placeholder:text-ink-400"
        />
        <div id="vx-palette-list" role="listbox" ref={listRef} className="max-h-[50vh] overflow-y-auto py-1.5">
          {list.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-ink-400">No matches — try a song name.</p>
          )}
          {list.map((e, i) => (
            <button
              key={e.id}
              id={e.id}
              role="option"
              aria-selected={i === sel}
              tabIndex={-1}
              onMouseEnter={() => setSel(i)}
              onClick={() => runSel(i)}
              className={cn(
                'w-full flex items-center gap-3 px-3.5 py-2 text-left text-sm',
                i === sel ? 'bg-ink-700 text-ink-100' : 'text-ink-100',
              )}
            >
              {e.kind === 'song' && (
                <img
                  src={e.song ? bestImage(e.song.images, 150) : FALLBACK_ART}
                  onError={(ev) => ((ev.target as HTMLImageElement).src = FALLBACK_ART)}
                  alt=""
                  className="w-8 h-8 rounded-md object-cover shrink-0"
                />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate">{e.label}</span>
                {e.hint && <span className="block text-[11px] text-ink-400 truncate">{e.hint}</span>}
              </span>
              <span className="text-[10px] uppercase tracking-wider text-ink-400 shrink-0">
                {e.kind === 'song' ? 'Play' : e.kind === 'action' ? 'Action' : 'Go'}
              </span>
            </button>
          ))}
        </div>
        <p className="px-4 py-2 text-[10px] text-ink-400 border-t border-[color:var(--glass-border)]">
          ↑↓ navigate · Enter run · Esc close
        </p>
      </div>
    </div>
  );
}
