import { LanguageGrid } from '@/components/LanguageGrid';
import { usePageTitle } from '@/hooks/usePageTitle';
import { songPath } from '@/utils/slug';
import { LANGUAGES, languageLabel } from '@/constants/languages';
import { useSettingsStore } from '@/store/settingsStore';
import { Chip } from '@/components/Chip';
import { Shelf } from '@/components/Shelf';
import { MediaCard } from '@/components/MediaCard';
import { ShelfSkeleton } from '@/components/Skeletons';
import { InlineError } from '@/components/States';
import { useTrendingForLanguage } from '@/features/home/useHomeShelves';
import { trendingSeed } from '@/constants/seeds';
import { usePlayerStore } from '@/store/playerStore';
import { bestImage } from '@/utils/images';
import { PageHeader } from '@/components/PageHeader';
import '@/styles/pages/browse.css';

function LanguageShelf({ language }: { language: string }) {
  const { data, isLoading, isError, refetch } = useTrendingForLanguage(language);
  const playQueue = usePlayerStore((s) => s.playQueue);
  if (isLoading) return <ShelfSkeleton />;
  // A failed shelf used to vanish (`return null`) — a pinned language with no
  // shelf and no explanation. Empty is still silent; an error is not.
  if (isError && !data?.length) return <InlineError label={`trending ${languageLabel(language)} songs`} retry={() => void refetch()} />;
  if (!data?.length) return null;
  return (
    <Shelf title={`Trending in ${languageLabel(language)}`} seeAllTo={`/search/${encodeURIComponent(trendingSeed(language))}`}>
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
    <div className="vx-browse vx-browse-page max-w-screen-2xl mx-auto">
      <PageHeader title="Languages" />

      <LanguageGrid heading={false} />

      <section className="vx-control-group" aria-label="Pinned languages">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 className="vx-subhead !mb-0">Languages you love<small>Boosted everywhere</small></h2>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setPinnedLanguages(LANGUAGES.map((l) => l.id));
                setMutedLanguages([]);
              }}
              className="vx-pill-btn"
            >
              All languages
            </button>
            {pinned.length > 0 && (
              <button onClick={() => setPinnedLanguages([])} className="vx-pill-btn">
                Clear
              </button>
            )}
          </div>
        </div>
        <div className="vx-chip-row">
          {LANGUAGES.map((l) => (
            <Chip key={l.id} active={pinned.includes(l.id)} onClick={() => togglePinnedLanguage(l.id)}>
              {l.label}
            </Chip>
          ))}
        </div>
      </section>

      <section className="vx-control-group !mb-10" aria-label="Muted languages">
        <h2 className="vx-subhead">Muted<small>Never recommended</small></h2>
        <div className="vx-chip-row">
          {LANGUAGES.map((l) => (
            <Chip key={l.id} active={muted.includes(l.id)} tone="danger" onClick={() => toggleMutedLanguage(l.id)}>
              {l.label}
            </Chip>
          ))}
        </div>
      </section>

      {pinned.length === 0 && <p className="vx-meta-line mb-6">Pin at least one language to see trending shelves here.</p>}
      {pinned.map((lang) => (
        <LanguageShelf key={lang} language={lang} />
      ))}
    </div>
  );
}
