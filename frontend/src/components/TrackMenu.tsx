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
import { useReasonStore } from '@/store/reasonStore';
import { useDownloadsStore } from '@/store/downloadsStore';
import { downloadFailureMessage, downloadSong, lastDownloadFailure, removeDownload } from '@/services/downloads';
import { SOFT_MUTE_DAYS } from '@/services/personalization/softMutes';
import { lessLikeThis, moreLikeThis, tuneLabel } from '@/features/queue/steer';
import { DotsIcon } from './Icons';
import { MENU_GLYPHS, type MenuGlyph } from './MenuIcons';
import { useDismissOnBack } from '@/hooks/useDismissOnBack';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { cn } from '@/utils/cn';
import '@/styles/overlays.css';
// v5.17.0 — lazy: the memories sheet is a rare tap, never first-load code.
const SongMemoriesSheet = lazy(() => import('./SongMemoriesSheet'));

const PANEL_WIDTH = 256; // .vx-menu width (styles/overlays.css)
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

/** One entry a caller adds to the top of the menu (the Queue page's row actions). */
export interface TrackMenuItem {
  label: string;
  action: () => void;
}

interface TrackMenuProps {
  song: Song;
  /** Accessible name of the trigger. Rows that repeat per song say which song. */
  label?: string;
  /** Context actions shown first, above a divider (e.g. "Keep this song", "Move up"). */
  leadItems?: TrackMenuItem[];
}

/**
 * The "⋯" trigger. Deliberately light: every song row renders one, so the
 * trigger holds no store subscriptions and builds nothing — the ~25-item
 * action list, its six subscriptions and the back-button registration all
 * live in <TrackMenuPanel/>, which only exists while the menu is open.
 */
export function TrackMenu({ song, label = 'More options', leadItems }: TrackMenuProps) {
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
        aria-label={label}
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
      {open && <TrackMenuPanel song={song} anchorRef={btnRef} onClose={close} onShowMemories={showMemories} leadItems={leadItems} />}
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
  leadItems?: TrackMenuItem[];
}

type MenuEntry = (TrackMenuItem & { submenu?: boolean; id?: string; icon?: MenuGlyph; danger?: boolean }) | 'divider' | null;

const fmtDate = (ts: number): string => new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/**
 * The open menu. Portalled to <body> and positioned from the trigger's
 * bounding rect: inside a list it used to be an absolutely-positioned child
 * of its row, so it painted UNDER the rows after it and was clipped by any
 * transformed / overflow-hidden ancestor.
 */
