import { useReducer, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Song } from '@/types';
import { PlayIcon, PlusIcon, QueueIcon } from '@/components/Icons';
import { toast } from '@/store/toastStore';
import { shuffleSongs } from '@/store/queueRules';
import { parsePlaylistBlock } from './playlistBlock';
import type { Lookup, SongResolver } from './suggest';

/**
 * 2.0 — a playlist VinaX AI wrote, as a card you can play, queue or save.
 *
 * The model writes a fenced block with the language `vinax-playlist`
 * (backend prompt, # Music): an optional `title: …` line, then one song per
 * line as "Title — Artist". The card shows those lines as they stream in and
 * looks the songs up in the catalogue only when the listener presses a
 * button (./suggest.ts createSongResolver), so a reply costs no catalogue
 * calls until it is used. Model output is untrusted: it is only ever shown as
 * text and used as search words.
 *
 * 2.1 — the answers are kept (one resolver for every card), so Play, then
 * Save or Add to queue, never searches again. Play starts on the first song
 * found, in the list's order, and adds the rest to the queue as they are
 * found. A row with no match says so.
 */

const PREVIEW_ROWS = 4;

let resolverLoad: Promise<SongResolver> | null = null;
let resolverReady: SongResolver | null = null;
function getResolver(): Promise<SongResolver> {
  resolverLoad ??= import('./suggest').then(
    (m) => (resolverReady = m.createSongResolver()),
    (e: unknown) => {
      resolverLoad = null; // the next press tries again
      throw e;
    },
  );
  return resolverLoad;
}

/** Bumped by every Play press on any card: an older press stops adding songs. */
let playRun = 0;

const uniqueSongs = (found: readonly Lookup[]): Song[] => {
  const seen = new Set<string>();
  const out: Song[] = [];
  for (const s of found) {
    if (!s || seen.has(s.id)) continue;
    seen.add(s.id);
    out.push(s);
  }
  return out;
};

const plural = (n: number): string => `${n} song${n === 1 ? '' : 's'}`;

function missingToast(found: readonly Lookup[]): void {
  const missing = found.filter((s) => s === null).length;
  if (missing > 0) toast(`${missing === 1 ? '1 song is' : `${missing} songs are`} not in the catalogue`);
}

type Busy = 'play' | 'save' | 'queue';

