import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { Song } from '@/types';
import { searchSongs } from '@/services/api';
import { usePlayerStore, useCurrentSong } from '@/store/playerStore';
import { useLibraryStore } from '@/store/libraryStore';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { toast } from '@/store/toastStore';
import { haptic } from '@/services/native';
import { cn } from '@/utils/cn';
import { PauseIcon, PlayIcon, QueueIcon } from '@/components/Icons';
import { betterMatch, matchPick, type MatchResult, type SongPickRef } from './songMatch';

export type { MatchResult, SongPickRef } from './songMatch';

/**
 * v5.10.0 — song picks you can play. Every "Title — Artist" line the
 * assistant writes (the format MUSIC_CONDUCT mandates for recommendations)
 * becomes a chip that resolves to the real catalogue song and plays on tap;
 * a reply with two or more picks gets a Play all / Add to queue bar. Nothing
 * is fetched until the chip is on screen, and identical picks share one
 * lookup through react-query.
 */
// One song line: optional list marker, then Title <dash> Artist, both short.
// Same shape threadMemory uses so what the model "remembers recommending"
// and what the listener sees as playable never disagree.
const LINE_RE = /^\s*(?:[-*•]\s*|\d+[.)]\s*)?(.{2,60}?)\s+[—–]\s+(.{2,60}?)\s*$/;