function TrackMenuPanel({ song, anchorRef, onClose, onShowMemories, leadItems }: PanelProps) {
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
  // 8.0.0 — on phones the same menu opens as a bottom sheet with the song on top.
  const asSheet = useMediaQuery('(max-width: 767px)');
  // 7.2 — "Less like this" asks for how long in a second view of the same menu.
  const [view, setView] = useState<'main' | 'less'>('main');
  const returnTo = useRef<string | null>(null);

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
  }, [anchorRef, onClose, view]);

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
    if (!placed) return;
    const back = returnTo.current;
    returnTo.current = null;
    const target = (back && menuRef.current?.querySelector<HTMLElement>(`[data-menu-id="${back}"]`)) || menuRef.current?.querySelector<HTMLElement>('[role=menuitem]');
    target?.focus({ preventScroll: true });
  }, [placed, view]);

  const openLess = (): void => setView('less');
  const leaveLess = (): void => {
    returnTo.current = 'less';
    setView('main');
  };

  const onMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Portals bubble React events to the React parent — a song row that plays on Enter.
    e.stopPropagation();
    if (e.key === 'Escape') {
      // Stopping the React event above also keeps it from the document listener.
      e.nativeEvent.stopPropagation();
      // In the "how long?" view, Escape steps back to the full menu first.
      if (view === 'less') leaveLess();
      else onClose();
      return;
    }
    if (view === 'less' && e.key === 'ArrowLeft') {
      e.preventDefault();
      leaveLess();
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

  const artist = song.artists[0]?.name ?? '';

  const moreLike = (): void => {
    const r = moreLikeThis(song);
    if (!r.retuned) toast('Got it — more like this for the rest of this session');
    else if (r.intent) toast(`More like this — new DJ picks, ${tuneLabel(r.intent).toLowerCase()}`);
    else toast(artist ? `More like this — new DJ picks lean toward ${artist}` : 'More like this — new DJ picks on the way');
  };

  const lessLike = (days: number): void => {
    const r = lessLikeThis(song, days);
    if (!r) return;
    const { receipt, refreshed } = r;
    toast(`Less of ${receipt.mute.name} until ${fmtDate(receipt.mute.until)}${refreshed ? ' · DJ picks refreshed' : ''}`, {
      action: {
        label: 'Undo',
        onClick: () => {
          receipt.undo();
          toast(`${receipt.mute.name} is back to normal`);
        },
      },
    });
  };

  const entries: MenuEntry[] = [
    ...(leadItems?.length ? [...leadItems, 'divider' as const] : []),
    // 8.2.0 — AI Radio: this song starts, and the DJ keeps adding songs that follow from it.
    { label: 'Start AI Radio', icon: 'radio', action: () => { startRadio(song); toast(`AI Radio: ${song.title}`); } },
    { label: 'Play next', icon: 'playNext', action: () => enqueueNext(song) },
    { label: 'Add to queue', icon: 'addQueue', action: () => enqueue(song) },
    // 7.2 — steer what comes next. "More like this" is for this sitting and
    // retunes the DJ picks now; "Less like this" plays the artist less for a
    // while (a soft mute that ends on its own).
    { label: 'More like this', icon: 'moreLike', action: moreLike },
    artist ? { id: 'less', label: 'Less like this…', icon: 'lessLike', action: openLess, submenu: true } : null,
    // C4 — only offered when this song was actually recommended (an entry
    // exists); library/search results aren't automatic picks, so no item.
    whyLine ? { label: 'Why this song?', icon: 'why', action: () => toast(whyLine) } : null,
    'divider',
    // v5.12.0 — Listen Later: the one-tap "come back to this" list.
    {
      label: inLater ? 'Remove from Listen Later' : 'Listen later',
      icon: 'later',
      action: () => {
        toggleLater(song);
        toast(inLater ? 'Removed from Listen Later' : 'Saved to Listen Later', { action: { label: 'Undo', onClick: () => toggleLater(song) } });
      },
    },
    { label: 'Song details', icon: 'details', action: () => navigate(songPath(song)) },
    // v5.17.0 — your own history with this song, from on-device data.
    { label: 'Your history with this song', icon: 'history', action: onShowMemories },
    song.album?.id ? { label: 'Go to album', icon: 'album', action: () => navigate(albumPath(song.album!)) } : null,
    song.artists[0]?.id
      ? { label: 'Go to artist', icon: 'artist', action: () => navigate(artistPath(song.artists[0])) }
      : null,
    { label: 'View lyrics', icon: 'lyrics', action: () => navigate(`/lyrics/${song.id}`) },
    isNativePlatform()
      ? {
          label: downloading ? 'Downloading…' : downloaded ? 'Remove download' : 'Download',
          icon: 'download' as const,
          action: () => {
            if (downloading) return;
            if (downloaded) void removeDownload(song.id).then(() => toast('Removed download'));
            else void downloadSong(song).then((ok) => toast(ok ? 'Saved for offline' : downloadFailureMessage(lastDownloadFailure(song.id))));
          },
        }
      : null,
    ...collections.map((c) => ({
      label: `Add to “${c.name}”`,
      icon: 'addTo' as const,
      action: () => {
        addToCollection(c.id, song);
        toast(`Added to ${c.name}`);
      },
    })),
    {
      label: 'New playlist…',
      icon: 'newList',
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
      icon: 'report',
      action: () =>
        void sendFeedback('broken', `Broken/incorrect: ${song.title} — ${song.subtitle} [${song.id}]`).then((ok) =>
          toast(ok ? 'Thanks — reported' : 'Could not send report'),
        ),
    },
    'divider',
    // Permanent blocks, kept apart from the temporary "Less like this" above.
    {
      label: 'Not interested',
      icon: 'notInterested',
      danger: true,
      action: () => {
        toggleHidden(song.id);
        toast('We’ll show this less', { action: { label: 'Undo', onClick: () => toggleHidden(song.id) } });
      },
    },
    artist
      ? {
          // v5.12.0 — hard block: this artist never plays from any feed until
          // allowed again in Settings → Appearance & Playback → Never play.
          // The name is truncated by CSS, never by slicing: a cut in the middle
          // of an Indic cluster leaves a dangling vowel sign.
          label: `Never play ${artist}`,
          icon: 'neverPlay' as const,
          danger: true,
          action: () => {
            toggleHiddenArtist(artist);
            toast(`${artist} won’t play again`, { action: { label: 'Undo', onClick: () => toggleHiddenArtist(artist) } });
          },
        }
      : null,
    'divider',
    {
      label: 'Share',
      icon: 'share',
      action: () => void shareLink(songPath(song), song.title).then((r) => r === 'copied' && toast('Link copied')),
    },
    {
      // D15 — pre-filled share to a messaging app (works on app + web).
      label: 'Share to WhatsApp',
      icon: 'message',
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
      icon: 'send',
      action: () =>
        window.open(
          `https://t.me/share/url?url=${encodeURIComponent(`${window.location.origin}${songPath(song)}`)}&text=${encodeURIComponent(`🎵 ${song.title} — ${song.subtitle} · free on VinaX`)}`,
          '_blank',
          'noopener',
        ),
    },
    {
      label: 'Share as image',
      icon: 'image',
      action: () => void shareSongCard(song).then((ok) => { if (!ok) toast('Could not create image'); }),
    },
    {
      // D15 — a 9:16 card for status and story formats.
      label: 'Share as story',
      icon: 'story',
      action: () => void shareSongStoryCard(song).then((ok) => { if (!ok) toast('Could not create image'); }),
    },
  ];

  const lessEntries: MenuEntry[] = [
    ...SOFT_MUTE_DAYS.map((d) => ({ label: `${d} days`, icon: 'clock' as const, action: () => lessLike(d) })),
    'divider',
    { id: 'back', label: 'Back', icon: 'back', action: leaveLess, submenu: true },
  ];

  // Dividers only between real items: none leading, trailing or doubled.
  const shown = (view === 'less' ? lessEntries : entries).filter((e): e is Exclude<MenuEntry, null> => e !== null);
  const visible = shown.filter((e, i) => e !== 'divider' || (i > 0 && i < shown.length - 1 && shown[i - 1] !== 'divider'));

  const stop = (e: React.SyntheticEvent): void => e.stopPropagation();
  const Chevron = MENU_GLYPHS.chevron;

  return createPortal(
    // Touch + click are stopped here for the same portal-bubbling reason as
    // keydown: a swipe on the menu must not swipe the song row that owns it.
    <div ref={overlayRef} data-vx-overlay onTouchStart={stop} onTouchMove={stop} onTouchEnd={stop} onClick={stop}>
      <div className={cn('fixed inset-0 z-[70]', asSheet ? 'bg-black/60' : 'bg-black/30')} onClick={onClose} />
      <div
        ref={menuRef}
        role="menu"
        aria-label={view === 'less' ? `Less like this: play less of ${artist} for how long?` : `More options for ${song.title}`}
        onKeyDown={onMenuKeyDown}
        className={cn('vx-menu fixed z-[71] overflow-y-auto overscroll-contain', asSheet && 'is-sheet')}
        style={pos ? (asSheet ? undefined : { top: pos.top, left: pos.left }) : { top: 0, left: 0, visibility: 'hidden' }}
      >
        {/* The song this menu acts on — shown on the phone sheet only (CSS). */}
        <div role="presentation" className="vx-menu-head">
          <img src={bestImage(song.images, 150) || FALLBACK_ART} alt="" loading="lazy" onError={(e) => { e.currentTarget.src = FALLBACK_ART; }} />
          <div className="min-w-0">
            <p className="vx-menu-head-title">{song.title}</p>
            {song.subtitle && <p className="vx-menu-head-sub">{song.subtitle}</p>}
          </div>
        </div>
        {view === 'less' && (
          // Not a menu item: the heading of the "how long?" view.
          <div role="presentation" className="vx-menu-note">
            <p>
              Play less of <span className="text-ink-100 break-words">{artist}</span> for:
            </p>
            <p>Ends on its own. “Never play” is the permanent block.</p>
          </div>
        )}
        {visible.map((item, i) => {
          if (item === 'divider') return <div key={`divider-${i}`} role="separator" className="vx-menu-sep" />;
          const Glyph = MENU_GLYPHS[item.icon ?? 'generic'];
          return (
            <button
              key={item.id ?? item.label}
              type="button"
              role="menuitem"
              tabIndex={-1}
              data-menu-id={item.id}
              aria-haspopup={item.id === 'less' ? 'menu' : undefined}
              title={item.label}
              onClick={() => {
                // Opening or leaving the "how long?" view keeps the menu open.
                if (item.submenu) {
                  item.action();
                  return;
                }
                onClose();
                item.action();
              }}
              className={cn('vx-menu-item', item.danger && 'is-danger')}
            >
              <Glyph />
              <span className="vx-menu-label">{item.label}</span>
              {item.id === 'less' && <span className="vx-menu-chev"><Chevron /></span>}
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}
