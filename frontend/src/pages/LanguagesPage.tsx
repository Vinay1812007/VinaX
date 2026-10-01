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
import { SectionHeader } from '@/components/SectionHeader';
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

/**
 * Languages: the hubs, each in its own script; then the two controls that
 * steer every recommendation (languages you love, languages to keep out);
 * then a trending shelf for each language you love.
 */
export default function LanguagesPage() {
  usePageTitle('Languages');
  const pinned = useSettingsStore((s) => s.pinnedLanguages);
  const muted = useSettingsStore((s) => s.mutedLanguages);
  const { togglePinnedLanguage, toggleMutedLanguage, setPinnedLanguages, setMutedLanguages } = useSettingsStore.getState();

  return (
    <div className="vx-browse vx-browse-page max-w-screen-2xl mx-auto">
      <PageHeader title="Languages" subtitle="Every language hub in its own script, and the languages you want more or less of." />

      <LanguageGrid heading={false} />

      <section className="bx-group" aria-label="Pinned languages">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h2 className="bx-subhead">Languages you love</h2>
            <p className="bx-subhint">Boosted everywhere you browse and search.</p>
          </div>
          <div className="flex gap-2 mb-3.5">
            <button
              type="button"
              onClick={() => {
                setPinnedLanguages(LANGUAGES.map((l) => l.id));
                setMutedLanguages([]);
              }}
              className="bx-pill"
            >
              All languages
            </button>
            {pinned.length > 0 && (
              <button type="button" onClick={() => setPinnedLanguages([])} className="bx-pill">
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

      <section className="bx-group !mb-12" aria-label="Muted languages">
        <h2 className="bx-subhead">Muted</h2>
        <p className="bx-subhint">Never recommended, and kept out of search results.</p>
        <div className="vx-chip-row">
          {LANGUAGES.map((l) => (
            <Chip key={l.id} active={muted.includes(l.id)} tone="danger" onClick={() => toggleMutedLanguage(l.id)}>
              {l.label}
            </Chip>
          ))}
        </div>
      </section>

      {pinned.length === 0 ? (
        <section className="vx-section">
          <SectionHeader title="Trending in your languages" />
          <p className="vx-meta-line">Pin at least one language above to see its trending songs here.</p>
        </section>
      ) : (
        pinned.map((lang) => <LanguageShelf key={lang} language={lang} />)
      )}
    </div>
  );
}