function cleanPart(s: string): string {
  return s
    .replace(/[*_`]+/g, '')
    .replace(/^["'“”‘’«»]+|["'“”‘’«»]+$/g, '')
    .replace(/[.,;:!]+$/, '')
    .trim();
}

/** "Title — Artist" → pick, or null for ordinary prose. */
export function parseSongLine(line: string): SongPickRef | null {
  const m = LINE_RE.exec(line);
  if (!m) return null;
  const title = cleanPart(m[1]);
  const artist = cleanPart(m[2]);
  if (!title || !artist) return null;
  // Prose that happens to carry a dash ("Yes — but only if…") has clause-like
  // halves; a song line has a short name on the left and no sentence
  // punctuation on the right.
  if (/[?!]/.test(title) || /[?!]/.test(artist)) return null;
  if (title.split(' ').length > 9 || artist.split(' ').length > 8) return null;
  return { title, artist };
}

/** Every unique pick in a reply, in order. */
export function extractSongPicks(text: string): SongPickRef[] {
  const seen = new Set<string>();
  const out: SongPickRef[] = [];
  for (const raw of text.split('\n')) {
    const p = parseSongLine(raw);
    if (!p) continue;
    const key = `${p.title}|${p.artist}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

const pickKey = (p: SongPickRef) => ['song-pick', p.title.toLowerCase(), p.artist.toLowerCase()] as const;
/** The react-query key for a pick (so callers can invalidate it for a fresh retry). */
export const pickQueryKey = pickKey;

/**
 * Resolve a pick against the catalogue with an honest verdict. The first
 * search combines title + artist; when that is not a confident match and
 * an artist was given, a title-only search runs and the stronger result
 * wins. Nothing here ever accepts "the first result" — see songMatch.ts.
 */
export async function resolvePickMatch(pick: SongPickRef, signal?: AbortSignal): Promise<MatchResult> {
  const combined = await searchSongs(`${pick.title} ${pick.artist}`.trim(), 6, { signal });
  let result = matchPick(pick, combined);
  if (result.status !== 'matched' && pick.artist) {
    if (signal?.aborted) return result;
    const byTitle = await searchSongs(pick.title, 6, { signal });
    result = betterMatch(result, matchPick(pick, byTitle));
  }
  return result;
}

const PICK_STALE_MS = 60 * 60_000;

/** Full verdict for a pick (cached an hour). Used by the import review. */
export function fetchPickMatch(qc: QueryClient, pick: SongPickRef, signal?: AbortSignal): Promise<MatchResult> {
  return qc.fetchQuery({ queryKey: pickKey(pick), queryFn: ({ signal: qs }) => resolvePickMatch(pick, signal ?? qs), staleTime: PICK_STALE_MS });
}

/** Only a CONFIRMED match, or null — never an uncertain or unrelated song. */
export async function fetchPick(qc: QueryClient, pick: SongPickRef): Promise<Song | null> {
  const m = await fetchPickMatch(qc, pick);
  return m.status === 'matched' ? m.song : null;
}

/** One playable pick. */
export function SongPickChip({ pick }: { pick: SongPickRef }) {
  const { data: match, isLoading } = useQuery({
    queryKey: pickKey(pick),
    queryFn: ({ signal }) => resolvePickMatch(pick, signal),
    staleTime: PICK_STALE_MS,
    retry: false,
  });
  const song = match?.status === 'missing' ? null : (match?.song ?? null);
  const uncertain = match?.status === 'uncertain';
  const playQueue = usePlayerStore((s) => s.playQueue);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const enqueue = usePlayerStore((s) => s.enqueue);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const current = useCurrentSong();
  const isCurrent = !!song && current?.id === song.id;

  const play = () => {
    if (!song) return;
    if (isCurrent) togglePlay();
    else playQueue([song], 0);
    haptic('light');
  };

  // Two SIBLING controls, never a button inside a role="button": the main
  // area is a real <button> (Enter and Space both activate it, focus ring
  // comes for free) and the queue button sits next to it.
  const Main = song ? 'button' : 'div';
  return (
    <div
      className={cn('group/pick ai-pick my-1.5 pr-2 flex items-stretch', song ? 'ai-pick-live' : 'opacity-80')}
      data-deter-context
      data-song-id={song?.id}
      data-match={match?.status}
    >
      <Main
        type={song ? 'button' : undefined}
        onClick={song ? play : undefined}
        aria-label={song ? `${isCurrent && isPlaying ? 'Pause' : 'Play'} ${song.title} by ${song.subtitle}${uncertain ? ' (closest match)' : ''}` : undefined}
        className={cn('flex items-center gap-2.5 min-w-0 flex-1 text-left rounded-l-[11px]', song && 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember-400')}
      >
        <div className="relative w-12 h-12 shrink-0 overflow-hidden rounded-l-[11px] bg-ink-800">
          {song ? (
            <img
              src={bestImage(song.images, 150)}
              onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)}
              alt=""
              loading="lazy"
              className="w-12 h-12 object-cover"
            />
          ) : (
            <span className={cn('absolute inset-0', isLoading && 'skeleton')} aria-hidden />
          )}
          {song && (
            <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-white opacity-0 group-hover/pick:opacity-100 group-focus-within/pick:opacity-100 transition-opacity" aria-hidden>
              {isCurrent && isPlaying ? <PauseIcon className="w-5 h-5" /> : <PlayIcon className="w-5 h-5 ml-0.5" />}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1 py-1.5">
          <p className={cn('text-[13px] font-bold truncate leading-tight', isCurrent && 'text-ember-400')}>{song?.title ?? pick.title}</p>
          <p className="text-[11px] ai-t3 truncate mt-0.5">
            {song?.subtitle ?? pick.artist}
            {uncertain && <span className="ml-1.5 rounded-md border ai-hairline px-1 py-px text-[10px] font-semibold" title={`You asked for “${pick.title}” by ${pick.artist || 'an unnamed artist'}; this is the closest the catalogue offers.`}>closest match</span>}
          </p>
        </div>
      </Main>
      {song ? (
        <button
          type="button"
          aria-label={`Add ${song.title} to queue`}
          title="Add to queue"
          onClick={() => {
            enqueue(song);
            toast(`Queued ${song.title}`);
          }}
          className="ai-icon-btn w-8 h-8 self-center"
        >
          <QueueIcon className="w-4 h-4" />
        </button>
      ) : (
        !isLoading && (
          <span className="text-[10px] font-semibold ai-t3 shrink-0 self-center rounded-md border ai-hairline px-1.5 py-0.5" role="status">
            not found
          </span>
        )
      )}
    </div>
  );
}

/** Play all / Add to queue for a reply with two or more picks. */
export function SongPicksBar({ picks }: { picks: SongPickRef[] }) {
  const qc = useQueryClient();
  const playQueue = usePlayerStore((s) => s.playQueue);
  const enqueue = usePlayerStore((s) => s.enqueue);
  const createCollection = useLibraryStore((s) => s.createCollection);
  const addToCollection = useLibraryStore((s) => s.addToCollection);
  // v5.16.0 — one tap turns the picks into a saved playlist.
  const saveAsPlaylist = (): void => {
    void resolveAll().then((songs) => {
      if (!songs.length) return toast('None of these could be found');
      const name = `AI picks · ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;
      const id = createCollection(name);
      for (const s of songs) addToCollection(id, s);
      toast(`Saved “${name}” with ${songs.length} songs${closeNote()}`);
      haptic('light');
    });
  };

  // Confirmed matches AND the "closest match" chips the listener can already
  // see (never a missing one). Uncertain picks are counted so the toast can
  // say so instead of pretending every song is exact.
  let closeCount = 0;
  const resolveAll = async (): Promise<Song[]> => {
    const matches = await Promise.all(picks.map((p) => fetchPickMatch(qc, p).catch(() => null)));
    const seen = new Set<string>();
    closeCount = matches.filter((m) => m?.status === 'uncertain').length;
    return matches
      .map((m) => (m && m.status !== 'missing' ? m.song : null))
      .filter((s): s is Song => !!s && !seen.has(s.id) && (seen.add(s.id), true));
  };
  const closeNote = () => (closeCount ? ` (${closeCount} closest match${closeCount === 1 ? '' : 'es'})` : '');

  return (
    <div className="flex flex-wrap items-center gap-1.5 mb-2.5" aria-label="Song picks">
      <button
        onClick={() => {
          void resolveAll().then((songs) => {
            if (!songs.length) return toast('None of these could be found');
            playQueue(songs, 0);
            toast(`Playing ${songs.length} songs${closeNote()}`);
            haptic('medium');
          });
        }}
        className="btn-primary rounded-xl px-3.5 py-1.5 text-[12px] inline-flex items-center gap-1.5 shrink-0"
      >
        <PlayIcon className="w-3.5 h-3.5" /> Play all
      </button>
      <button
        onClick={() => {
          void resolveAll().then((songs) => {
            if (!songs.length) return toast('None of these could be found');
            for (const s of songs) enqueue(s);
            toast(`Queued ${songs.length} songs${closeNote()}`);
          });
        }}
        className="ai-chip py-[7px] shrink-0"
      >
        <QueueIcon className="w-3.5 h-3.5" /> Add to queue
      </button>
      <button onClick={saveAsPlaylist} className="ai-chip py-[7px] shrink-0" title="Save these songs as a playlist">
        Save as playlist
      </button>
      <span className="text-[11px] font-semibold ai-t3 shrink-0 pl-1">{picks.length} songs</span>
    </div>
  );
}
