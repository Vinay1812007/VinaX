import { useEffect, useRef, useState } from 'react';
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
import { cn } from '@/utils/cn';
import { DotsIcon } from './Icons';
import { useDismissOnBack } from '@/hooks/useDismissOnBack';

export function TrackMenu({ song }: { song: Song }) {
  const [open, setOpen] = useState(false);
  // Android back closes the menu instead of leaving the page (audit P0-2).
  useDismissOnBack(open, () => setOpen(false));
  const [flipUp, setFlipUp] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  const { enqueue, enqueueNext, startRadio } = usePlayerStore.getState();
  const collections = useLibraryStore((s) => s.collections);
  const addToCollection = useLibraryStore((s) => s.addToCollection);
  const createCollection = useLibraryStore((s) => s.createCollection);
  const toggleHidden = useLibraryStore((s) => s.toggleHidden);
  const downloaded = useDownloadsStore((s) => !!s.items[song.id]);
  const downloading = useDownloadsStore((s) => !!s.downloading[song.id]);
  // Package C4 — the honest "why am I seeing this?" line (AI DJ or local scorer).
  const whyLine = useReasonStore((s) => s.reasons[song.id]);

  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); e.stopPropagation(); }
    };
    document.addEventListener('keydown', handleKey);
    // Focus first menu item
    const firstItem = menuRef.current?.querySelector<HTMLElement>('[role=menuitem]');
    firstItem?.focus();
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);


  const items: Array<{ label: string; action: () => void } | null> = [
    { label: 'Play next', action: () => enqueueNext(song) },
    { label: 'Add to queue', action: () => enqueue(song) },
    { label: 'Start radio', action: () => startRadio(song) },
    { label: 'Song details', action: () => navigate(songPath(song)) },
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
        toast('We’ll show this less');
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

  const toggleOpen = () => {
    if (!open && btnRef.current) {
      // Flip the menu upward when there is no room below.
      const rect = btnRef.current.getBoundingClientRect();
      setFlipUp(window.innerHeight - rect.bottom < 300);
    }
    setOpen((v) => !v);
  };

  return (
    <div className="relative">
      <button
        ref={btnRef}
        aria-label="More options"
        aria-haspopup="menu"
        onClick={(e) => {
          e.stopPropagation();
          toggleOpen();
        }}
        className="inline-flex items-center justify-center w-8 h-8 rounded-full text-ink-300 hover:text-ink-100 hover:bg-ink-700/70"
      >
        <DotsIcon className="w-4 h-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={(e) => { e.stopPropagation(); setOpen(false); }} />
          <div
            ref={menuRef}
            role="menu"
            className={cn(
              'absolute right-0 z-50 w-52 rounded-2xl py-1.5 animate-fade-up max-h-72 overflow-y-auto bg-[color:var(--surface-modal)] backdrop-blur-xl border border-[color:var(--glass-border)] shadow-2xl',
              flipUp ? 'bottom-full mb-1' : 'mt-1',
            )}
          >
            {items.filter(Boolean).map((item) => (
              <button
                key={item!.label}
                role="menuitem"
                onClick={(e) => {
                  e.stopPropagation();
                  item!.action();
                  setOpen(false);
                }}
                className="w-full text-left px-3.5 py-2 text-sm text-ink-100 hover:bg-ink-700 truncate"
              >
                {item!.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
