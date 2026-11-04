import { Link, useNavigate, useParams } from 'react-router-dom';
import { extractId, songPath } from '@/utils/slug';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSongDetails } from '@/features/player/useSongDetails';
import { useSyncedLyrics } from '@/features/lyrics/useSyncedLyrics';
import { SyncedLyrics } from '@/components/SyncedLyrics';
import { useSettingsStore } from '@/store/settingsStore';
import { useLyricsOffsetStore } from '@/store/lyricsOffsetStore';
import { LyricShareSheet } from '@/components/LyricShareSheet';
import { EmptyState } from '@/components/States';
import { ListSkeleton } from '@/components/Skeletons';
import { useEffect, useState } from 'react';
import { useCurrentSong, usePlayerStore } from '@/store/playerStore';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { MicIcon, PlayIcon } from '@/components/Icons';
import { cn } from '@/utils/cn';
import { useQuery } from '@tanstack/react-query';
import { Sheet, SheetHeader } from '@/components/Sheet';
import { aiLyricLines, aiLyricsMeaning, mostlyNonLatin, type LyricsLineMode } from '@/services/ai/lyricsAi';
import type { Song } from '@/types';
import '@/styles/pages/player.css';

/** The song's meaning and mood, explained by the music AI (asked when the sheet opens). */
function MeaningSheet({ song, lines, onClose }: { song: Song; lines: string[]; onClose(): void }) {
  const q = useQuery({
    queryKey: ['ai-lyrics-meaning', song.id, lines.length],
    queryFn: ({ signal }) => aiLyricsMeaning(lines, song, { signal }),
    staleTime: Infinity,
    retry: false,
  });
  return (
    <Sheet onClose={onClose} labelledBy="lyrics-meaning-title" size="md">
      <SheetHeader id="lyrics-meaning-title" title="What this song means" subtitle={`${song.title} · explained by AI`} onClose={onClose} className="mb-3" />
      {q.isLoading ? (
        <p className="text-[14px] text-ink-300" role="status">Reading the lyrics…</p>
      ) : q.data ? (
        <>
          <p className="text-[15px] leading-relaxed text-ink-100">{q.data.meaning}</p>
          {q.data.mood && <p className="mt-3 text-[13px] text-ink-300">Mood: <span className="font-semibold text-ink-100">{q.data.mood}</span></p>}
          <p className="mt-4 text-[11.5px] text-ink-500">AI can get things wrong. Only the song’s lyrics were sent.</p>
        </>
      ) : (
        <p className="text-[14px] text-ink-300" role="status">Couldn’t explain this song right now. Try again later.</p>
      )}
    </Sheet>
  );
}

