import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { Song } from '@/types';
import { searchSongs } from '@/services/api';
import { usePlayerStore, useCurrentSong } from '@/store/playerStore';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { toast } from '@/store/toastStore';
import { haptic } from '@/services/native';
import { cn } from '@/utils/cn';
import { PauseIcon, PlayIcon, QueueIcon } from '@/components/Icons';

/**
 * v5.10.0 — song picks you can play. Every "Title — Artist" line the
 * assistant writes (the format MUSIC_CONDUCT mandates for recommendations)
 * becomes a chip that resolves to the real catalogue song and plays on tap;
 * a reply with two or more picks gets a Play all / Add to queue bar. Nothing
 * is fetched until the chip is on screen, and identical picks share one
 * lookup through react-query.
 */
export interface SongPickRef {
  title: string;
  artist: string;
}

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

const norm = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s*\((?:from|from the)\b[^)]*\)/gi, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** The catalogue song a pick means: title must match, artist decides ties. */
function bestMatch(pick: SongPickRef, results: Song[]): Song | null {
  const want = norm(pick.title);
  const artistTokens = norm(pick.artist).split(' ').filter((t) => t.length > 2);
  let best: Song | null = null;
  let bestScore = 0;
  for (const s of results) {
    const got = norm(s.title);
    let score = 0;
    if (got === want) score += 4;
    else if (got.includes(want) || want.includes(got)) score += 2;
    else continue;
    const credits = norm(`${s.subtitle} ${s.artists.map((a) => a.name).join(' ')}`);
    if (artistTokens.some((t) => credits.includes(t))) score += 2;
    if (score > bestScore) {
      best = s;
      bestScore = score;
    }
  }
  return best ?? results[0] ?? null;
}

const pickKey = (p: SongPickRef) => ['song-pick', p.title.toLowerCase(), p.artist.toLowerCase()] as const;

async function resolvePick(pick: SongPickRef): Promise<Song | null> {
  const results = await searchSongs(`${pick.title} ${pick.artist}`, 6);
  const hit = bestMatch(pick, results);
  if (hit) return hit;
  const byTitle = await searchSongs(pick.title, 6);
  return bestMatch(pick, byTitle);
}

export function fetchPick(qc: QueryClient, pick: SongPickRef): Promise<Song | null> {
  return qc.fetchQuery({ queryKey: pickKey(pick), queryFn: () => resolvePick(pick), staleTime: 60 * 60_000 });
}

/** One playable pick. */
export function SongPickChip({ pick }: { pick: SongPickRef }) {
  const { data: song, isLoading } = useQuery({
    queryKey: pickKey(pick),
    queryFn: () => resolvePick(pick),
    staleTime: 60 * 60_000,
    retry: false,
  });
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

  return (
    <div
      className={cn(
        'group/pick my-1 flex items-center gap-3 rounded-md pr-2 transition-colors',
        song ? 'bg-ink-850 hover:bg-ink-800 cursor-pointer' : 'bg-ink-850/60',
      )}
      onClick={song ? play : undefined}
      role={song ? 'button' : undefined}
      tabIndex={song ? 0 : undefined}
      onKeyDown={(e) => e.key === 'Enter' && play()}
      data-deter-context
      data-song-id={song?.id}
    >
      <div className="relative w-12 h-12 shrink-0 overflow-hidden rounded-l-md bg-ink-800">
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
          <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-white opacity-0 group-hover/pick:opacity-100 transition-opacity">
            {isCurrent && isPlaying ? <PauseIcon className="w-5 h-5" /> : <PlayIcon className="w-5 h-5 ml-0.5" />}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1 py-1.5">
        <p className={cn('text-[13px] font-bold truncate', isCurrent && 'text-ember-400')}>{song?.title ?? pick.title}</p>
        <p className="text-[11px] text-ink-400 truncate">{song?.subtitle ?? pick.artist}</p>
      </div>
      {song ? (
        <button
          aria-label={`Add ${song.title} to queue`}
          title="Add to queue"
          onClick={(e) => {
            e.stopPropagation();
            enqueue(song);
            toast(`Queued ${song.title}`);
          }}
          className="w-8 h-8 rounded-full flex items-center justify-center text-ink-300 hover:text-ink-100 hover:scale-105 shrink-0"
        >
          <QueueIcon className="w-4 h-4" />
        </button>
      ) : (
        !isLoading && <span className="text-[10px] text-ink-500 shrink-0">not found</span>
      )}
    </div>
  );
}

/** Play all / Add to queue for a reply with two or more picks. */
export function SongPicksBar({ picks }: { picks: SongPickRef[] }) {
  const qc = useQueryClient();
  const playQueue = usePlayerStore((s) => s.playQueue);
  const enqueue = usePlayerStore((s) => s.enqueue);

  const resolveAll = async (): Promise<Song[]> => {
    const songs = await Promise.all(picks.map((p) => fetchPick(qc, p).catch(() => null)));
    const seen = new Set<string>();
    return songs.filter((s): s is Song => !!s && !seen.has(s.id) && (seen.add(s.id), true));
  };

  return (
    <div className="flex items-center gap-2 mb-2">
      <button
        onClick={() => {
          void resolveAll().then((songs) => {
            if (!songs.length) return toast('None of these could be found');
            playQueue(songs, 0);
            toast(`Playing ${songs.length} songs`);
            haptic('medium');
          });
        }}
        className="btn-primary px-4 py-1.5 text-[12px] inline-flex items-center gap-1.5"
      >
        <PlayIcon className="w-3.5 h-3.5" /> Play all
      </button>
      <button
        onClick={() => {
          void resolveAll().then((songs) => {
            if (!songs.length) return toast('None of these could be found');
            for (const s of songs) enqueue(s);
            toast(`Queued ${songs.length} songs`);
          });
        }}
        className="btn-secondary px-4 py-1.5 text-[12px] inline-flex items-center gap-1.5"
      >
        <QueueIcon className="w-3.5 h-3.5" /> Add to queue
      </button>
      <span className="text-[11px] text-ink-400">{picks.length} songs</span>
    </div>
  );
}
