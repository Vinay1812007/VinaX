import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { Song } from '@/types';
import { searchSongs } from '@/services/api';
import { usePlayerStore, useCurrentSong } from '@/store/playerStore';
import { useLibraryStore } from '@/store/libraryStore';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { toast } from '@/store/toastStore';
import { haptic } from '@/services/native';
import { cn } from '@/utils/cn';
import { FavButton } from '@/components/FavButton';
import { MusicIcon, PauseIcon, PlayIcon, PlusIcon, QueueIcon, SearchIcon } from '@/components/Icons';
import { TrackMenu } from '@/components/TrackMenu';
import { betterMatch, matchPick, type MatchResult, type SongPickRef } from './songMatch';

export type { MatchResult, SongPickRef } from './songMatch';

/**
 * v5.10.0 — song picks you can play. Every "Title — Artist" line the
 * assistant writes (the format MUSIC_CONDUCT mandates for recommendations)
 * becomes a row that resolves to the real catalogue song and plays on tap;
 * a reply with two or more picks gets a Play all / Add to queue / Save as
 * playlist bar. Nothing is fetched until the row is on screen, and identical
 * picks share one lookup through react-query.
 *
 * 9.0 — the row is drawn like the app's track rows (squircle artwork, title
 * over artist, the playing song in Iris) with Add to queue, the heart and
 * the song menu beside it; a pick the catalogue does not have says so and
 * offers a search instead of pretending.
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

  // Sibling controls, never a button inside a role="button": the main area
  // is a real <button> (Enter and Space both activate it, focus ring comes
  // for free) and the queue, heart and menu sit next to it.
  return (
    <div
      className={cn('ai-track', song ? 'is-live' : 'is-missing', isCurrent && 'is-current', isCurrent && isPlaying && 'is-playing')}
      data-deter-context
      data-song-id={song?.id}
      data-match={match?.status}
    >
      {song ? (
        <button
          type="button"
          onClick={play}
          aria-label={`${isCurrent && isPlaying ? 'Pause' : 'Play'} ${song.title} by ${song.subtitle}${uncertain ? ' (closest match)' : ''}`}
          className="ai-track-main"
        >
          <span className="ai-track-art">
            <img
              src={bestImage(song.images, 150)}
              onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)}
              alt=""
              loading="lazy"
              width={44}
              height={44}
            />
            <span className="ai-track-over" aria-hidden>
              {isCurrent && isPlaying ? <PauseIcon /> : <PlayIcon />}
            </span>
          </span>
          <span className="ai-track-text">
            <span className="ai-track-title">{song.title}</span>
            <span className="ai-track-sub">
              <span>{song.subtitle}</span>
              {uncertain && (
                <span className="ai-track-tag" title={`You asked for “${pick.title}” by ${pick.artist || 'an unnamed artist'}; this is the closest the catalogue offers.`}>
                  Closest match
                </span>
              )}
            </span>
          </span>
        </button>
      ) : (
        <div className="ai-track-main">
          <span className={cn('ai-track-art', isLoading && 'skeleton')} aria-hidden>
            {!isLoading && <MusicIcon />}
          </span>
          <span className="ai-track-text">
            <span className="ai-track-title">{pick.title}</span>
            <span className="ai-track-sub">
              <span>{pick.artist}</span>
            </span>
          </span>
        </div>
      )}
      {song ? (
        <span className="ai-track-actions">
          <button
            type="button"
            aria-label={`Add ${song.title} to queue`}
            title="Add to queue"
            // The store says "Added to queue" (or "Already in queue") itself.
            onClick={() => enqueue(song)}
            className="ai-track-btn"
          >
            <QueueIcon />
          </button>
          <FavButton song={song} className="ai-track-fav" />
          <TrackMenu song={song} label={`More options for ${song.title}`} />
        </span>
      ) : (
        !isLoading && (
          <span className="ai-track-actions">
            <span className="ai-track-tag" role="status">
              Not in the catalogue
            </span>
            <Link
              to={`/search/${encodeURIComponent(`${pick.title} ${pick.artist}`.trim())}`}
              className="ai-track-btn"
              aria-label={`Search for ${pick.title}`}
              title="Search for it"
            >
              <SearchIcon />
            </Link>
          </span>
        )
      )}
    </div>
  );
}

/** Play all / Add to queue / Save as playlist for a reply with two or more picks. */
export function SongPicksBar({ picks }: { picks: SongPickRef[] }) {
  const qc = useQueryClient();
  const playQueue = usePlayerStore((s) => s.playQueue);
  const enqueueAll = usePlayerStore((s) => s.enqueueAll);
  const createCollection = useLibraryStore((s) => s.createCollection);
  const addToCollection = useLibraryStore((s) => s.addToCollection);
  /** Which action is still resolving the picks (a first tap can wait on the catalogue). */
  const [pending, setPending] = useState<'play' | 'queue' | 'save' | null>(null);

  // Confirmed matches AND the "closest match" rows the listener can already
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
  const run = (kind: 'play' | 'queue' | 'save', act: (songs: Song[]) => void): void => {
    if (pending) return;
    setPending(kind);
    void resolveAll()
      .then((songs) => {
        if (!songs.length) return toast('None of these could be found');
        act(songs);
      })
      .finally(() => setPending(null));
  };

  return (
    <div className="ai-picks-bar" role="group" aria-label="Song picks">
      <button
        type="button"
        aria-busy={pending === 'play' || undefined}
        onClick={() =>
          run('play', (songs) => {
            playQueue(songs, 0);
            toast(`Playing ${songs.length} songs${closeNote()}`);
            haptic('medium');
          })
        }
        className="ai-picks-play"
      >
        <span aria-hidden>
          <PlayIcon />
        </span>
        Play all
      </button>
      <button
        type="button"
        aria-busy={pending === 'queue' || undefined}
        onClick={() =>
          run('queue', (songs) => {
            // 9.0 — the list action the rest of the app uses (one "Added N songs
            // to queue" from the store, not one toast per song); the closest-
            // match note is ours, so nobody is told every pick was exact.
            enqueueAll(songs);
            if (closeCount) toast(`${closeCount} of them ${closeCount === 1 ? 'is the closest match' : 'are the closest matches'} in the catalogue`);
          })
        }
        className="ai-chip"
      >
        <QueueIcon /> Add to queue
      </button>
      {/* v5.16.0 — one tap turns the picks into a saved playlist. */}
      <button
        type="button"
        aria-busy={pending === 'save' || undefined}
        onClick={() =>
          run('save', (songs) => {
            const name = `AI picks · ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;
            const id = createCollection(name);
            for (const s of songs) addToCollection(id, s);
            toast(`Saved “${name}” with ${songs.length} songs${closeNote()}`);
            haptic('light');
          })
        }
        className="ai-chip"
        title="Save these songs as a playlist"
      >
        <PlusIcon /> Save as playlist
      </button>
      <span className="ai-picks-count">{picks.length} songs</span>
    </div>
  );
}
