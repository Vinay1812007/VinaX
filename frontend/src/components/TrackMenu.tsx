import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { albumPath, artistPath, songPath } from '@/utils/slug';
import { useNavigate } from 'react-router-dom';
import type { Song } from '@/types';
import { usePlayerStore } from '@/store/playerStore';
import { useLibraryStore } from '@/store/libraryStore';
import { shareLink } from '@/utils/share';
import { shareSongCard, shareSongStoryCard } from '@/utils/songCard';
import { toast } from '@/store/toastStore';
import { isNativePlatform } from '@/services/native';
import { sendFeedback } from '@/services/feedback';
import { softMuteArtist } from '@/services/personalization/updater';
import { useReasonStore } from '@/store/reasonStore';
import { useDownloadsStore } from '@/store/downloadsStore';
import { downloadSong, removeDownload } from '@/services/downloads';
import { DotsIcon } from './Icons';
import { useDismissOnBack } from '@/hooks/useDismissOnBack';
// v5.17.0 — lazy: the memories sheet is a rare tap, never first-load code.
const SongMemoriesSheet = lazy(() => import('./SongMemoriesSheet'));

const PANEL_WIDTH = 224; // w-56
const EDGE = 8; // keep this far inside the viewport
const GAP = 4; // between trigger and panel

interface PanelPos {
  top: number;
  left: number;
}

/** Where the panel goes for a trigger at `rect`: below if it fits, else above, always inside the viewport. */
export function placePanel(
  rect: { top: number; bottom: number; right: number },
  panelHeight: number,
  viewport: { width: number; height: number },
): PanelPos {
  const left = Math.max(EDGE, Math.min(rect.right - PANEL_WIDTH, viewport.width - PANEL_WIDTH - EDGE));
  const below = rect.bottom + GAP;
  const fitsBelow = below + panelHeight <= viewport.height - EDGE;
  const above = rect.top - GAP - panelHeight;
  const top = fitsBelow || above < EDGE ? Math.min(below, Math.max(EDGE, viewport.height - EDGE - panelHeight)) : above;
  return { top, left };
}

/**
 * The "⋯" trigger. Deliberately light: every song row renders one, so the
 * trigger holds no store subscriptions and builds nothing — the ~25-item
 * action list, its six subscriptions and the back-button registration all
 * live in <TrackMenuPanel/>, which only exists while the menu is open.
 */
export function TrackMenu({ song }: { song: Song }) {
  const [memories, setMemories] = useState(false);
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    // Focus goes back to the control that opened the menu.
    btnRef.current?.focus({ preventScroll: true });
  }, []);
  const showMemories = useCallback(() => setMemories(true), []);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label="More options"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        // 36px visual, 44px hit area (IconButton's invisible-pad pattern).
        className="relative after:absolute after:inset-0 after:-m-[4px] inline-flex items-center justify-center w-9 h-9 shrink-0 rounded-full text-ink-300 hover:text-ink-100 hover:bg-ink-700/70"
      >
        <DotsIcon className="w-4 h-4" />
      </button>
      {open && <TrackMenuPanel song={song} anchorRef={btnRef} onClose={close} onShowMemories={showMemories} />}
      {memories && (
        <Suspense fallback={null}>
          <SongMemoriesSheet song={song} onClose={() => setMemories(false)} />
        </Suspense>
      )}
    </>
  );
}

interface PanelProps {
  song: Song;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onShowMemories: () => void;
}

/**
 * The open menu. Portalled to <body> and positioned from the trigger's
 * bounding rect: inside a list it used to be an absolutely-positioned child
 * of its row, so it painted UNDER the rows after it and was clipped by any
 * transformed / overflow-hidden ancestor.
 */