export default function LyricsPage() {
  const { id: rawId } = useParams();
  const id = extractId(rawId);
  const { data: song, isLoading: songLoading } = useSongDetails(id);
  const lyrics = useSyncedLyrics(song);
  const current = useCurrentSong();
  const playSong = usePlayerStore((s) => s.playSong);
  const navigate = useNavigate();
  // If you opened the lyrics of the song that was playing, follow it: when the
  // track advances, switch this page to the new song's lyrics.
  const [followLive] = useState(() => !!current && current.id === id);
  useEffect(() => {
    if (followLive && current && current.id !== id) {
      navigate(`/lyrics/${current.id}`, { replace: true });
    }
  }, [followLive, current, id, navigate]);
  usePageTitle(song ? `Lyrics · ${song.title}` : 'Lyrics');

  const isLive = !!song && current?.id === song.id;
  const size = useSettingsStore((s) => s.lyricsSize);
  const setSize = useSettingsStore((s) => s.setLyricsSize);
  const offsets = useLyricsOffsetStore((s) => s.offsets);
  const offset = song ? offsets[song.id] ?? 0 : 0;
  const [shareOpen, setShareOpen] = useState(false);
  const shareLines = lyrics.data?.synced
    ? lyrics.data.synced.map((l) => l.text).filter((t) => !!t && t.trim().length > 0)
    : (lyrics.data?.plain ?? '').split('\n').map((t) => t.trim()).filter(Boolean);
  // 1.3 — "Romanized" is the lyrics-script setting: the catalogue sends the
  // lines in English letters; when it has no such copy, the music AI
  // romanizes them. "English" is an AI translation. Both keep one line per
  // line, so synced timings still apply.
  const script = useSettingsStore((s) => s.lyricsScript);
  const setScript = useSettingsStore((s) => s.setLyricsScript);
  const [english, setEnglish] = useState(false);
  const [meaningOpen, setMeaningOpen] = useState(false);
  type LMode = 'original' | 'romanize' | 'english';
  const lmode: LMode = english ? 'english' : script === 'latin' ? 'romanize' : 'original';
  const setMode = (m: LMode) => {
    setEnglish(m === 'english');
    if (m !== 'english') setScript(m === 'romanize' ? 'latin' : 'original');
  };
  const sourceLines = lyrics.data?.synced ? lyrics.data.synced.map((l) => l.text) : lyrics.data?.plain ? lyrics.data.plain.split('\n') : [];
  const aiMode: LyricsLineMode | null = lmode === 'english' ? 'translate' : lmode === 'romanize' && mostlyNonLatin(sourceLines) ? 'romanize' : null;
  const ai = useQuery({
    queryKey: ['ai-lyrics', aiMode, song?.id, sourceLines.length, sourceLines.find((l) => l.trim()) ?? ''],
    enabled: !!aiMode && !!song && sourceLines.length > 0,
    queryFn: ({ signal }) => aiLyricLines(aiMode!, sourceLines, song!, { signal }),
    staleTime: Infinity,
    retry: false,
  });
  const aiLines = aiMode && ai.data ? ai.data : null;
  const displaySynced = aiLines && lyrics.data?.synced ? lyrics.data.synced.map((l, i) => ({ ...l, text: aiLines[i] ?? l.text })) : lyrics.data?.synced ?? null;
  const displayPlain = aiLines && !lyrics.data?.synced ? aiLines.join('\n') : lyrics.data?.plain ?? null;
  const aiStatus = !aiMode ? null : ai.isFetching ? (aiMode === 'translate' ? 'Translating with AI…' : 'Romanizing with AI…') : aiLines ? (aiMode === 'translate' ? 'English translation by AI' : 'Romanized by AI') : ai.isFetched ? `Couldn’t ${aiMode === 'translate' ? 'translate' : 'romanize'} right now, so the original is shown.` : null;

  const sizeLabel = { sm: 'Small text', md: 'Medium text', lg: 'Large text', xl: 'Extra large text' } as const;

  return (
    <div className="vx-lyrics-page">
      {song && (
        <div className="vx-lyrics-hero">
          <img src={bestImage(song.images, 300)} onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)} alt="" />
          <div className="vx-lyrics-hero-text">
            <p className="vx-lyrics-hero-label">Lyrics</p>
            <h1>
              <Link to={songPath(song)} className="vx-lyrics-hero-title">{song.title}</Link>
            </h1>
            <p className="vx-lyrics-hero-artist">{song.subtitle}</p>
          </div>
          {!isLive && (
            <button
              type="button"
              onClick={() => playSong(song)}
              className="vx-tap flex items-center gap-1.5 min-h-[40px] px-4 rounded-full btn-primary text-[13px] font-bold shrink-0"
            >
              <PlayIcon className="w-4 h-4" /> Play to sync
            </button>
          )}
        </div>
      )}

      {(songLoading || lyrics.isLoading) && <ListSkeleton rows={10} />}

      {!lyrics.isLoading && !songLoading && !lyrics.data && (
        <EmptyState
          icon={<MicIcon className="w-7 h-7" />}
          title="Lyrics unavailable"
          message="No source has lyrics for this song yet. Coverage varies by language and label."
        />
      )}

      {lyrics.data && (
        <div className="vx-lyrics-toolbar">
          <div className="vx-lyrics-toolbar-group">
            <div className="vx-np-tabs" role="group" aria-label="Lyrics language">
              {([['original', 'Original'], ['romanize', 'Romanized'], ['english', 'English']] as const).map(([m, label]) => (
                <button key={m} type="button" onClick={() => setMode(m)} aria-pressed={lmode === m} className="vx-seg">
                  {label}
                </button>
              ))}
            </div>
            <div className="vx-np-tabs" role="group" aria-label="Lyrics text size">
              {(['sm', 'md', 'lg', 'xl'] as const).map((sz) => (
                <button key={sz} type="button" onClick={() => setSize(sz)} aria-pressed={size === sz} aria-label={sizeLabel[sz]} title={sizeLabel[sz]} className="vx-seg">
                  {sz === 'sm' ? 'A' : sz === 'md' ? 'A+' : sz === 'lg' ? 'A++' : 'A+++'}
                </button>
              ))}
            </div>
          </div>
          {shareLines.length > 0 && (
            <div className="vx-lyrics-toolbar-group">
              {isLive && (
                <Link to="/karaoke" className="vx-np-pill">
                  Karaoke
                </Link>
              )}
              <button type="button" onClick={() => setMeaningOpen(true)} className="vx-np-pill">
                Meaning
              </button>
              <button type="button" onClick={() => setShareOpen(true)} className="vx-np-pill">
                Share lyrics
              </button>
            </div>
          )}
        </div>
      )}

      {aiStatus && <p className="vx-lyrics-foot !mt-0 !mb-2" role="status" aria-live="polite">{aiStatus}</p>}
      {lyrics.data?.synced && song && (
        <div className="vx-lyrics-sync" role="group" aria-label="Lyrics sync offset">
          <span className="vx-lyrics-sync-label">Sync</span>
          <button type="button" onClick={() => useLyricsOffsetStore.getState().nudge(song.id, -0.2)} aria-label="Lyrics earlier" className="vx-np-pill !px-0 w-11 text-[15px]">−</button>
          <span className="vx-lyrics-sync-value">{offset === 0 ? '0.0s' : `${offset > 0 ? '+' : ''}${offset.toFixed(1)}s`}</span>
          <button type="button" onClick={() => useLyricsOffsetStore.getState().nudge(song.id, 0.2)} aria-label="Lyrics later" className="vx-np-pill !px-0 w-11 text-[15px]">+</button>
          {offset !== 0 && (
            <button type="button" onClick={() => useLyricsOffsetStore.getState().reset(song.id)} className="vx-np-pill is-quiet">Reset</button>
          )}
          <span className="vx-lyrics-sync-hint hidden sm:block">Nudge if lyrics run ahead of or behind the song</span>
        </div>
      )}
      {lyrics.data?.synced ? (
        <>
          <div className="vx-np-lyrics vx-lyrics-page-scroll">
            <SyncedLyrics lines={displaySynced ?? lyrics.data.synced} live={isLive} size={size} className="py-4" />
          </div>
          <p className="vx-lyrics-foot">
            Synced lyrics{isLive ? ' · tap a line to seek' : ' · play this song to follow along live'}
          </p>
        </>
      ) : lyrics.data?.plain ? (
        <>
          <pre className={cn('vx-lyrics-plain', size === 'sm' ? 'text-base leading-8' : size === 'md' ? 'text-lg leading-9' : size === 'lg' ? 'text-2xl leading-10' : 'text-3xl leading-[1.5]')}>{displayPlain ?? lyrics.data.plain}</pre>
          <p className="vx-lyrics-foot">
            Lyrics from community catalogs · not timed to the song
          </p>
        </>
      ) : null}

      {meaningOpen && song && <MeaningSheet song={song} lines={sourceLines} onClose={() => setMeaningOpen(false)} />}
      {shareOpen && song && (
        <LyricShareSheet lines={shareLines} song={song} onClose={() => setShareOpen(false)} />
      )}
    </div>
  );
}
