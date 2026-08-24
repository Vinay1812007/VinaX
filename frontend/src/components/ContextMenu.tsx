import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { Song } from '@/types';
import { usePlayerStore } from '@/store/playerStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { resolveTheme } from '@/utils/theme';
import { songPath } from '@/utils/slug';
import { toast } from '@/store/toastStore';
import { recallCtxSong } from '@/utils/ctxSongs';
import { cn } from '@/utils/cn';

interface MenuItem {
  label: string;
  action: () => void;
}
interface MenuState {
  x: number;
  y: number;
  song: Song | null;
}

const MENU_W = 224; // matches w-56
const ITEM_H = 36;

/** Same canonical-origin rule the share sheet uses. */
function absoluteUrl(path: string): string {
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(window.location.origin);
  const base = local ? 'https://www.sirimillavinay.online' : window.location.origin;
  return `${base}${path}`;
}

/**
 * App-wide custom right-click menu (v2.4.0). Desktop fine pointers only —
 * touch keeps native behavior. Context-aware: over a song row/card
 * (`data-song-id`) it offers play/queue/favorite/copy-link; anywhere else it
 * offers app navigation and utilities. Esc / click-outside dismiss;
 * Shift+right-click is the escape hatch to the browser's native menu, and
 * text fields always keep the native menu.
 */
export function ContextMenu() {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    const onCtx = (e: MouseEvent) => {
      if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
      if (e.shiftKey) return; // power-user escape hatch → native menu
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (t.closest('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      const holder = t.closest<HTMLElement>('[data-song-id]');
      const song = recallCtxSong(holder?.dataset.songId) ?? null;
      setSel(0);
      setMenu({ x: e.clientX, y: e.clientY, song });
    };
    document.addEventListener('contextmenu', onCtx);
    return () => document.removeEventListener('contextmenu', onCtx);
  }, []);

  const items = useMemo<MenuItem[]>(() => {
    if (!menu) return [];
    if (menu.song) {
      const song = menu.song;
      const isFav = useLibraryStore.getState().favorites.some((f) => f.id === song.id);
      return [
        { label: 'Play', action: () => usePlayerStore.getState().playQueue([song], 0) },
        {
          label: 'Play next',
          action: () => {
            usePlayerStore.getState().enqueueNext(song);
            toast('Playing next');
          },
        },
        {
          label: 'Add to queue',
          action: () => {
            usePlayerStore.getState().enqueue(song);
            toast('Added to queue');
          },
        },
        {
          label: isFav ? 'Remove from favorites' : 'Favorite',
          action: () => {
            useLibraryStore.getState().toggleFavorite(song);
            toast(isFav ? 'Removed from favorites' : 'Added to favorites');
          },
        },
        {
          label: 'Copy link',
          action: () => {
            void navigator.clipboard
              ?.writeText(absoluteUrl(songPath(song)))
              .then(() => toast('Link copied'))
              .catch(() => toast('Could not copy'));
          },
        },
      ];
    }
    return [
      { label: 'Back', action: () => window.history.back() },
      { label: 'Forward', action: () => window.history.forward() },
      { label: 'Home', action: () => navigate('/') },
      { label: 'Search', action: () => navigate('/search') },
      {
        label: 'Toggle theme',
        action: () => {
          const s = useSettingsStore.getState();
          const resolved = resolveTheme(s.theme, window.matchMedia('(prefers-color-scheme: dark)').matches);
          s.setTheme(resolved === 'light' ? 'dark' : 'light');
        },
      },
      {
        label: 'Refresh data',
        action: () => {
          void queryClient.refetchQueries({ type: 'active' });
          toast('Refreshing…');
        },
      },
    ];
  }, [menu, navigate, queryClient]);

  // Keyboard: Esc closes, arrows rove, Enter activates.
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setMenu(null);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSel((s) => Math.min(s + 1, items.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSel((s) => Math.max(s - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const it = items[sel];
        setMenu(null);
        it?.action();
      } else if (e.key === 'Tab') {
        setMenu(null);
      }
    };
    const onAway = () => setMenu(null);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onAway);
    window.addEventListener('blur', onAway);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onAway);
      window.removeEventListener('blur', onAway);
    };
  }, [menu, items, sel]);

  // Roving focus follows the selection for screen readers.
  useEffect(() => {
    if (!menu) return;
    const el = listRef.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]')[sel];
    el?.focus();
  }, [menu, sel]);

  if (!menu) return null;

  const height = items.length * ITEM_H + (menu.song ? 44 : 12);
  const x = Math.max(8, Math.min(menu.x, window.innerWidth - MENU_W - 8));
  const y = Math.max(8, Math.min(menu.y, window.innerHeight - height - 8));

  return (
    <div
      className="fixed inset-0 z-[90]"
      onClick={() => setMenu(null)}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu(null);
      }}
    >
      <div
        ref={listRef}
        role="menu"
        aria-label={menu.song ? `Actions for ${menu.song.title}` : 'App actions'}
        style={{ left: x, top: y, width: MENU_W }}
        className="fixed py-1.5 rounded-2xl bg-[color:var(--surface-modal)] backdrop-blur-xl border border-[color:var(--glass-border)] shadow-2xl animate-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        {menu.song && (
          <p className="px-3.5 pt-1 pb-1.5 text-[11px] font-semibold text-ink-400 truncate border-b border-[color:var(--glass-border)] mb-1">
            {menu.song.title}
          </p>
        )}
        {items.map((it, i) => (
          <button
            key={it.label}
            role="menuitem"
            tabIndex={i === sel ? 0 : -1}
            onMouseEnter={() => setSel(i)}
            onClick={() => {
              setMenu(null);
              it.action();
            }}
            className={cn(
              'w-full text-left px-3.5 py-2 text-sm truncate outline-none',
              i === sel ? 'bg-ink-700 text-ink-100' : 'text-ink-100',
            )}
          >
            {it.label}
          </button>
        ))}
      </div>
    </div>
  );
}
