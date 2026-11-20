import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { usePlayerStore } from '@/store/playerStore';
import { useLibraryStore } from '@/store/libraryStore';
import { songPath } from '@/utils/slug';
import { toast } from '@/store/toastStore';
import { cn } from '@/utils/cn';
import { bestImage } from '@/utils/images';
import { toggleLike } from './FavButton';
import {
  ChevronRightIcon,
  HeartIcon,
  HomeIcon,
  PlayIcon,
  QueueIcon,
  RepeatIcon,
  SearchIcon,
  ShareIcon,
} from './Icons';

interface MenuItem {
  label: string;
  action: () => void;
  /** 20px glyph shown before the label. */
  icon?: (p: { className?: string }) => React.ReactElement;
}
import type { ContextMenuState } from './ContextMenu';

const MENU_W = 240;
const ITEM_H = 44;
const Back = ({ className }: { className?: string }) => <ChevronRightIcon className={cn(className, 'rotate-180')} />;

/** Same canonical-origin rule the share sheet uses. */
function absoluteUrl(path: string): string {
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(window.location.origin);
  const base = local ? 'https://www.vinaxmusic.online' : window.location.origin;
  return `${base}${path}`;
}

/**
 * The right-click menu itself, loaded on the first right-click (ContextMenu.tsx
 * keeps only the listener in the first-load bundle). App-wide custom right-click menu (v2.4.0). Desktop fine pointers only —
 * touch keeps native behavior. Context-aware: over a song row/card
 * (`data-song-id`) it offers play/queue/favorite/copy-link; anywhere else it
 * offers app navigation and utilities. Esc / click-outside dismiss;
 * Shift+right-click is the escape hatch to the browser's native menu, and
 * text fields always keep the native menu. VinaX AI pages always keep it too
 * (isNativeMenuZone).
 */
export default function ContextMenuPanel({ menu, onClose }: { menu: ContextMenuState; onClose: () => void }) {
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const items = useMemo<MenuItem[]>(() => {
    if (menu.song) {
      const song = menu.song;
      const isFav = useLibraryStore.getState().favorites.some((f) => f.id === song.id);
      return [
        { label: 'Play', icon: PlayIcon, action: () => usePlayerStore.getState().playQueue([song], 0) },
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSel((s) => Math.min(s + 1, items.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSel((s) => Math.max(s - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const it = items[sel];
        onClose();
        it?.action();
      } else if (e.key === 'Tab') {
        onClose();
      }
    };
    const onAway = () => onClose();
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onAway);
    window.addEventListener('blur', onAway);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onAway);
      window.removeEventListener('blur', onAway);
    };
  }, [items, sel, onClose]);

  // Roving focus follows the selection for screen readers.
  useEffect(() => {
    const el = listRef.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]')[sel];
    el?.focus();
  }, [sel]);

  const height = items.length * ITEM_H + (menu.song ? 72 : 10);
  const x = Math.max(8, Math.min(menu.x, window.innerWidth - MENU_W - 8));
  const y = Math.max(8, Math.min(menu.y, window.innerHeight - height - 8));

  return (
    <div
      className="fixed inset-0 z-[90]"
      onClick={() => onClose()}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div
        ref={listRef}
        role="menu"
        aria-label={menu.song ? `Actions for ${menu.song.title}` : 'App actions'}
        style={{ left: x, top: y, width: MENU_W, transformOrigin: `${menu.x - x}px ${menu.y - y}px` }}
        // 10.1 — a frosted popover (the thick material, shell.css `.vx-popover`).
        className="vx-popover vx-mat-thick vx-pop-in fixed p-1 rounded-[14px]"
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
                onClose();
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
