import { useEffect } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { useLibraryStore } from '@/store/libraryStore';
import { isNativePlatform } from '@/services/native';

/** ARIA widgets that handle Space / Enter / arrow keys themselves. */
const CONTROL_ROLES = new Set(['button', 'slider', 'menuitem', 'option', 'tab', 'switch', 'checkbox', 'radio']);
const CONTROL_TAGS = new Set(['BUTTON', 'A']);
/** The keys a focused control consumes; letter shortcuts stay live on it. */
const CONTROL_KEYS = new Set([' ', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

/**
 * True when the key press belongs to the focused element, not the player:
 * typing in a field or a select (type-ahead), anything inside an open dialog,
 * or Space / arrows on a focused control — Space on a button would otherwise
 * click it AND toggle playback, arrows on a slider would also seek the track.
 */
export function shortcutsExempt(target: EventTarget | null, key: string): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return true;
  if (target.closest('[role="dialog"]')) return true;
  const role = target.getAttribute('role');
  const isControl = CONTROL_TAGS.has(tag) || (role !== null && CONTROL_ROLES.has(role));
  return isControl && CONTROL_KEYS.has(key);
}

/**
 * Web keyboard shortcuts: Space play/pause, ←/→ seek 10s, N/P track skip,
 * M mute, S shuffle, R repeat, F favorite current track.
 */
export function useKeyboardShortcuts(): void {
  useEffect(() => {
    if (isNativePlatform()) return; // hardware keyboards are a desktop concern
    const onKey = (e: KeyboardEvent) => {
      if (shortcutsExempt(e.target, e.key)) return;
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
