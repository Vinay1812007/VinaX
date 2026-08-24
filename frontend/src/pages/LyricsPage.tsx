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
import { PlayIcon } from '@/components/Icons';

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

  return (
    <div className="max-w-2xl mx-auto">
      {song && (
        <div className="flex items-center gap-4 mb-6">
          <img src={bestImage(song.images, 150)} onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)} alt="" className="w-16 h-16 rounded-xl object-cover" />
          <div className="min-w-0 flex-1">
            <Link to={songPath(song)} className="text-xl font-bold hover:underline truncate block">{song.title}</Link>
            <p className="text-sm text-ink-300 truncate">{song.subtitle}</p>
          </div>
          {!isLive && (
            <button
              onClick={() => playSong(song)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full btn-primary text-xs font-bold shrink-0"
            >
              <PlayIcon className="w-3.5 h-3.5" /> Play to sync
            </button>
          )}
        </div>
      )}

      {(songLoading || lyrics.isLoading) && <ListSkeleton rows={10} />}

      {!lyrics.isLoading && !songLoading && !lyrics.data && (
        <EmptyState
          title="Lyrics unavailable"
          message="No source has lyrics for this song yet. Coverage varies by language and label."
        />
      )}

      {lyrics.data && (
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1" role="group" aria-label="Lyrics text size">
            {(['sm', 'md', 'lg', 'xl'] as const).map((sz) => (
              <button
                key={sz}
                onClick={() => setSize(sz)}
                className={
                  size === sz
                    ? 'px-2.5 py-1 rounded-lg bg-ink-700 text-ember-400 text-xs font-bold'
                    : 'px-2.5 py-1 rounded-lg text-ink-400 hover:text-ink-100 text-xs font-bold'
                }
              >
                {sz === 'sm' ? 'A' : sz === 'md' ? 'A+' : sz === 'lg' ? 'A++' : 'A+++'}
              </button>
            ))}
          </div>
          {shareLines.length > 0 && (
            <div className="flex items-center gap-2">
              {isLive && (
                <Link to="/karaoke" className="px-3.5 py-1.5 rounded-full bg-ember-500/20 text-ember-300 text-xs font-bold hover:bg-ember-500/30">
                  Karaoke
                </Link>
              )}
              <button onClick={() => void toggleMeaning()} aria-label="Explain the meaning of these lyrics" className="px-3.5 py-1.5 rounded-full bg-ember-500/15 text-ember-300 text-xs font-bold hover:bg-ember-500/25">
                ✨ Meaning
              </button>
              <button onClick={() => setShareOpen(true)} className="px-3.5 py-1.5 rounded-full bg-ink-700 text-xs font-bold text-ink-100 hover:bg-ink-600">
                Share lyrics
              </button>
            </div>
          )}
        </div>
      )}

      {lyrics.data && (
        <div className="flex items-center gap-1 mb-3" role="group" aria-label="Lyrics language">
          {([['original', 'Original'], ['romanize', 'Romanized'], ['translate', 'English']] as const).map(([m, label]) => (
            <button
              key={m}
              onClick={() => void setMode(m)}
              className={lmode === m ? 'px-3 py-1 rounded-lg bg-ember-500/20 text-ember-300 text-xs font-bold' : 'px-3 py-1 rounded-lg text-ink-400 hover:text-ink-100 text-xs font-bold'}
            >
              {label}
            </button>
          ))}
          {tloading && <span className="text-xs text-ink-400 ml-1.5">Working…</span>}
        </div>
      )}

      {meaningOpen && (
        <div className="mb-4 rounded-2xl glass-card p-4 animate-fade-up">
          {meaningLoading && <p className="text-sm text-ink-300">Reading the lyrics…</p>}
          {!meaningLoading && meaning && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-widest text-ink-400">Meaning</span>
                {meaning.mood && (
                  <span className="px-2 py-0.5 rounded-full bg-ember-500/15 text-ember-300 text-[11px] font-bold">{meaning.mood}</span>
                )}
              </div>
              <p className="text-sm leading-relaxed text-ink-100/90">{meaning.summary}</p>
              {meaning.themes.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {meaning.themes.map((th) => (
                    <span key={th} className="px-2.5 py-1 rounded-full bg-ink-700/70 text-ink-200 text-[11px]">{th}</span>
                  ))}
                </div>
              )}
              <p className="text-[10px] text-ink-400/60 pt-1">AI summary from the lyrics · may be imperfect</p>
            </div>
          )}
        </div>
      )}
      {lyrics.data?.synced && song && (
        <div className="flex items-center gap-2 mb-3" role="group" aria-label="Lyrics sync offset">
          <span className="text-xs text-ink-400 shrink-0">Sync</span>
          <button onClick={() => useLyricsOffsetStore.getState().nudge(song.id, -0.2)} aria-label="Lyrics earlier" className="w-7 h-7 rounded-lg bg-ink-700 text-ink-100 text-sm font-bold hover:bg-ink-600">−</button>
          <span className="text-xs tabular-nums text-ink-200 w-12 text-center">{offset === 0 ? '0.0s' : `${offset > 0 ? '+' : ''}${offset.toFixed(1)}s`}</span>
          <button onClick={() => useLyricsOffsetStore.getState().nudge(song.id, 0.2)} aria-label="Lyrics later" className="w-7 h-7 rounded-lg bg-ink-700 text-ink-100 text-sm font-bold hover:bg-ink-600">+</button>
          {offset !== 0 && (
            <button onClick={() => useLyricsOffsetStore.getState().reset(song.id)} className="text-xs text-ink-400 hover:text-ink-100 ml-1">Reset</button>
          )}
          <span className="text-[11px] text-ink-500 ml-auto hidden sm:block">Nudge if lyrics run ahead of / behind the song</span>
        </div>
      )}
      {lyrics.data?.synced ? (
        <>
          <div className="max-h-[60vh] overflow-y-auto rounded-2xl border border-ink-700/60 bg-ink-850/40 p-2">
            <SyncedLyrics lines={displaySynced ?? lyrics.data.synced} live={isLive} size={size} />
          </div>
          <p className="text-[11px] text-ink-500 mt-4">
            Synced lyrics{isLive ? ' · tap a line to seek' : ' · play this song to follow along live'}
          </p>
        </>
      ) : lyrics.data?.plain ? (
        <>
          <pre className={`whitespace-pre-wrap font-sans text-ink-100 ${size === 'sm' ? 'text-base leading-8' : size === 'md' ? 'text-lg leading-9' : size === 'lg' ? 'text-2xl leading-10' : 'text-3xl leading-10'}`}>{displayPlain ?? lyrics.data.plain}</pre>
          <p className="text-[11px] text-ink-500 mt-6">
            Lyrics from community catalogs
          </p>
        </>
      ) : null}

      {shareOpen && song && (
        <LyricShareSheet lines={shareLines} song={song} onClose={() => setShareOpen(false)} />
      )}
    </div>
  );
}
