import { LanguageGrid } from '@/components/LanguageGrid';
import { DestinationGrid } from '@/components/DestinationGrid';

import { playlistPath, songPath } from '@/utils/slug';
import { usePageTitle } from '@/hooks/usePageTitle';
import { Shelf } from '@/components/Shelf';
import { MediaCard } from '@/components/MediaCard';
import { Chip } from '@/components/Chip';
import { ShelfSkeleton } from '@/components/Skeletons';
import { ErrorState } from '@/components/States';
import { MOODS } from '@/constants/seeds';
import { LANGUAGES, languageLabel } from '@/constants/languages';
import { useAdventurousCorner, useFilmSoundtracks, useMoodSongs, useEditorialPlaylists } from '@/features/discover/useDiscover';
import { useNewForLanguage, useTrendingForLanguage } from '@/features/home/useHomeShelves';
import { useSettingsStore } from '@/store/settingsStore';
import { usePlayerStore } from '@/store/playerStore';
import { playPlaylist } from '@/features/player/playEntity';
import { bestImage } from '@/utils/images';
import { useSessionState } from '@/hooks/useSessionState';
import { PageHeader } from '@/components/PageHeader';
import '@/styles/pages/browse.css';

export default function DiscoverPage() {
  usePageTitle('Discover');
  const pinned = useSettingsStore((s) => s.pinnedLanguages);
  const [lang, setLang] = useSessionState<string>('vinax.discover.lang.v1', pinned[0] ?? 'hindi');
  const [mood, setMood] = useSessionState<string>('vinax.discover.mood.v1', MOODS[0].id);
  const playQueue = usePlayerStore((s) => s.playQueue);

  const trending = useTrendingForLanguage(lang);
  const moodSongs = useMoodSongs(mood, lang);
  const editorial = useEditorialPlaylists(`${languageLabel(lang)} hits`);
  // Package D2 — depth shelves: fresh releases, film soundtracks, discovery.
  const fresh = useNewForLanguage(lang);
  const films = useFilmSoundtracks(lang);
  const adventurous = useAdventurousCorner();

  return (
    <div className="vx-browse vx-browse-page max-w-screen-2xl mx-auto">
      <PageHeader title="Discover" />
      <DestinationGrid area="discover" />
      <LanguageGrid />

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
      ) : (
        <Shelf title={`Trending in ${languageLabel(lang)}`}>
          {(trending.data ?? []).map((song, i) => (
            <MediaCard key={song.id} to={songPath(song)} image={bestImage(song.images)} images={song.images} title={song.title} subtitle={song.subtitle} song={song} onPlay={() => playQueue(trending.data ?? [], i)} />
          ))}
        </Shelf>
      )}

      <div className="vx-chip-rail" role="group" aria-label="Mood">
        {MOODS.map((m) => (
          <Chip key={m.id} active={mood === m.id} onClick={() => setMood(m.id)}>
            {m.emoji} {m.label}
          </Chip>
        ))}
      </div>

      {moodSongs.isLoading ? (
        <ShelfSkeleton />
      ) : (
        <Shelf title={`${MOODS.find((m) => m.id === mood)?.label} picks`}>
          {(moodSongs.data ?? []).map((song, i) => (
            <MediaCard key={song.id} to={songPath(song)} image={bestImage(song.images)} images={song.images} title={song.title} subtitle={song.subtitle} song={song} onPlay={() => playQueue(moodSongs.data ?? [], i)} />
          ))}
        </Shelf>
      )}

      {editorial.data && editorial.data.length > 0 && (
        <Shelf title="Playlists for the vibe">
          {editorial.data.map((p) => (
            <MediaCard key={p.id} to={playlistPath(p)} image={bestImage(p.images)} images={p.images} title={p.title} subtitle={p.subtitle || `${p.songCount ?? ''} songs`} onPlay={() => void playPlaylist(p.id, p.title)} />
          ))}
        </Shelf>
      )}

      {fresh.isLoading ? (
        <ShelfSkeleton />
      ) : (fresh.data?.length ?? 0) >= 4 ? (
        <Shelf title="New this week">
          {(fresh.data ?? []).map((song, i) => (
            <MediaCard key={song.id} to={songPath(song)} image={bestImage(song.images)} images={song.images} title={song.title} subtitle={song.subtitle} song={song} onPlay={() => playQueue(fresh.data ?? [], i)} />
          ))}
        </Shelf>
      ) : null}

      {films.isLoading ? (
        <ShelfSkeleton />
      ) : (films.data?.length ?? 0) >= 4 ? (
        <Shelf title="Movies you missed">
          {(films.data ?? []).map((song, i) => (
            <MediaCard key={song.id} to={songPath(song)} image={bestImage(song.images)} images={song.images} title={song.title} subtitle={song.subtitle} song={song} onPlay={() => playQueue(films.data ?? [], i)} />
          ))}
        </Shelf>
      ) : null}

      {adventurous.language && (adventurous.data?.length ?? 0) >= 4 && (
        <Shelf title={`Something new: ${languageLabel(adventurous.language)}`}>
          {(adventurous.data ?? []).map((song, i) => (
            <MediaCard key={song.id} to={songPath(song)} image={bestImage(song.images)} images={song.images} title={song.title} subtitle={song.subtitle} song={song} onPlay={() => playQueue(adventurous.data ?? [], i)} />
          ))}
        </Shelf>
      )}
    </div>
  );
}
