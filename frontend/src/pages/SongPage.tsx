import { Link, useParams } from 'react-router-dom';
import { albumPath, artistPath, extractId, songPath } from '@/utils/slug';
import { useCanonicalRedirect, useJsonLd } from '@/hooks/useSeo';
import { buildSongBreadcrumbs, buildSongJsonLd } from '@/utils/schema';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useSongDetails, useSongSuggestions } from '@/features/player/useSongDetails';
import { usePlayerStore } from '@/store/playerStore';
import { SongRow } from '@/components/SongRow';
import { FavButton } from '@/components/FavButton';
import { HeaderSkeleton, ListSkeleton } from '@/components/Skeletons';
import { ErrorState } from '@/components/States';
import { PlusIcon, ShareIcon } from '@/components/Icons';
import { EntityAction, EntityHeader, EntityMeta, PlayFab } from '@/components/EntityHeader';
import { SectionHeader } from '@/components/SectionHeader';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { formatDuration, formatCount } from '@/utils/format';
import { languageLabel } from '@/constants/languages';
import { shareLink } from '@/utils/share';
import { AdSlot } from '@/components/AdSlot';


export default function SongPage() {
  const { id: rawId } = useParams();
  const id = extractId(rawId);
  const { data: song, isLoading, isError, refetch } = useSongDetails(id);
  const suggestions = useSongSuggestions(id);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const enqueue = usePlayerStore((s) => s.enqueue);
  const canonicalPath = song ? songPath(song) : undefined;
  useCanonicalRedirect(canonicalPath);
  usePageMeta({
    title: song ? `${song.title} — ${song.artists[0]?.name ?? song.subtitle}${song.album ? ` | ${song.album.name}` : ''}` : undefined,
    description: song
      ? `Play ${song.title} by ${song.subtitle}${song.year ? ` (${song.year})` : ''} free on VinaX — synced lyrics, HD audio, no login.`
      : undefined,
    image: song ? bestImage(song.images, 500) : undefined,
    type: 'music.song',
    canonicalPath,
  });
  useJsonLd(song && [buildSongJsonLd(song), buildSongBreadcrumbs(song)]);

  if (isLoading) return <div className="max-w-4xl mx-auto"><HeaderSkeleton /><ListSkeleton /></div>;
  if (isError || !song) return <ErrorState retry={() => refetch()} />;

  const art = bestImage(song.images, 500);
  const play = () => {
    playQueue([song, ...(suggestions.data ?? [])], 0);
    // v5.17.0 — a shared "moment" link (?t=seconds) starts right there.
    const t = Number(new URLSearchParams(window.location.search).get('t'));
    if (t > 0) window.setTimeout(() => usePlayerStore.getState().seek(t), 900);
  };

  return (
    <div className="vx-entity">
      <EntityHeader
        kind="Song"
        title={song.title}
        titleText={song.title}
        artUrl={art}
        art={<img src={art} onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)} alt="" data-deter-context />}
        meta={
          <EntityMeta
            items={[
              song.artists.length ? (
                <>
                  {song.artists.map((a, i) => (
                    <span key={`${a.id}-${i}`}>
                      {i > 0 && ', '}
                      {a.id ? <Link to={artistPath(a)}>{a.name}</Link> : a.name}
                    </span>
                  ))}
                </>
              ) : song.subtitle,
              song.album?.id ? <Link to={albumPath(song.album)}>{song.album.name}</Link> : null,
              song.year,
              song.language && languageLabel(song.language),
              song.duration != null ? formatDuration(song.duration) : null,
              song.playCount != null ? `${formatCount(song.playCount)} plays` : null,
            ]}
          />
        }
        actions={
          <>
            <PlayFab size="lg" label="Play" onClick={play} />
            <FavButton song={song} className="vx-ehead-fav" />
            <EntityAction label="Add to queue" onClick={() => enqueue(song)}><PlusIcon /></EntityAction>
            <EntityAction label="Share" onClick={() => void shareLink(songPath(song), song.title)}><ShareIcon /></EntityAction>
            {song.hasLyrics && (
              <Link to={`/lyrics/${song.id}`} className="vx-ehead-pill">
                Lyrics
              </Link>
            )}
          </>
        }
      />

      <section className="vx-esection is-first" aria-label="Similar tracks">
        <SectionHeader title="Similar tracks" />
        {suggestions.isLoading && <ListSkeleton rows={5} />}
        <div className="vx-tracklist">
          {(suggestions.data ?? []).map((s, i) => (
            <SongRow key={s.id} song={s} songs={suggestions.data} index={i} />
          ))}
        </div>
        {suggestions.isError && <p className="text-sm text-ink-400">Similar tracks aren’t available right now.</p>}
      </section>
      <AdSlot className="vx-esection" />
    </div>
  );
}