export function PlaylistCard({ text }: { text: string }) {
  const draft = parsePlaylistBlock(text);
  const navigate = useNavigate();
  const [busy, setBusy] = useState<Busy | null>(null);
  const [open, setOpen] = useState(false);
  const [, rowsChanged] = useReducer((n: number) => n + 1, 0);
  if (!draft.songs.length) return null;

  const refs = draft.songs;
  const from = { kind: 'playlist', label: draft.title } as const;

  /** Every song, in order; kept answers come back at once. */
  const resolveAll = async (): Promise<Lookup[]> => {
    const resolver = await getResolver();
    return resolver.resolve(refs, rowsChanged);
  };

  const nothingFound = (found: readonly Lookup[]): void => {
    toast(found.some((s) => s === null) ? 'None of these songs are in the catalogue right now' : 'Could not reach the catalogue. Try again.');
  };

  /** Resolves once something is playing (or nothing can); the rest goes on in the background. */
  const play = async (): Promise<void> => {
    const resolver = await getResolver();
    const { usePlayerStore } = await import('@/store/playerStore');
    const player = () => usePlayerStore.getState();
    const run = ++playRun;
    const known = refs.map((r) => resolver.peek(r));
    if (known.every((s) => s !== undefined)) {
      const songs = uniqueSongs(known);
      if (!songs.length) return nothingFound(known);
      player().playQueue(songs, 0, { from });
      missingToast(known);
      return;
    }
    const { orderedFeed } = await import('./suggest');
    let firstId: string | null = null;
    let stopped = false;
    // With shuffle on, the rest waits for every answer and goes in shuffled, as a full list would.
    const shuffled = player().shuffle;
    const held: Song[] = [];
    const add = (songs: Song[]): void => {
      if (shuffled) held.push(...songs);
      else player().extendList(songs);
    };
    const stillOurs = (): boolean => run === playRun && firstId !== null && player().queue.some((s) => s.id === firstId);
    let started!: () => void;
    const playing = new Promise<void>((r) => (started = r));
    const feed = orderedFeed(refs.length, (songs) => {
      if (stopped) return;
      // Another Play press, or the listener started something else: stop adding.
      if (run !== playRun || (firstId !== null && !stillOurs())) {
        stopped = true;
        return;
      }
      if (firstId === null) {
        const [head, ...rest] = songs;
        // The rest of the playlist joins "Next from" as it arrives.
        player().playQueue([head], 0, { from });
        const p = player();
        started();
        if (p.queue[p.index]?.id !== head.id) {
          stopped = true; // a sign-in sheet, Listen Together or kid mode said no
          return;
        }
        firstId = head.id;
        if (rest.length) add(rest);
        return;
      }
      add(songs);
    });
    const all = resolver
      .resolve(refs, (i, song) => {
        feed(i, song);
        rowsChanged();
      })
      .then((found) => {
        if (run !== playRun) return;
        if (firstId === null && !stopped) nothingFound(found);
        else if (firstId !== null) {
          if (held.length && !stopped && stillOurs()) player().extendList(shuffleSongs(held));
          missingToast(found);
        }
      })
      .catch(() => undefined);
    await Promise.race([playing, all]);
  };

  const save = async (): Promise<void> => {
    const found = await resolveAll();
    const songs = uniqueSongs(found);
    if (!songs.length) return nothingFound(found);
    const { useLibraryStore } = await import('@/store/libraryStore');
    const lib = useLibraryStore.getState();
    const id = lib.createCollection(draft.title);
    const added = lib.addManyToCollection(id, songs);
    if (added > 0) toast(`Saved “${draft.title}” with ${plural(added)}`, { action: { label: 'Open', onClick: () => navigate(`/collection/${id}`) } });
    missingToast(found);
  };

  const queue = async (): Promise<void> => {
    const found = await resolveAll();
    const songs = uniqueSongs(found);
    if (!songs.length) return nothingFound(found);
    const { usePlayerStore } = await import('@/store/playerStore');
    usePlayerStore.getState().enqueueAll(songs);
    missingToast(found);
  };

  const press = async (kind: Busy): Promise<void> => {
    if (busy) return;
    setBusy(kind);
    try {
      if (kind !== 'save') {
        // Ask a signed-out visitor first, so the whole list plays once they are in.
        const { requireAccount } = await import('@/services/auth/gate');
        if (!requireAccount('listen', () => void press(kind))) return;
      }
      await (kind === 'play' ? play() : kind === 'save' ? save() : queue());
    } catch {
      toast('Could not reach the catalogue. Try again.');
    } finally {
      setBusy(null);
    }
  };

  const rows = open ? refs : refs.slice(0, PREVIEW_ROWS);
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
          <span>Playlist · {plural(refs.length)}</span>
        </span>
        <span className="vx-ai-playlist-actions">
          <button type="button" className="vx-ai-playlist-play" onClick={() => void press('play')} disabled={busy !== null}>
            <PlayIcon className="w-4 h-4" />
            <span>{busy === 'play' ? 'Finding songs…' : 'Play'}</span>
          </button>
          <button type="button" className="vx-ai-playlist-save" onClick={() => void press('queue')} disabled={busy !== null}>
            <QueueIcon className="w-4 h-4" />
            <span>{busy === 'queue' ? 'Adding…' : 'Add to queue'}</span>
          </button>
          <button type="button" className="vx-ai-playlist-save" onClick={() => void press('save')} disabled={busy !== null}>
            <PlusIcon className="w-4 h-4" />
            <span>{busy === 'save' ? 'Saving…' : 'Save to library'}</span>
          </button>
        </span>
      </div>
      <ol className="vx-ai-playlist-list">
        {rows.map((s, i) => {
          const missing = resolverReady?.peek(s) === null;
          return (
            <li key={`${i}-${s.title}`} className={missing ? 'is-missing' : undefined}>
              <span className="vx-ai-playlist-n">{i + 1}</span>
              <span className="vx-ai-playlist-title">{s.title}</span>
              <span className="vx-ai-playlist-artist">{missing ? 'Not in the catalogue' : s.artist}</span>
            </li>
          );
        })}
      </ol>
      {refs.length > PREVIEW_ROWS && (
        <button type="button" className="vx-ai-playlist-more" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? 'Show fewer' : `Show all ${refs.length} songs`}
        </button>
      )}
    </section>
  );
}
