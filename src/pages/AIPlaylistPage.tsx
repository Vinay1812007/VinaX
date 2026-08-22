import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import { PageHeader } from '@/components/PageHeader';
import { SongRow } from '@/components/SongRow';
import { EmptyState } from '@/components/States';
import { SparkleIcon, PlayIcon } from '@/components/Icons';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import { toast } from '@/store/toastStore';
import { generatePlaylist, type GeneratedPlaylist } from '@/services/ai/playlist';

const EXAMPLES = [
  'Rainy-day Telugu melodies',
  'High-energy Hindi workout',
  '90s Tamil road trip',
  'Late-night lofi to focus',
  'Feel-good Punjabi party',
];

export default function AIPlaylistPage() {
  usePageTitle('AI Playlist');
  const navigate = useNavigate();
  const pinned = useSettingsStore((s) => s.pinnedLanguages);
  const muted = useSettingsStore((s) => s.mutedLanguages);
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GeneratedPlaylist | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (text: string) => {
    const q = text.trim();
    if (!q || loading) return;
    setPrompt(q);
    setLoading(true);
    setError(null);
    setResult(null);
    const res = await generatePlaylist(q, pinned, muted);
    setLoading(false);
    if (res.ok) {
      setResult(res.playlist);
      return;
    }
    if (res.reason === 'not_configured') setError('AI features are not enabled on this server yet.');
    else if (res.reason === 'empty') setError('Could not find enough matching songs — try rephrasing your idea.');
    else setError('Something went wrong. Please try again.');
  };

  const playAll = () => {
    if (result?.songs.length) usePlayerStore.getState().playQueue(result.songs, 0);
  };

  const save = () => {
    if (!result?.songs.length) return;
    const lib = useLibraryStore.getState();
    const id = lib.createCollection(result.name);
    result.songs.forEach((s) => lib.addToCollection(id, s));
    toast(`Saved “${result.name}”`);
    navigate(`/collection/${id}`);
  };

  return (
    <div className="max-w-2xl mx-auto pb-10">
      <PageHeader title="AI Playlist" subtitle="Describe a vibe — get a playlist" compact />

      <div className="glass-card rounded-2xl p-4 mb-5">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) run(prompt);
          }}
          placeholder="e.g. Rainy-day Telugu melodies for a slow evening"
          rows={2}
          className="glass-input w-full px-3 py-2 rounded-xl text-sm resize-none"
        />
        <div className="flex flex-wrap gap-1.5 mt-3">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => run(ex)}
              disabled={loading}
              className="px-3 py-1 rounded-full bg-ink-800 text-xs text-ink-300 hover:text-ink-100 disabled:opacity-50"
            >
              {ex}
            </button>
          ))}
        </div>
        <button
          onClick={() => run(prompt)}
          disabled={loading || !prompt.trim()}
          className="mt-4 w-full flex items-center justify-center gap-2 px-5 py-2.5 rounded-full btn-primary disabled:opacity-50"
        >
          <SparkleIcon className="w-4 h-4" /> {loading ? 'Building your playlist…' : 'Generate'}
        </button>
      </div>

      {error && <EmptyState title="No playlist yet" message={error} />}

      {result && (
        <div>
          <div className="flex items-end justify-between gap-3 mb-3">
            <div className="min-w-0">
              <h2 className="text-xl font-extrabold truncate">{result.name}</h2>
              {result.description && <p className="text-sm text-ink-400">{result.description}</p>}
              <p className="text-xs text-ink-500 mt-0.5">{result.songs.length} songs</p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={save}
                className="px-4 py-2 rounded-full border border-ink-600 text-sm font-semibold hover:border-ember-500 hover:text-ember-400"
              >
                Save
              </button>
              <button
                onClick={playAll}
                className="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm btn-primary"
              >
                <PlayIcon className="w-4 h-4" /> Play
              </button>
            </div>
          </div>
          <div className="space-y-1">
            {result.songs.map((song, i) => (
              <SongRow key={song.id} song={song} songs={result.songs} index={i} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
