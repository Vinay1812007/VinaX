import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Song } from '@/types';
import { PlayIcon, PlusIcon } from '@/components/Icons';
import { toast } from '@/store/toastStore';
import { parsePlaylistBlock } from './playlistBlock';

/**
 * 2.0 — a playlist VinaX AI wrote, as a card you can play or save.
 *
 * The model writes a fenced block with the language `vinax-playlist`
 * (backend prompt, # Music): an optional `title: …` line, then one song per
 * line as "Title — Artist". The card shows those lines as they stream in and
 * looks the songs up in the catalogue only when the listener presses Play or
 * Save (./suggest.ts resolvePicks), so a reply costs no catalogue
 * calls until it is used. Model output is untrusted: it is only ever shown as
 * text and used as search words.
 */

const PREVIEW_ROWS = 4;

export function PlaylistCard({ text }: { text: string }) {
  const draft = parsePlaylistBlock(text);
  const navigate = useNavigate();
  const [busy, setBusy] = useState<'play' | 'save' | null>(null);
  const [open, setOpen] = useState(false);
  if (!draft.songs.length) return null;

  // Look the songs up once per press; the catalogue answers in the order asked.
  const resolve = async (): Promise<Song[]> => {
    const { resolvePicks } = await import('./suggest');
    const found = await resolvePicks(draft.songs);
    return found.map((f) => f.song);
  };
  const run = async (kind: 'play' | 'save'): Promise<void> => {
    if (busy) return;
    setBusy(kind);
    try {
      const songs = await resolve();
      if (!songs.length) {
        toast('None of these songs are in the catalogue right now');
        return;
      }
      if (kind === 'play') {
        const { usePlayerStore } = await import('@/store/playerStore');
        usePlayerStore.getState().playQueue(songs, 0);
      } else {
        const { useLibraryStore } = await import('@/store/libraryStore');
        const lib = useLibraryStore.getState();
        const id = lib.createCollection(draft.title);
        const added = lib.addManyToCollection(id, songs);
        if (added > 0) toast(`Saved “${draft.title}” with ${added} song${added === 1 ? '' : 's'}`, { action: { label: 'Open', onClick: () => navigate(`/collection/${id}`) } });
      }
      const missing = draft.songs.length - songs.length;
      if (missing > 0) toast(`${missing} song${missing === 1 ? ' was' : 's were'} not found in the catalogue`);
    } catch {
      toast('Could not reach the catalogue. Try again.');
    } finally {
      setBusy(null);
    }
  };

  const rows = open ? draft.songs : draft.songs.slice(0, PREVIEW_ROWS);
  return (
    <section className="vx-ai-playlist" aria-label={`Playlist: ${draft.title}`}>
      <div className="vx-ai-playlist-head">
        <span className="vx-ai-playlist-art" aria-hidden>
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18V6l10-2v12" />
            <circle cx="6.5" cy="18" r="2.5" />
            <circle cx="16.5" cy="16" r="2.5" />
          </svg>
        </span>
        <span className="vx-ai-playlist-name">
          <strong>{draft.title}</strong>
          <span>Playlist · {draft.songs.length} song{draft.songs.length === 1 ? '' : 's'}</span>
        </span>
        <span className="vx-ai-playlist-actions">
          <button type="button" className="vx-ai-playlist-play" onClick={() => void run('play')} disabled={busy !== null}>
            <PlayIcon className="w-4 h-4" />
            <span>{busy === 'play' ? 'Finding songs…' : 'Play'}</span>
          </button>
          <button type="button" className="vx-ai-playlist-save" onClick={() => void run('save')} disabled={busy !== null}>
            <PlusIcon className="w-4 h-4" />
            <span>{busy === 'save' ? 'Saving…' : 'Save to library'}</span>
          </button>
        </span>
      </div>
      <ol className="vx-ai-playlist-list">
        {rows.map((s, i) => (
          <li key={`${i}-${s.title}`}>
            <span className="vx-ai-playlist-n">{i + 1}</span>
            <span className="vx-ai-playlist-title">{s.title}</span>
            <span className="vx-ai-playlist-artist">{s.artist}</span>
          </li>
        ))}
      </ol>
      {draft.songs.length > PREVIEW_ROWS && (
        <button type="button" className="vx-ai-playlist-more" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? 'Show fewer' : `Show all ${draft.songs.length} songs`}
        </button>
      )}
    </section>
  );
}
