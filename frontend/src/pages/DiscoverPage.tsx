
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
    <div className="max-w-screen-2xl mx-auto vx-stagger">
      <h1 className="text-3xl md:text-[34px] font-extrabold tracking-tight mb-6">Discover</h1>

      <div className="flex gap-2 overflow-x-auto no-scrollbar mb-6">
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
        <Shelf title={`Trending Now · ${languageLabel(lang)}`} explanation="Fresh popularity signals, re-ranked by your taste">
          {(trending.data ?? []).map((song, i) => (
            <MediaCard key={song.id} to={songPath(song)} image={bestImage(song.images)} images={song.images} title={song.title} subtitle={song.subtitle} song={song} onPlay={() => playQueue(trending.data ?? [], i)} />
          ))}
        </Shelf>
      )}

      <div className="flex gap-2 overflow-x-auto no-scrollbar mb-6">
        {MOODS.map((m) => (
          <Chip key={m.id} active={mood === m.id} onClick={() => setMood(m.id)}>
            {m.emoji} {m.label}
          </Chip>
        ))}
      </div>

      {moodSongs.isLoading ? (
        <ShelfSkeleton />
      ) : (
        <Shelf title={`${MOODS.find((m) => m.id === mood)?.label} Picks`} explanation={`${languageLabel(lang)} · mood-matched`}>
          {(moodSongs.data ?? []).map((song, i) => (
            <MediaCard key={song.id} to={songPath(song)} image={bestImage(song.images)} images={song.images} title={song.title} subtitle={song.subtitle} song={song} onPlay={() => playQueue(moodSongs.data ?? [], i)} />
          ))}
        </Shelf>
      )}

      {editorial.data && editorial.data.length > 0 && (
        <Shelf title="Playlists For The Vibe" explanation="Hand-picked playlists for the mood">
          {editorial.data.map((p) => (
            <MediaCard key={p.id} to={playlistPath(p)} image={bestImage(p.images)} images={p.images} title={p.title} subtitle={p.subtitle || `${p.songCount ?? ''} songs`} onPlay={() => void playPlaylist(p.id, p.title)} />
          ))}
        </Shelf>
      )}

      {fresh.isLoading ? (
        <ShelfSkeleton />
      ) : (fresh.data?.length ?? 0) >= 4 ? (
        <Shelf title={`New This Week · ${languageLabel(lang)}`} explanation="The freshest releases, straight off the presses">
          {(fresh.data ?? []).map((song, i) => (
            <MediaCard key={song.id} to={songPath(song)} image={bestImage(song.images)} images={song.images} title={song.title} subtitle={song.subtitle} song={song} onPlay={() => playQueue(fresh.data ?? [], i)} />
          ))}
        </Shelf>
      ) : null}

      {films.isLoading ? (
        <ShelfSkeleton />
      ) : (films.data?.length ?? 0) >= 4 ? (
        <Shelf title={`Movies You Missed · ${languageLabel(lang)}`} explanation="Recent film soundtracks worth a first listen">
          {(films.data ?? []).map((song, i) => (
            <MediaCard key={song.id} to={songPath(song)} image={bestImage(song.images)} images={song.images} title={song.title} subtitle={song.subtitle} song={song} onPlay={() => playQueue(films.data ?? [], i)} />
          ))}
        </Shelf>
      ) : null}

      {adventurous.language && (adventurous.data?.length ?? 0) >= 4 && (
        <Shelf
          title={`Adventurous Corner · ${languageLabel(adventurous.language)}`}
          explanation="A language you haven’t tried — rotates daily"
        >
          {(adventurous.data ?? []).map((song, i) => (
            <MediaCard key={song.id} to={songPath(song)} image={bestImage(song.images)} images={song.images} title={song.title} subtitle={song.subtitle} song={song} onPlay={() => playQueue(adventurous.data ?? [], i)} />
          ))}
        </Shelf>
      )}
    </div>
  );
}
