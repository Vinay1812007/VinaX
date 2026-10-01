import { useMemo } from 'react';
import { Shelf } from '@/components/Shelf';
import { MediaCard } from '@/components/MediaCard';
import { ShelfSkeleton } from '@/components/Skeletons';
import { useHistoryStore } from '@/store/historyStore';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import { artistPath } from '@/utils/slug';
import { bestImage } from '@/utils/images';
import { letterAvatar } from '@/utils/avatar';
import { playArtist } from '@/features/player/playEntity';
import { useRecommendations } from '@/features/recommendations/useRecommendations';
import { useWeeklyMix } from '@/features/weekly/useWeeklyMix';
import type { Mix } from '@/services/recommendation/types';
import type { Song } from '@/types';
import { onThisDay } from '../onThisDay';
import { localDateKey, pickDailyFavorite, useBecauseYouLiked } from '../useBecauseYouLiked';
import { SongOfTheDayCard, StreakCard } from '../DailyCards';
import { FestivalLookaheadCard } from '../FestivalLookaheadCard';
import { YourPlaylistsShelf } from '../YourPlaylists';
import { useContinueListening } from '../useHomeShelves';
import { useYourArtists } from '../useYourArtists';
import { useSimilarArtists } from '../useSimilarArtists';
import { useDailyMix } from '../useDailyMix';
import { useMostListened, useOnRepeat, useRepeatRewind, useRecentlyPlayedAlbums, useBecauseYouListenedTo } from '../usePersonalShelves';
import { useShelfDedupe } from '../shelfLedger';
import { DeferredBlock, MoreShelves, SongShelf, useShelfLens } from './shared';

/** A mix as one card: its first song's artwork, its name, what it is; the play button plays the mix. */
function MixCards({ mixes }: { mixes: Array<{ id: string; title: string; subtitle: string; songs: Song[] }> }) {
  const playQueue = usePlayerStore((s) => s.playQueue);
  const shown = mixes.filter((m) => m.songs.length > 0);
  if (!shown.length) return null;
  return (
    <Shelf title="Made for you" explanation="Mixes built on this device from what you play and like" seeAllTo="/made-for-you">
      {shown.map((mix) => (
        <MediaCard
          key={mix.id}
          to="/made-for-you"
          image={bestImage(mix.songs[0].images)}
          images={mix.songs[0].images}
          title={mix.title}
          subtitle={mix.subtitle}
          onPlay={() => playQueue(mix.songs, 0)}
        />
      ))}
    </Shelf>
  );
}

/**
 * 9.0.0 — "For you": a manageable set of genuinely personal sections, then
 * the rest of the listener's own listening behind "More from your listening".
 * Each list goes through the shelf lens (live safety + its surface's
 * repetition rule) before the cross-shelf ledger.
 *
 *   Made for you            the Daily mix and the on-device mixes, one card each
 *   Continue listening      resume: recent plays are the point
 *   Because you liked “X”   personal: catalogue suggestions for today's favourite
 *   Your playlists          the listener's own and saved playlists
 *   For you this week       personal: the weekly mix
 *   Your favourite artists  round cards, then Similar artists (loads near the viewport)
 *
 *   More from your listening (closed until asked for; nothing in it fetches before):
 *   On this day, Recently played, Most listened, On repeat, Repeat rewind,
 *   Because you listened to …, a mix's full song list, the daily cards.
 */
