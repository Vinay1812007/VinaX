import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import { PageHeader } from '@/components/PageHeader';
import { SongRow } from '@/components/SongRow';
import { EmptyState } from '@/components/States';
import { SparkleIcon } from '@/components/Icons';
import { EntityMeta, PlayFab, songsLabel, totalDuration } from '@/components/EntityHeader';
import { CollageCover } from '@/features/library/CollageCover';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import { toast } from '@/store/toastStore';
import { generatePlaylist, playlistErrorCopy, type GeneratedPlaylist } from '@/services/ai/playlist';

export default function AIPlaylistPage() {
  usePageTitle('AI playlist');
  const navigate = useNavigate();
  const pinned = useSettingsStore((s) => s.pinnedLanguages);
  const language = pinned[0] ? pinned[0][0].toUpperCase() + pinned[0].slice(1) : 'Hindi';
  const examples = [
    {
      title: 'Deep focus',
      detail: 'A little calm, a lot of flow',
      prompt: `Mellow ${language} songs for a focused afternoon`,
    },
    {
      title: 'After hours',
      detail: 'Slow down and settle in',
      prompt: `Soft ${language} melodies for a late-night wind-down`,
    },
    {
      title: 'Out of office',
      detail: 'Your next road-trip soundtrack',
      prompt: `Feel-good ${language} road trip songs, familiar hits and hidden gems`,
    },
    {
      title: 'Find my energy',
      detail: 'One more song. One more rep.',
      prompt: `High-energy ${language} workout songs with driving beats`,
    },
  ];
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
    let res;
    try {
      res = await generatePlaylist(q, pinned, muted);
    } catch {
      setError('The playlist service could not be reached. Your idea is saved below — try again.');
      return;
    } finally {
      setLoading(false);
    }
    if (res.ok) {
      setResult(res.playlist);
      return;
    }
    setError(playlistErrorCopy(res.reason));
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
    <div className="vx-playlist-studio max-w-3xl pb-10">
      <PageHeader title="AI playlist" />
      <div className="vx-prompt-grid">
        {examples.map((example) => (
          <button key={example.title} disabled={loading} onClick={() => { setPrompt(example.prompt); run(example.prompt); }}>
            <SparkleIcon className="w-5 h-5" />
            <strong>{example.title}</strong>
            <span>{example.detail}</span>
          </button>
        ))}
      </div>

      <div className="vx-ai-composer glass-card rounded-2xl p-4 mb-5">
        <label htmlFor="playlist-idea" className="block text-sm font-bold mb-3">
          Describe your perfect mix
        </label>
        <textarea
          id="playlist-idea"
          maxLength={600}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) run(prompt);
          }}
          placeholder="e.g. Rainy-day Telugu melodies for a slow evening"
          rows={3}
          className="glass-input w-full px-3 py-2 rounded-xl text-sm resize-none"
        />
        <p className="text-xs text-ink-400 mt-3">
          Start with a mood, an artist or a moment. Your selected languages help guide the picks.
        </p>
        <button
          onClick={() => run(prompt)}
          disabled={loading || !prompt.trim()}
          className="mt-4 w-full flex items-center justify-center gap-2 px-5 py-2.5 rounded-full btn-primary disabled:opacity-50"
        >
          <SparkleIcon className="w-4 h-4" />{' '}
          {loading ? 'Building your playlist…' : 'Build my playlist'}
        </button>
      </div>

      {loading && <div className="vx-load-status" role="status"><span className="vx-wave-loader" aria-hidden="true"><i /><i /><i /><i /><i /></span>Finding fresh songs that fit your idea…</div>}

      {error && (
        <EmptyState
          icon={<SparkleIcon className="w-8 h-8" />}
          title="No playlist yet"
          message={error}
        />
      )}

      {result && (
        <section className="vx-ai-result" aria-labelledby="ai-result-title">
          <div className="vx-ai-result-head">
            <CollageCover songs={result.songs} minPx={300} className="vx-ai-result-art" />
            <div className="min-w-0">
              <p className="vx-ehead-kind">Playlist</p>
              <h2 id="ai-result-title" className="vx-ai-result-title">{result.name}</h2>
              {result.description && <p className="vx-ehead-desc !mt-0">{result.description}</p>}
              <EntityMeta items={[songsLabel(result.songs.length), totalDuration(result.songs)]} />
            </div>
          </div>
          <div className="vx-ehead-actions">
            <PlayFab label="Play" onClick={playAll} />
            <button onClick={save} className="vx-ehead-pill">Save</button>
          </div>
          <div className="vx-tracklist">
            {result.songs.map((song, i) => (
              <SongRow key={song.id} song={song} songs={result.songs} index={i} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
