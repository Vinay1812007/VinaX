import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sheet, SheetHeader } from '@/components/Sheet';
import { usePlayerStore } from '@/store/playerStore';
import { useLibraryStore } from '@/store/libraryStore';
import { toast } from '@/store/toastStore';
import { formatDuration } from '@/utils/format';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { getRecommendationContext } from '@/services/recommendation/context';
import { makeAiPlaylist, type AiPlaylistResult } from '@/services/ai/aiPlaylist';

/** Starting points for the box; a tap fills it. */
const EXAMPLES = ['Rainy night drive, old melodies', 'Workout hits that keep building', 'Sunday morning chill', 'Heartbreak songs to cry to', 'Telugu folk for a road trip'];

/**
 * AI Playlist: describe a vibe in plain words, preview the playlist the music
 * AI proposes (resolved to real catalogue songs, muted languages and recent
 * repeats left out), then play it or save it to the library. Logic in
 * services/ai/aiPlaylist.ts; when the AI is away it falls back to a
 * catalogue search for the same words, and says so.
 */
export function AiPlaylistSheet({ onClose }: { onClose(): void }) {
  const navigate = useNavigate();
  const playQueue = usePlayerStore((s) => s.playQueue);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AiPlaylistResult | null>(null);
  const run = useRef<AbortController | null>(null);
  useEffect(() => () => run.current?.abort(), []);

  const make = async (): Promise<void> => {
    const text = prompt.trim();
    if (text.length < 2 || busy) return;
    run.current?.abort();
    const ac = new AbortController();
    run.current = ac;
    setBusy(true);
    setResult(null);
    try {
      const out = await makeAiPlaylist(text, getRecommendationContext(null, 'playlist'), { signal: ac.signal });
      if (!ac.signal.aborted) setResult(out);
    } finally {
      if (run.current === ac) setBusy(false);
    }
  };

  const songs = result?.songs.map((s) => s.song) ?? [];
  const play = (): void => {
    if (!songs.length) return;
    playQueue(songs, 0, { keepList: true });
    onClose();
  };
  const save = (): void => {
    if (!result || !songs.length) return;
    const { createCollection, addManyToCollection } = useLibraryStore.getState();
    const id = createCollection(result.title);
    const n = addManyToCollection(id, songs);
    toast(`Saved ${n} songs to “${result.title}”`, { action: { label: 'Open', onClick: () => navigate(`/collection/${id}`) } });
    onClose();
  };

  return (
    <Sheet onClose={onClose} labelledBy="ai-playlist-title" size="lg" maxHeight="tall">
      <SheetHeader id="ai-playlist-title" title="AI Playlist" subtitle="Describe a vibe in your own words. VinaX’s AI picks the songs and finds them in the catalogue." onClose={onClose} className="mb-4" />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void make();
        }}
      >
        <label htmlFor="ai-playlist-prompt" className="sr-only">Describe your playlist</label>
        <textarea
          id="ai-playlist-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value.slice(0, 200))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void make();
            }
          }}
          rows={2}
          placeholder="e.g. late-night Telugu melodies for a long drive"
          className="glass-input w-full px-4 py-3 rounded-2xl text-[15px] resize-none"
        />
        <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Ideas">
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" onClick={() => setPrompt(ex)} className="vx-chip-idle min-h-[32px] px-3 rounded-full text-[12.5px] font-semibold text-ink-100">
              {ex}
            </button>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button type="submit" disabled={busy || prompt.trim().length < 2} className="btn-primary px-5 min-h-[44px] rounded-full text-sm font-bold disabled:opacity-50">
            {busy ? 'Making your playlist…' : result ? 'Make another' : 'Make playlist'}
          </button>
          <span className="text-[12px] text-ink-400" role="status" aria-live="polite">
            {busy ? 'Finding real songs for you…' : result ? (result.source === 'ai' ? `${result.songs.length} songs, picked by AI` : result.songs.length ? `${result.songs.length} songs from a catalogue search (the AI is away right now)` : 'Nothing matched. Try other words.') : ''}
          </span>
        </div>
      </form>

      {result && result.songs.length > 0 && (
        <section aria-label={result.title} className="mt-4">
          <h3 className="text-[17px] font-bold text-ink-100 mb-2">{result.title}</h3>
          <ol className="space-y-1 max-h-[42dvh] overflow-y-auto">
            {result.songs.map(({ song, reason }, i) => (
              <li key={song.id} className="flex items-center gap-2.5 rounded-2xl bg-ink-100/[0.05] p-2">
                <span className="w-5 text-center text-xs text-ink-500 shrink-0">{i + 1}</span>
                <img src={bestImage(song.images, 150)} onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)} alt="" loading="lazy" className="w-9 h-9 rounded-lg object-cover shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold truncate">{song.title}</span>
                  <span className="block text-[11px] text-ink-400 truncate">{reason ? `${song.subtitle} · ${reason}` : song.subtitle}</span>
                </span>
                <span className="text-xs tabular-nums text-ink-400 shrink-0">{formatDuration(song.duration)}</span>
              </li>
            ))}
          </ol>
          <div className="mt-3 flex flex-wrap gap-2 justify-end">
            <button type="button" onClick={save} className="btn-secondary px-4 min-h-[44px] rounded-full text-sm">Save to library</button>
            <button type="button" onClick={play} className="btn-primary px-5 min-h-[44px] rounded-full text-sm font-bold">Play</button>
          </div>
        </section>
      )}
    </Sheet>
  );
}

export default AiPlaylistSheet;
