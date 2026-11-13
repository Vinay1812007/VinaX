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

/**
 * App-wide custom right-click menu (v2.4.0). Desktop fine pointers only —
 * touch keeps native behavior. Shift+right-click is the escape hatch to the
 * browser's native menu, text fields always keep the native menu, and VinaX
 * AI pages always keep it too (isNativeMenuZone). What the menu offers lives
 * in ContextMenuPanel.tsx.
 */
export function ContextMenu() {
  const [menu, setMenu] = useState<ContextMenuState | null>(null);

  useEffect(() => {
    const onCtx = (e: MouseEvent) => {
      if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
      if (e.shiftKey) return; // power-user escape hatch → native menu
      if (isNativeMenuZone()) return; // VinaX AI: the browser's own menu, for copying replies, links and code
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (t.closest('input, textarea, select, [contenteditable="true"]')) return;
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