function TrackMenuPanel({ song, anchorRef, onClose, onShowMemories }: PanelProps) {
  // Android back closes the menu instead of leaving the page (audit P0-2).
  useDismissOnBack(true, onClose);
  const navigate = useNavigate();
  const { enqueue, enqueueNext, startRadio } = usePlayerStore.getState();
  const { addToCollection, createCollection, toggleHidden, toggleLater, toggleHiddenArtist } = useLibraryStore.getState();
  const collections = useLibraryStore((s) => s.collections);
  const inLater = useLibraryStore((s) => s.later.some((x) => x.id === song.id));
  const downloaded = useDownloadsStore((s) => !!s.items[song.id]);
  const downloading = useDownloadsStore((s) => !!s.downloading[song.id]);
  // Package C4 — the honest "why am I seeing this?" line from catalog recommendations.
  const whyLine = useReasonStore((s) => s.reasons[song.id]);

  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<PanelPos | null>(null);

  // Position before first paint, then follow the trigger on scroll / resize.
  // If the trigger leaves the viewport there is nothing left to anchor to.
  useLayoutEffect(() => {
    const place = (): void => {
      const anchor = anchorRef.current;
      const menu = menuRef.current;
      if (!anchor || !menu) return;
      const rect = anchor.getBoundingClientRect();
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      if (rect.bottom < 0 || rect.top > viewport.height) {
        onClose();
        return;
      }
      const next = placePanel(rect, menu.offsetHeight, viewport);
      setPos((prev) => (prev && prev.top === next.top && prev.left === next.left ? prev : next));
    };
    place();
    const onScroll = (e: Event): void => {
      // The panel's own overflow scroll is not the page moving.
      if (e.target instanceof Node && menuRef.current?.contains(e.target)) return;
      place();
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', place);
    };
  }, [anchorRef, onClose]);

  // v7.0.1 — while the menu is open, the page behind it must not move. The
  // page scrolls inside its own container (not <body>), so a body lock does
  // nothing; instead the overlay swallows every wheel / touch scroll that is
  // not the menu's own list moving. Native listeners, because React's are
  // passive and cannot preventDefault.
  const overlayRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    let lastY = 0;
    const canScroll = (dy: number): boolean => {
      const menu = menuRef.current;
      if (!menu || menu.scrollHeight <= menu.clientHeight) return false;
      return dy > 0 ? menu.scrollTop + menu.clientHeight < menu.scrollHeight - 1 : menu.scrollTop > 0;
    };
    const inMenu = (t: EventTarget | null): boolean => t instanceof Node && !!menuRef.current?.contains(t);
    const onWheel = (e: WheelEvent): void => {
      if (!inMenu(e.target) || !canScroll(e.deltaY)) e.preventDefault();
    };
    const onTouchStart = (e: TouchEvent): void => {
      lastY = e.touches[0]?.clientY ?? 0;
    };
    const onTouchMove = (e: TouchEvent): void => {
      const y = e.touches[0]?.clientY ?? lastY;
      const dy = lastY - y; // finger up = content scrolls down
      lastY = y;
      if (!inMenu(e.target) || !canScroll(dy)) e.preventDefault();
    };
    overlay.addEventListener('wheel', onWheel, { passive: false });
    overlay.addEventListener('touchstart', onTouchStart, { passive: true });
    overlay.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      overlay.removeEventListener('wheel', onWheel);
      overlay.removeEventListener('touchstart', onTouchStart);
      overlay.removeEventListener('touchmove', onTouchMove);
    };
  }, []);

  const itemEls = (): HTMLElement[] =>
    Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? []);

  useEffect(() => {
    // Escape is caught on the document so it still works if focus wandered.
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Focus the first item once the panel is placed (it is visibility:hidden,
  // and therefore unfocusable, until it has a position).
  const placed = pos !== null;
  useEffect(() => {
    if (placed) menuRef.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus({ preventScroll: true });
  }, [placed]);

  const onMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Portals bubble React events to the React parent — a song row that plays on Enter.
    e.stopPropagation();
    if (e.key === 'Escape') {
      // Stopping the React event above also keeps it from the document listener.
      e.nativeEvent.stopPropagation();
      onClose();
      return;
    }
    if (e.key === 'Tab') {
      // A menu is one tab stop: Tab leaves it, continuing from the trigger.
      onClose();
      return;
    }
    const els = itemEls();
    if (!els.length) return;
    const at = els.indexOf(document.activeElement as HTMLElement);
    let to = -1;
    if (e.key === 'ArrowDown') to = at < 0 ? 0 : (at + 1) % els.length;
    else if (e.key === 'ArrowUp') to = at < 0 ? els.length - 1 : (at - 1 + els.length) % els.length;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = els.length - 1;
    if (to < 0) return;
    e.preventDefault();
    els[to].focus();
  };

  const items: Array<{ label: string; action: () => void } | null> = [
    { label: 'Start song radio', action: () => startRadio(song) },
    { label: 'Play next', action: () => enqueueNext(song) },
    { label: 'Add to queue', action: () => enqueue(song) },
    // v5.12.0 — Listen Later: the one-tap "come back to this" list.
    {
      label: inLater ? 'Remove from Listen Later' : 'Listen later',
      action: () => {
        toggleLater(song);
        toast(inLater ? 'Removed from Listen Later' : 'Saved to Listen Later', { action: { label: 'Undo', onClick: () => toggleLater(song) } });
      },
    },
    { label: 'Song details', action: () => navigate(songPath(song)) },
    // v5.17.0 — your own history with this song, from on-device data.
    { label: 'Your history with this song', action: onShowMemories },
    song.album?.id ? { label: 'Go to album', action: () => navigate(albumPath(song.album!)) } : null,
    song.artists[0]?.id
      ? { label: 'Go to artist', action: () => navigate(artistPath(song.artists[0])) }
      : null,
    { label: 'View lyrics', action: () => navigate(`/lyrics/${song.id}`) },
    isNativePlatform()
      ? {
          label: downloading ? 'Downloading…' : downloaded ? 'Remove download' : 'Download',
          action: () => {
            if (downloading) return;
            if (downloaded) void removeDownload(song.id).then(() => toast('Removed download'));
            else void downloadSong(song).then((ok) => toast(ok ? 'Saved for offline' : 'Download failed'));
          },
        }
      : null,
    ...collections.map((c) => ({
      label: `Add to “${c.name}”`,
      action: () => {
        addToCollection(c.id, song);
        toast(`Added to ${c.name}`);
      },
    })),
    {
      label: 'New playlist…',
      action: () => {
        const name = window.prompt('Playlist name');
        if (name && name.trim()) {
          const cid = createCollection(name.trim());
          addToCollection(cid, song);
          toast(`Added to ${name.trim()}`);
        }
      },
    },
    {
      label: 'Report broken track',
      action: () =>
        void sendFeedback('broken', `Broken/incorrect: ${song.title} — ${song.subtitle} [${song.id}]`).then((ok) =>
          toast(ok ? 'Thanks — reported' : 'Could not send report'),
        ),
    },
    // C4 — only offered when this song was actually recommended (an entry
    // exists); library/search results aren't automatic picks, so no item.
    whyLine
      ? {
          label: 'Why this song?',
          action: () => toast(whyLine),
        }
      : null,
    {
      label: 'Not interested',
      action: () => {
        toggleHidden(song.id);
        toast('We’ll show this less', { action: { label: 'Undo', onClick: () => toggleHidden(song.id) } });
      },
    },
    song.artists[0]
      ? {
          // Package A3 — long-form "less of this artist" (14-day soft-mute
          // + 5× negative bump). Complements "Not interested" which only
          // hides the specific song. Toast is undo-able within 5 s.
          label: `Show fewer like ${song.artists[0].name.slice(0, 20)}${song.artists[0].name.length > 20 ? '…' : ''}`,
          action: () => {
            softMuteArtist(song, 14);
            toast(`Muted ${song.artists[0].name} for 2 weeks`);
          },
        }
      : null,
    song.artists[0]?.name
      ? {
          // v5.12.0 — hard block: this artist never plays from any feed,
          // artist is excluded from future catalog recommendations until removed
          // in Settings → Playback.
          label: `Never play ${song.artists[0].name.slice(0, 20)}${song.artists[0].name.length > 20 ? '…' : ''}`,
          action: () => {
            toggleHiddenArtist(song.artists[0].name);
            toast(`${song.artists[0].name} won’t play again`, { action: { label: 'Undo', onClick: () => toggleHiddenArtist(song.artists[0].name) } });
          },
        }
      : null,
    {
      label: 'Share',
      action: () => void shareLink(songPath(song), song.title).then((r) => r === 'copied' && toast('Link copied')),
    },
    {
      // D15 — pre-filled WhatsApp share (works on app + web via wa.me).
      label: 'Share to WhatsApp',
      action: () =>
        window.open(
          `https://wa.me/?text=${encodeURIComponent(`🎵 ${song.title} — ${song.subtitle}\nListen free on VinaX: ${window.location.origin}${songPath(song)}`)}`,
          '_blank',
          'noopener',
        ),
    },
    {
      // D15 — pre-filled Telegram share.
      label: 'Share to Telegram',
      action: () =>
        window.open(
          `https://t.me/share/url?url=${encodeURIComponent(`${window.location.origin}${songPath(song)}`)}&text=${encodeURIComponent(`🎵 ${song.title} — ${song.subtitle} · free on VinaX`)}`,
          '_blank',
          'noopener',
        ),
    },
    {
      label: 'Share as image',
      action: () => void shareSongCard(song).then((ok) => { if (!ok) toast('Could not create image'); }),
    },
    {
      // D15 — 9:16 for Instagram/WhatsApp status.
      label: 'Share as story',
      action: () => void shareSongStoryCard(song).then((ok) => { if (!ok) toast('Could not create image'); }),
    },
  ];


  const stop = (e: React.SyntheticEvent): void => e.stopPropagation();

  return createPortal(
    // Touch + click are stopped here for the same portal-bubbling reason as
    // keydown: a swipe on the menu must not swipe the song row that owns it.
    <div ref={overlayRef} onTouchStart={stop} onTouchMove={stop} onTouchEnd={stop} onClick={stop}>
      <div className="fixed inset-0 z-[70] bg-black/40" onClick={onClose} />
      <div
        ref={menuRef}
        role="menu"
        aria-label={`More options for ${song.title}`}
        onKeyDown={onMenuKeyDown}
        className="fixed z-[71] w-56 rounded-md p-1 animate-fade-up max-h-72 overflow-y-auto overscroll-contain bg-[color:var(--surface-modal)] shadow-[0_16px_24px_rgba(0,0,0,0.3),0_6px_8px_rgba(0,0,0,0.2)]"
        style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: 'hidden' }}
      >
        {items.filter(Boolean).map((item) => (
          <button
            key={item!.label}
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={() => {
              onClose();
              item!.action();
            }}
            className="w-full text-left rounded-sm px-3 py-2.5 text-[14px] font-medium text-ink-100 hover:bg-ink-700 focus-visible:bg-ink-700 truncate"
          >
            {item!.label}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}
