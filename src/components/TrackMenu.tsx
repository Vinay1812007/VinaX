import { useEffect, useRef, useState } from 'react';
import { albumPath, artistPath, songPath } from '@/utils/slug';
import { useNavigate } from 'react-router-dom';
import type { Song } from '@/types';
import { usePlayerStore } from '@/store/playerStore';
import { useLibraryStore } from '@/store/libraryStore';
import { shareLink } from '@/utils/share';
import { shareSongCard } from '@/utils/songCard';
import { toast } from '@/store/toastStore';
import { isNativePlatform } from '@/services/native';
import { sendFeedback } from '@/services/feedback';
import { useDownloadsStore } from '@/store/downloadsStore';
import { downloadSong, removeDownload } from '@/services/downloads';
import { cn } from '@/utils/cn';
import { DotsIcon } from './Icons';

export function TrackMenu({ song }: { song: Song }) {
  const [open, setOpen] = useState(false);
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
    {
      label: 'Not interested',
      action: () => {
        toggleHidden(song.id);
        toast('We’ll show this less');
      },
    },
    {
      label: 'Share',
      action: () => void shareLink(songPath(song), song.title).then((r) => r === 'copied' && toast('Link copied')),
    },
    {
      label: 'Share as image',
      action: () => void shareSongCard(song).then((ok) => { if (!ok) toast('Could not create image'); }),
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
