import { lazy, Suspense, useEffect, useState } from 'react';
import type { Song } from '@/types';
import { recallCtxSong } from '@/utils/ctxSongs';
import { isNativeMenuZone } from '@/utils/nativeMenuZone';

// The menu (its items, icons and keyboard handling) is fetched on the first
// right-click; only this listener ships in the first load.
const ContextMenuPanel = lazy(() => import('./ContextMenuPanel'));

export interface ContextMenuState {
  x: number;
  y: number;
  song: Song | null;
}

/** Where a touch long-press belongs to the app (song rows, cards, artwork, the
 *  player, the nav: index.css), not to the browser's link or image menu. */
const HOLD_SURFACES = '[data-deter-context], .vx-bottom-chrome, .vx-sidebar';

/**
 * App-wide custom right-click menu (v2.4.0). Desktop fine pointers only.
 * Shift+right-click is the escape hatch to the browser's native menu, text
 * fields always keep the native menu, a right-click on selected text keeps it
 * (to copy a lyric line or an address), and VinaX AI pages always keep it too
 * (isNativeMenuZone). On touch, a long-press on a hold surface raises no
 * browser menu; everywhere else touch keeps native behaviour. What the menu
 * offers lives in ContextMenuPanel.tsx.
 */
export function ContextMenu() {
  const [menu, setMenu] = useState<ContextMenuState | null>(null);

  useEffect(() => {
    const onCtx = (e: MouseEvent) => {
      if (isNativeMenuZone()) return; // VinaX AI: the browser's own menu, for copying replies, links and code
      const t = e.target as HTMLElement | null;
      if (!t || typeof t.closest !== 'function') return;
      if (t.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
        if (t.closest(HOLD_SURFACES)) e.preventDefault();
        return;
      }
      if (e.shiftKey) return; // power-user escape hatch → native menu
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.rangeCount && sel.getRangeAt(0).intersectsNode(t)) return; // Copy for the selected text
      e.preventDefault();
      const holder = t.closest<HTMLElement>('[data-song-id]');
      const song = recallCtxSong(holder?.dataset.songId) ?? null;
      setMenu({ x: e.clientX, y: e.clientY, song });
    };
    document.addEventListener('contextmenu', onCtx);
    return () => document.removeEventListener('contextmenu', onCtx);
  }, []);

  if (!menu) return null;
  return (
    <Suspense fallback={null}>
      {/* Keyed so a second right-click starts from the first item again. */}
      <ContextMenuPanel key={`${menu.x},${menu.y}`} menu={menu} onClose={() => setMenu(null)} />
    </Suspense>
  );
}
