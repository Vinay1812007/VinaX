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
import { bestImage } from '@/utils/images';
import { toggleLike } from './FavButton';
import {
  ChevronRightIcon,
  HeartIcon,
  HomeIcon,
  MoonIcon,
  NextIcon,
  PlayIcon,
  QueueIcon,
  RepeatIcon,
  SearchIcon,
  ShareIcon,
  SunIcon,
} from './Icons';

interface MenuItem {
  label: string;
  action: () => void;
  /** 20px glyph shown before the label. */
  icon?: (p: { className?: string }) => React.ReactElement;
}
interface MenuState {
  x: number;
  y: number;
  song: Song | null;
}

const MENU_W = 240;
const ITEM_H = 44;
const Back = ({ className }: { className?: string }) => <ChevronRightIcon className={cn(className, 'rotate-180')} />;

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
        { label: 'Play', icon: PlayIcon, action: () => usePlayerStore.getState().playQueue([song], 0) },
        {
          label: 'Play next',
          icon: NextIcon,
          action: () => {
            usePlayerStore.getState().enqueueNext(song); // the store confirms with a snackbar
          },
        },
        {
          label: 'Add to queue',
          icon: QueueIcon,
          action: () => {
            usePlayerStore.getState().enqueue(song); // the store confirms with a snackbar
          },
        },
        {
          label: isFav ? 'Remove from favorites' : 'Favorite',
          icon: HeartIcon,
          action: () => {
            toggleLike(song);
          },
        },
        {
          label: 'Copy link',
          icon: ShareIcon,
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
      { label: 'Back', icon: Back, action: () => window.history.back() },
      { label: 'Forward', icon: ChevronRightIcon, action: () => window.history.forward() },
      { label: 'Home', icon: HomeIcon, action: () => navigate('/') },
      { label: 'Search', icon: SearchIcon, action: () => navigate('/search') },
      {
        label: 'Toggle theme',
        icon: document.documentElement.classList.contains('light') ? MoonIcon : SunIcon,
        action: () => {
          const s = useSettingsStore.getState();
          const resolved = resolveTheme(s.theme, window.matchMedia('(prefers-color-scheme: dark)').matches);
          s.setTheme(resolved === 'light' ? 'dark' : 'light');
        },
      },
      {
        label: 'Refresh data',
        icon: RepeatIcon,
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

  const height = items.length * ITEM_H + (menu.song ? 72 : 10);
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
        // 10.1 — a frosted popover (the thick material, shell.css `.vx-popover`).
        className="vx-popover vx-mat-thick fixed p-1 rounded-[14px] animate-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        {menu.song && (
          <div className="flex items-center gap-3 px-2.5 pt-2 pb-2.5 mb-1 border-b border-[color:var(--vx-border)]">
            <img src={bestImage(menu.song.images, 150)} alt="" className="w-10 h-10 rounded-md object-cover shrink-0 bg-ink-800" />
            <div className="min-w-0">
              <p className="text-[14px] font-bold text-ink-100 truncate">{menu.song.title}</p>
              {menu.song.subtitle && <p className="text-[12px] font-medium text-ink-400 truncate">{menu.song.subtitle}</p>}
            </div>
          </div>
        )}
        {items.map((it, i) => {
          const Icon = it.icon;
          return (
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
                'w-full flex items-center gap-3 min-h-[44px] px-3 rounded-md text-left text-[14px] font-semibold text-ink-100 outline-none transition-colors',
                i === sel && 'bg-ink-100/[0.07]',
              )}
            >
              {Icon && (
                <span aria-hidden className="shrink-0 text-ink-300">
                  <Icon className="w-5 h-5" />
                </span>
              )}
              <span className="truncate">{it.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