export function PersonalBlock() {
  const dedupe = useShelfDedupe('personal');
  const lens = useShelfLens();
  const favorites = useLibraryStore((s) => s.favorites);
  const continueListening = useContinueListening();
  const likedSeed = useMemo(() => pickDailyFavorite(favorites, localDateKey()), [favorites]);
  const becauseLiked = useBecauseYouLiked(likedSeed);
  const mixes = useRecommendations();
  const daily = useDailyMix();
  const weekly = useWeeklyMix();
  const yourArtists = useYourArtists();

  const mixCards = [
    ...(daily.data?.length ? [{ id: 'vinax-daily', title: 'VinaX Daily', subtitle: 'A fresh mix for today', songs: lens(daily.data, 'personal') }] : []),
    ...(mixes.data ?? []).map((m: Mix) => ({ id: m.id, title: m.title, subtitle: m.explanation ?? `${m.songs.length} songs`, songs: lens(m.songs, 'personal') })),
  ];

  return (
    <>
      {(mixes.isLoading || daily.isLoading) && !mixCards.length ? <ShelfSkeleton /> : <MixCards mixes={mixCards} />}

      <SongShelf title="Continue listening" songs={dedupe(lens(continueListening, 'resume'))} seeAllTo="/history" />

      {likedSeed && becauseLiked.isLoading ? (
        <ShelfSkeleton />
      ) : likedSeed && becauseLiked.data?.length ? (
        <SongShelf title={`Because you liked “${likedSeed.title}”`} songs={dedupe(lens(becauseLiked.data, 'personal'))} seeAllTo="/favorites" />
      ) : null}

      <YourPlaylistsShelf />

      {weekly.isLoading ? <ShelfSkeleton /> : (
        <SongShelf title="For you this week" explanation="Updates every Monday" songs={dedupe(lens(weekly.data, 'personal'))} seeAllTo="/weekly" />
      )}

      {yourArtists.length >= 3 && (
        <Shelf title="Your favourite artists">
          {yourArtists.map((a) => (
            <MediaCard
              key={a.id || a.name}
              to={a.id ? artistPath(a) : `/search/${encodeURIComponent(a.name)}`}
              image={a.image ?? letterAvatar(a.name)}
              title={a.name}
              subtitle={`${a.plays} plays`}
              round
              onPlay={a.id ? () => void playArtist(a.id, a.name) : undefined}
            />
          ))}
        </Shelf>
      )}

      {/* 8.5.1 — mounted near the viewport only: its artist-page fetches pushed Home's first paint over its request budget. */}
      <DeferredBlock render={() => <SimilarArtistsShelf />} />

      <MoreShelves id="personal-more" label="More from your listening" hint="On this day, on repeat, most listened, rewinds">
        {() => <MorePersonal mixes={mixes.data ?? []} />}
      </MoreShelves>
    </>
  );
}

/** The rest of the listener's own listening, mounted only once they open it. */
function MorePersonal({ mixes }: { mixes: Mix[] }) {
  const dedupe = useShelfDedupe('personal-more');
  const lens = useShelfLens();
  const historyEntries = useHistoryStore((s) => s.entries);
  const favorites = useLibraryStore((s) => s.favorites);
  const memories = useMemo(() => onThisDay(historyEntries), [historyEntries]);
  const recentAlbums = useRecentlyPlayedAlbums();
  const mostListened = useMostListened();
  const onRepeat = useOnRepeat();
  const repeatRewind = useRepeatRewind();
  // Seed "Because you listened to …" from the top-played song by the #1 artist (mostListened is sorted by plays).
  const becauseSeed = mostListened[0];
  const because = useBecauseYouListenedTo(becauseSeed);
  return (
    <>
      <div className="vxh-daily">
        <StreakCard entries={historyEntries} />
        <SongOfTheDayCard favorites={favorites} entries={historyEntries} />
        <FestivalLookaheadCard />
      </div>
      {memories && <SongShelf title="On this day" explanation={`You were playing these ${memories.label.toLowerCase()}`} songs={lens(memories.songs, 'resume')} seeAllTo="/history" />}
      {recentAlbums.isLoading ? <ShelfSkeleton /> : <SongShelf title="Recently played" songs={dedupe(lens(recentAlbums.data, 'resume'))} seeAllTo="/history" />}
      <SongShelf title="Most listened" songs={dedupe(lens(mostListened, 'resume'))} seeAllTo="/history" />
      <SongShelf title="On repeat" explanation="Played 3+ times in the last 14 days" songs={dedupe(lens(onRepeat, 'resume'))} />
      <SongShelf title="Repeat rewind" explanation="Old favourites you haven't played lately" songs={dedupe(lens(repeatRewind, 'resume'))} />
      {because.isLoading ? <ShelfSkeleton /> : becauseSeed && <SongShelf title={`Because you listened to ${becauseSeed.subtitle}`} songs={dedupe(lens(because.data, 'personal'))} />}
      {mixes.slice(0, 2).map((mix) => <SongShelf key={mix.id} title={mix.title} explanation={mix.explanation} songs={dedupe(lens(mix.songs, 'personal'))} seeAllTo="/made-for-you" />)}
    </>
  );
}

function SimilarArtistsShelf() {
  const similarArtists = useSimilarArtists();
  if ((similarArtists.data?.length ?? 0) < 3) return null;
  return (
    <Shelf title="Similar artists" explanation="Artists you haven’t played yet, like the ones you do">
      {similarArtists.data!.map((a) => (
        <MediaCard key={a.id} to={artistPath(a)} image={a.image || letterAvatar(a.name)} title={a.name} subtitle={`Like ${a.because}`} round onPlay={() => void playArtist(a.id, a.name)} />
      ))}
    </Shelf>
  );
}
