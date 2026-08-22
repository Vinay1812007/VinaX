import { useEffect } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { useLibraryStore } from '@/store/libraryStore';
import { isNativePlatform } from '@/services/native';

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement;
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable;
}

/**
 * Web keyboard shortcuts: Space play/pause, ←/→ seek 10s, N/P track skip,
 * M mute, S shuffle, R repeat, F favorite current track.
 */
export function useKeyboardShortcuts(): void {
  useEffect(() => {
    if (isNativePlatform()) return; // hardware keyboards are a desktop concern
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      // Never fire on modifier combos — otherwise Cmd/Ctrl+P (print) triggers
      // prev(), Cmd+F (find) toggles the favorite, Cmd+S (save) toggles
      // shuffle, Cmd+R (reload) cycles repeat, and so on (audit finding H4).
      // Alt/Meta on their own are also let through so the browser can handle
      // its native shortcuts unchanged.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const p = usePlayerStore.getState();
      switch (e.key) {
        case ' ':
          e.preventDefault();
          p.togglePlay();
          break;
        case 'ArrowRight':
          p.seek(Math.min(p.currentTime + 10, p.duration));
          break;
        case 'ArrowLeft':
          p.seek(Math.max(p.currentTime - 10, 0));
          break;
        case 'ArrowUp':
          e.preventDefault();
          p.setVolume(Math.min(1, p.volume + 0.05));
          break;
        case 'ArrowDown':
          e.preventDefault();
          p.setVolume(Math.max(0, p.volume - 0.05));
          break;
        case 'n':
          p.next(true);
          break;
        case 'p':
          p.prev();
          break;
        case 'm':
          p.toggleMute();
          break;
        case 's':
          p.toggleShuffle();
          break;
        case 'r':
          p.cycleRepeat();
          break;
        case 'f': {
          const song = p.queue[p.index];
          if (song) useLibraryStore.getState().toggleFavorite(song);
          break;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
