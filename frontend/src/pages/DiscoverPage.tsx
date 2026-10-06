import { LanguageGrid } from '@/components/LanguageGrid';
import { DestinationGrid } from '@/components/DestinationGrid';

import { playlistPath, songPath } from '@/utils/slug';
import { usePageTitle } from '@/hooks/usePageTitle';
import { Shelf } from '@/components/Shelf';
import { MediaCard } from '@/components/MediaCard';
import { Chip } from '@/components/Chip';
import { ShelfSkeleton } from '@/components/Skeletons';
import { ErrorState, InlineError } from '@/components/States';
import { MOODS } from '@/constants/seeds';
import { HUB_LANGUAGES, LANGUAGES, languageLabel } from '@/constants/languages';
import { useAdventurousCorner, useFilmSoundtracks, useMoodSongs, useEditorialPlaylists } from '@/features/discover/useDiscover';
import { useNewForLanguage, useTrendingForLanguage } from '@/features/home/useHomeShelves';
import { useSettingsStore } from '@/store/settingsStore';
import { usePlayerStore } from '@/store/playerStore';
import { playPlaylist } from '@/features/player/playEntity';
import { bestImage } from '@/utils/images';
import { useSessionState } from '@/hooks/useSessionState';
import { PageHeader } from '@/components/PageHeader';
import { SectionHeader } from '@/components/SectionHeader';
import { BrowseTile, TileGlyph } from '@/features/discover/BrowseTile';
import { moodTone } from '@/features/discover/tones';
import { FlowEntryCard } from '@/features/flow/FlowEntryCard';
import type { Song } from '@/types';
import '@/styles/pages/browse.css';

/** A shelf of song cards that plays its own list from the card tapped. */
function SongShelf({ title, songs, seeAllTo, explanation }: { title: string; songs: Song[]; seeAllTo?: string; explanation?: string }) {
  const playQueue = usePlayerStore((s) => s.playQueue);
  return (
    <Shelf title={title} seeAllTo={seeAllTo} explanation={explanation}>
      {songs.map((song, i) => (
        <MediaCard key={song.id} to={songPath(song)} image={bestImage(song.images)} images={song.images} title={song.title} subtitle={song.subtitle} song={song} onPlay={() => playQueue(songs, i)} />
      ))}
    </Shelf>
  );
}

/**
 * 9.0 "Encore" — Discover is the browse surface: the lanes (Charts with real
 * covers, Languages in their scripts, Moods by their faces) and the other
 * destinations, the language hubs, then shelves tuned to one language and
 * one mood the listener picks here.
 */
export default function DiscoverPage() {
  usePageTitle('Discover');
  const pinned = useSettingsStore((s) => s.pinnedLanguages);
  const [lang, setLang] = useSessionState<string>('vinax.discover.lang.v1', pinned[0] ?? 'hindi');
  const [mood, setMood] = useSessionState<string>('vinax.discover.mood.v1', MOODS[0].id);

  const trending = useTrendingForLanguage(lang);
  const moodSongs = useMoodSongs(mood, lang);
  const editorial = useEditorialPlaylists(`${languageLabel(lang)} hits`);
  // Package D2 — depth shelves: fresh releases, film soundtracks, discovery.
  const fresh = useNewForLanguage(lang);
  const films = useFilmSoundtracks(lang);
  const adventurous = useAdventurousCorner();
  const label = languageLabel(lang);
  const hub = (HUB_LANGUAGES as readonly string[]).includes(lang) ? `/${lang}-songs` : undefined;
  const moodLabel = MOODS.find((m) => m.id === mood)?.label;

  return (
    <div className="vx-browse vx-browse-page max-w-screen-2xl mx-auto">
      <PageHeader title="Discover" subtitle="Charts, moods, languages and new music, all in one place." />
      <DestinationGrid area="discover" chartSongs={trending.data} />
      <FlowEntryCard />
      <LanguageGrid />

      <SectionHeader title="Pick a language" explanation="Every shelf below follows it." />
      <div className="vx-chip-rail" role="group" aria-label="Language">
        {LANGUAGES.map((l) => (
          <Chip key={l.id} active={lang === l.id} onClick={() => setLang(l.id)}>
            {l.label}
          </Chip>
        ))}
      </div>

      {trending.isError ? (
        <ErrorState retry={() => trending.refetch()} />
      ) : trending.isLoading ? (
        <ShelfSkeleton />
      ) : (trending.data?.length ?? 0) > 0 ? (
        <SongShelf title={`Trending in ${label}`} songs={trending.data ?? []} seeAllTo={hub} />
      ) : (
        <section className="vx-section">
          <SectionHeader title={`Trending in ${label}`} />
          <p className="vx-meta-line">Nothing is trending in {label} right now — try another language.</p>
        </section>
      )}

      {fresh.isLoading ? (
        <ShelfSkeleton />
      ) : (fresh.data?.length ?? 0) >= 4 ? (
        <SongShelf title="New this week" songs={fresh.data ?? []} explanation={`Fresh ${label} releases`} />
      ) : null}

      <section className="vx-section">
        <SectionHeader title="Pick a mood" />
        <div className="bx-tile-rail is-moods !mb-6" role="group" aria-label="Mood">
          {MOODS.map((m) => (
            <BrowseTile
              key={m.id}
              shape="mood"
              tone={moodTone(m.id)}
              title={m.label}
              meta={label}
              onClick={() => setMood(m.id)}
              pressed={mood === m.id}
              visual={<TileGlyph emoji>{m.emoji}</TileGlyph>}
            />
          ))}
        </div>
        {moodSongs.isLoading ? (
          <ShelfSkeleton />
        ) : moodSongs.isError && !moodSongs.data?.length ? (
          <InlineError label={`${moodLabel ?? 'mood'} picks`} retry={() => void moodSongs.refetch()} />
        ) : (moodSongs.data?.length ?? 0) > 0 ? (
          <SongShelf title={`${moodLabel} picks`} songs={moodSongs.data ?? []} />
        ) : (
          <p className="vx-meta-line">
            No {moodLabel?.toLowerCase()} picks in {label} right now — try another mood or language.
          </p>
        )}
      </section>

      {editorial.data && editorial.data.length > 0 && (
        <Shelf title="Playlists for the vibe">
          {editorial.data.map((p) => (
            <MediaCard key={p.id} to={playlistPath(p)} image={bestImage(p.images)} images={p.images} title={p.title} subtitle={p.subtitle || `${p.songCount ?? ''} songs`} onPlay={() => void playPlaylist(p.id, p.title)} />
          ))}
        </Shelf>
      )}

      {films.isLoading ? (
        <ShelfSkeleton />
      ) : (films.data?.length ?? 0) >= 4 ? (
        <SongShelf title="Movies you missed" songs={films.data ?? []} seeAllTo="/movies" />
      ) : null}

      {adventurous.language && (adventurous.data?.length ?? 0) >= 4 && (
        <SongShelf
          title={`Something new: ${languageLabel(adventurous.language)}`}
          explanation="A language you have not played yet"
          songs={adventurous.data ?? []}
        />
      )}
    </div>
  );
}
