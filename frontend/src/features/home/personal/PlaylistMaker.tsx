/**
 * "Make me a playlist": a request in plain words goes to the personal
 * engine's builder (POST /api/personal/playlist); the answer shows with
 * Play, Save as playlist (a local playlist, which records the saves) and
 * Try again. The sheet keeps the last request so a second try starts from
 * it. Lazy: nothing here loads until the listener opens it.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { Sheet, SheetHeader } from '@/components/Sheet';
import { SongRow } from '@/components/SongRow';
import { PlayIcon, PlusIcon, RefreshIcon } from '@/components/Icons';
import { usePlayerStore } from '@/store/playerStore';
import { useLibraryStore } from '@/store/libraryStore';
import { toast } from '@/store/toastStore';
import { buildPersonalPlaylist, PersonalError, personalNotice } from '@/services/personal/api';
import { markPersonalSource } from '@/services/personal/reporter';
import { toSong, type PersonalPlaylist } from '@/services/personal/types';
import type { Song } from '@/types';

const IDEAS = [
  'Slow songs like the ones I liked last week',
  'Wedding dance songs in Telugu and Hindi',
  'Something new, nothing I have heard',
  'Late-night drive, 90s melodies',
  'Devotional songs for the morning',
  'Workout energy in Tamil',
];

const WAITING = ['Reading your taste…', 'Searching the catalogue…', 'Ranking what fits…', 'Putting it in order…'];

export default function PlaylistMaker({ onClose, initialPrompt = '' }: { onClose: () => void; initialPrompt?: string }) {
  const id = useId();
  const [prompt, setPrompt] = useState(initialPrompt);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ playlist: PersonalPlaylist; songs: Song[] } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const createCollection = useLibraryStore((s) => s.createCollection);
  const addToCollection = useLibraryStore((s) => s.addToCollection);

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    if (!busy) return;
    setStep(0);
    const t = window.setInterval(() => setStep((n) => Math.min(WAITING.length - 1, n + 1)), 3_500);
    return () => window.clearInterval(t);
  }, [busy]);

  const build = async (text = prompt) => {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (clean.length < 3) { setError('Say a little more — three characters at least.'); return; }
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const playlist = await buildPersonalPlaylist(clean, { signal: ac.signal });
      if (ac.signal.aborted) return;
      setResult({ playlist, songs: playlist.songs.map(toSong) });
    } catch (e) {
      if (ac.signal.aborted) return;
      setError(personalNotice(e instanceof PersonalError ? e.code : 'failed'));
    } finally {
      if (!ac.signal.aborted) setBusy(false);
    }
  };

  const playAll = () => {
    if (!result) return;
    markPersonalSource(result.songs[0].id, 'ai-playlist');
    playQueue(result.songs, 0);
    onClose();
  };

  const save = () => {
    if (!result) return;
    const colId = createCollection(result.playlist.title);
    if (!colId) return;
    for (const song of result.songs) addToCollection(colId, song);
    toast(`Saved "${result.playlist.title}" to your playlists`);
  };

  return (
    <Sheet onClose={onClose} labelledBy={`${id}-title`} size="lg">
      <SheetHeader id={`${id}-title`} title="Make me a playlist" subtitle="Describe it. The engine builds it from your taste and the catalogue." onClose={onClose} />
      <form
        className="vx-maker-form"
        onSubmit={(e) => { e.preventDefault(); void build(); }}
      >
        <label htmlFor={`${id}-prompt`} className="sr-only">What do you want to hear?</label>
        <textarea
          id={`${id}-prompt`}
          className="vx-maker-input"
          rows={2}
          maxLength={500}
          placeholder="e.g. slow Telugu melodies for a rainy evening"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void build(); } }}
          disabled={busy}
        />
        <div className="vx-maker-actions">
          <button type="submit" className="vx-maker-build" disabled={busy || prompt.trim().length < 3}>
            {busy ? WAITING[step] : result ? 'Build again' : 'Build'}
          </button>
          {busy && <button type="button" className="vx-maker-quiet" onClick={() => { abort.current?.abort(); setBusy(false); }}>Stop</button>}
        </div>
      </form>
      {!result && !busy && (
        <div className="vx-maker-ideas" aria-label="Ideas">
          {IDEAS.map((idea) => (
            <button key={idea} type="button" className="vx-maker-chip" onClick={() => { setPrompt(idea); void build(idea); }}>{idea}</button>
          ))}
        </div>
      )}
      {error && <p className="vx-maker-error" role="alert">{error}</p>}
      {result && (
        <div className="vx-maker-result">
          <div className="vx-maker-head">
            <div className="min-w-0">
              <h3 className="vx-maker-title">{result.playlist.title}</h3>
              {result.playlist.description && <p className="vx-maker-desc">{result.playlist.description}</p>}
              <p className="vx-maker-meta">{result.songs.length} songs{result.playlist.model ? ' · curated by VinaX AI' : ''}</p>
            </div>
            <div className="vx-maker-head-actions">
              <button type="button" className="vx-maker-build" onClick={playAll}><PlayIcon className="w-4 h-4" /> Play</button>
              <button type="button" className="vx-maker-quiet" onClick={save}><PlusIcon className="w-4 h-4" /> Save</button>
              <button type="button" className="vx-maker-quiet" onClick={() => void build()} aria-label="Try again"><RefreshIcon className="w-4 h-4" /></button>
            </div>
          </div>
          <ol className="vx-maker-list">
            {result.songs.map((song, i) => (
              <li key={song.id}>
                <SongRow song={song} songs={result.songs} index={i} showArt />
                {result.playlist.songs[i]?.reason && <p className="vx-maker-reason">{result.playlist.songs[i].reason}</p>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </Sheet>
  );
}
