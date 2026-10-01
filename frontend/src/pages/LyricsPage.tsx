import { Link, useNavigate, useParams } from 'react-router-dom';
import { extractId, songPath } from '@/utils/slug';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSongDetails } from '@/features/player/useSongDetails';
import { useSyncedLyrics } from '@/features/lyrics/useSyncedLyrics';
import { SyncedLyrics } from '@/components/SyncedLyrics';
import { useSettingsStore } from '@/store/settingsStore';
import { useLyricsOffsetStore } from '@/store/lyricsOffsetStore';
import { LyricShareSheet } from '@/components/LyricShareSheet';
import { transformLyrics, explainLyrics, type LyricMeaning } from '@/services/lyrics/transform';
import { toast } from '@/store/toastStore';
import { EmptyState } from '@/components/States';
import { ListSkeleton } from '@/components/Skeletons';
import { useEffect, useState } from 'react';
import { useCurrentSong, usePlayerStore } from '@/store/playerStore';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { MicIcon, PlayIcon, SparkleIcon } from '@/components/Icons';
import { cn } from '@/utils/cn';
import '@/styles/pages/player.css';

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
  const [lmode, setLmode] = useState<'original' | 'romanize' | 'translate'>('original');
  const [tlines, setTlines] = useState<string[] | null>(null);
  const [tloading, setTloading] = useState(false);
  const [meaning, setMeaning] = useState<LyricMeaning | null>(null);
  const [meaningOpen, setMeaningOpen] = useState(false);
  const [meaningLoading, setMeaningLoading] = useState(false);
  const transformBase = lyrics.data?.synced
    ? lyrics.data.synced.map((l) => l.text)
    : (lyrics.data?.plain ?? '').split('\n');
  const setMode = async (m: 'original' | 'romanize' | 'translate') => {
    if (m === 'original') { setLmode('original'); setTlines(null); return; }
    if (!song) return;
    setLmode(m);
    setTloading(true);
    const out = await transformLyrics(song.id, m, transformBase);
    setTloading(false);
    if (out) { setTlines(out); } else { setTlines(null); setLmode('original'); toast('Could not transform these lyrics'); }
  };
  const displaySynced = lyrics.data?.synced
    ? lyrics.data.synced.map((l, i) => ({ t: l.t, text: lmode !== 'original' && tlines ? tlines[i] ?? l.text : l.text }))
    : null;
  const displayPlain = lyrics.data?.plain
    ? (lmode !== 'original' && tlines ? tlines.join('\n') : lyrics.data.plain)
    : null;

  const toggleMeaning = async (): Promise<void> => {
    if (!song) return;
    if (meaningOpen) {
      setMeaningOpen(false);
      return;
    }
    setMeaningOpen(true);
    if (meaning) return;
    setMeaningLoading(true);
    const m = await explainLyrics(song.id, shareLines);
    setMeaningLoading(false);
    if (m) setMeaning(m);
    else {
      setMeaningOpen(false);
      toast('Could not analyze these lyrics');
    }
  };

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
              {([['original', 'Original'], ['romanize', 'Romanized'], ['translate', 'English']] as const).map(([m, label]) => (
                <button key={m} type="button" onClick={() => void setMode(m)} aria-pressed={lmode === m} className="vx-seg">
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
            {tloading && <span className="text-[13px] text-ink-400" role="status">Working…</span>}
          </div>
          {shareLines.length > 0 && (
            <div className="vx-lyrics-toolbar-group">
              {isLive && (
                <Link to="/karaoke" className="vx-np-pill">
                  Karaoke
                </Link>
              )}
              <button type="button" onClick={() => void toggleMeaning()} aria-label="Explain the meaning of these lyrics" aria-expanded={meaningOpen} className="vx-np-pill">
                <SparkleIcon className="w-3.5 h-3.5" /> Meaning
              </button>
              <button type="button" onClick={() => setShareOpen(true)} className="vx-np-pill">
                Share lyrics
              </button>
            </div>
          )}
        </div>
      )}

      {meaningOpen && (
        <div className="vx-lyrics-meaning animate-fade-up">
          {meaningLoading && <p className="text-sm text-ink-300">Reading the lyrics…</p>}
          {!meaningLoading && meaning && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="vx-lyrics-meaning-title">
                  <SparkleIcon /> Meaning
                </span>
                {meaning.mood && <span className="vx-lyrics-tag">{meaning.mood}</span>}
              </div>
              <p className="text-[15px] leading-relaxed text-ink-100">{meaning.summary}</p>
              {meaning.themes.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {meaning.themes.map((th) => (
                    <span key={th} className="vx-lyrics-tag">{th}</span>
                  ))}
                </div>
              )}
              <p className="text-[12px] text-ink-400 pt-1">AI summary from the lyrics · may be imperfect</p>
            </div>
          )}
        </div>
      )}
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

      {shareOpen && song && (
        <LyricShareSheet lines={shareLines} song={song} onClose={() => setShareOpen(false)} />
      )}
    </div>
  );
}
