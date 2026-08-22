import { usePageTitle } from '@/hooks/usePageTitle';
import { songPath } from '@/utils/slug';
import { LANGUAGES, languageLabel } from '@/constants/languages';
import { useSettingsStore } from '@/store/settingsStore';
import { Chip } from '@/components/Chip';
import { Shelf } from '@/components/Shelf';
import { MediaCard } from '@/components/MediaCard';
import { ShelfSkeleton } from '@/components/Skeletons';
import { useTrendingForLanguage } from '@/features/home/useHomeShelves';
import { trendingSeed } from '@/constants/seeds';
import { usePlayerStore } from '@/store/playerStore';
import { bestImage } from '@/utils/images';

function LanguageShelf({ language }: { language: string }) {
  const { data, isLoading } = useTrendingForLanguage(language);
  const playQueue = usePlayerStore((s) => s.playQueue);
  if (isLoading) return <ShelfSkeleton />;
  if (!data?.length) return null;
  return (
    <Shelf title={`Trending · ${languageLabel(language)}`} explanation="Trending in your languages" seeAllTo={`/search/${encodeURIComponent(trendingSeed(language))}`}>
      {data.map((song, i) => (
        <MediaCard key={song.id} to={songPath(song)} image={bestImage(song.images)} images={song.images} title={song.title} subtitle={song.subtitle} onPlay={() => playQueue(data, i)} />
      ))}
    </Shelf>
  );
}

export default function LanguagesPage() {
  usePageTitle('Languages');
  const pinned = useSettingsStore((s) => s.pinnedLanguages);
  const muted = useSettingsStore((s) => s.mutedLanguages);
  const { togglePinnedLanguage, toggleMutedLanguage, setPinnedLanguages, setMutedLanguages } = useSettingsStore.getState();

  return (
    <div className="max-w-screen-2xl mx-auto">
      <h1 className="text-display tracking-tight mb-1">Languages</h1>
      <p className="text-sm text-ink-400 mb-6">
        Pin languages to boost them everywhere; mute to hide them from recommendations. Your mix can blend several.
      </p>

      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-ink-300">Pin (tap) — pinned glow amber</span>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setPinnedLanguages(LANGUAGES.map((l) => l.id));
              setMutedLanguages([]);
            }}
            className="px-3.5 py-1.5 rounded-full text-xs font-bold btn-primary hover:bg-ember-400 min-h-touch"
          >
            All languages
          </button>
          {pinned.length > 0 && (
            <button
              onClick={() => setPinnedLanguages([])}
              className="px-3.5 py-1.5 rounded-full text-xs font-semibold btn-secondary min-h-touch"
            >
              Clear
            </button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 mb-6">
        {LANGUAGES.map((l) => (
          <Chip key={l.id} active={pinned.includes(l.id)} onClick={() => togglePinnedLanguage(l.id)}>
            {l.label}
          </Chip>
        ))}
      </div>

      <div className="mb-3 text-sm font-semibold text-ink-300">Mute — never recommend</div>
      <div className="flex flex-wrap gap-2 mb-10">
        {LANGUAGES.map((l) => (
          <Chip key={l.id} active={muted.includes(l.id)} tone="danger" onClick={() => toggleMutedLanguage(l.id)}>
            {l.label}
          </Chip>
        ))}
      </div>

      {pinned.length === 0 && <p className="text-sm text-ink-400 mb-6">Pin at least one language to see trending shelves here.</p>}
      {pinned.map((lang) => (
        <LanguageShelf key={lang} language={lang} />
      ))}
    </div>
  );
}
