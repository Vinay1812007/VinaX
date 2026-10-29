import { useMemo } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { usePageMeta } from '@/hooks/usePageMeta';
import { API_LANGUAGES } from '@/services/api';
import { languageLabel } from '@/constants/languages';
import { useSettingsStore } from '@/store/settingsStore';
import { usePlayerStore } from '@/store/playerStore';
import { playPlaylist } from '@/features/player/playEntity';
import { shuffledSongs } from '@/features/search/workspace';
import { browseLanguage, browseLanguageChoices, categoryKind, categoryTone, useBrowseCategory } from '@/features/discover/useBrowse';
import { EntityAction, EntityHeader, EntityMeta, PlayFab, songsLabel } from '@/components/EntityHeader';
import { Chip } from '@/components/Chip';
import { Shelf } from '@/components/Shelf';
import { MediaCard } from '@/components/MediaCard';
import { SongRow } from '@/components/SongRow';
import { SectionHeader } from '@/components/SectionHeader';
import { HeaderSkeleton, ListSkeleton, ShelfSkeleton } from '@/components/Skeletons';
import { EmptyState, ErrorState } from '@/components/States';
import { ChevronRightIcon, ShuffleIcon } from '@/components/Icons';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { extractId, playlistPath } from '@/utils/slug';
import '@/styles/pages/browse.css';

/**
 * 1.3 — one of the catalogue's moods & genres (/browse/:id): its top
 * playlists and songs in a language the listener picks, their first pinned
 * language to start. The API alone knows these pages; when it is down the
 * page says so and points back to Moods.
 */
export default function BrowseCategoryPage() {
  const id = extractId(useParams().id) ?? '';
  const pinned = useSettingsStore((s) => s.pinnedLanguages);
  const [params, setParams] = useSearchParams();
  const asked = params.get('language')?.toLowerCase() ?? '';
  const language = (API_LANGUAGES as readonly string[]).includes(asked) ? asked : browseLanguage(pinned);
  const choices = useMemo(() => {
    const list = browseLanguageChoices(pinned);
    return list.includes(language) ? list : [language, ...list];
  }, [pinned, language]);
  const q = useBrowseCategory(id, language);
  const cat = q.data;
  const playQueue = usePlayerStore((s) => s.playQueue);
  const label = languageLabel(language);

  usePageMeta({
    title: cat ? `${cat.name} — ${label} songs & playlists` : 'Moods & genres',
    description: cat?.description ?? (cat ? `${cat.name}: top ${label} songs and playlists, free on VinaX.` : undefined),
    image: cat ? bestImage(cat.images, 500) : undefined,
    canonicalPath: id ? `/browse/${id}` : undefined,
  });

  const pick = (l: string) => setParams((p) => {
    const next = new URLSearchParams(p);
    next.set('language', l);
    return next;
  }, { replace: true });

  const songs = cat?.songs ?? [];
  const playlists = cat?.playlists ?? [];
  const art = cat ? bestImage(cat.images, 500) : FALLBACK_ART;

  return (
    <div className="vx-browse vx-browse-page max-w-screen-2xl mx-auto">
      <Link to="/moods" className="bx-crumb">
        <ChevronRightIcon /> Moods
      </Link>

      {cat ? (
        <div className={categoryTone(cat)}>
          <EntityHeader
            kind={categoryKind(cat)}
            title={cat.name}
            titleText={cat.name}
            artUrl={art}
            art={<img src={art} onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)} alt="" />}
            description={cat.description ?? undefined}
            meta={
              <EntityMeta
                items={[
                  label,
                  playlists.length > 0 && `${playlists.length} playlist${playlists.length === 1 ? '' : 's'}`,
                  songs.length > 0 && songsLabel(songs.length),
                ]}
              />
            }
            actions={
              songs.length > 0 && (
                <>
                  <PlayFab size="lg" label="Play all" onClick={() => playQueue(songs, 0)} />
                  <EntityAction label="Shuffle" onClick={() => playQueue(shuffledSongs(songs), 0)}>
                    <ShuffleIcon />
                  </EntityAction>
                </>
              )
            }
          />
        </div>
      ) : (
        q.isLoading && <HeaderSkeleton />
      )}

      <div className="vx-chip-rail vx-section" role="group" aria-label="Language">
        {choices.map((l) => (
          <Chip key={l} active={l === language} onClick={() => pick(l)}>
            {languageLabel(l)}
          </Chip>
        ))}
      </div>

      {q.isLoading ? (
        <>
          <ShelfSkeleton />
          <ListSkeleton rows={6} />
        </>
      ) : q.isError || !cat ? (
        <ErrorState
          title="This page isn’t available right now"
          message={`The catalogue had nothing for it in ${label} just now — try another language, or pick a mood instead.`}
          retry={() => void q.refetch()}
        />
      ) : playlists.length === 0 && songs.length === 0 ? (
        <EmptyState title="Nothing here yet" message={`No ${label} playlists or songs for ${cat.name} right now — try another language.`} />
      ) : (
        <>
          {playlists.length > 0 && (
            <Shelf title="Top playlists" explanation={`${label} playlists for ${cat.name}`}>
              {playlists.map((p) => (
                <MediaCard
                  key={p.id}
                  to={playlistPath(p)}
                  image={bestImage(p.images)}
                  images={p.images}
                  title={p.title}
                  subtitle={p.subtitle || (p.songCount != null ? songsLabel(p.songCount) : 'Playlist')}
                  onPlay={() => void playPlaylist(p.id, p.title)}
                />
              ))}
            </Shelf>
          )}
          {songs.length > 0 && (
            <section className="vx-section" aria-label={`Top ${cat.name} songs`}>
              <SectionHeader title="Top songs" explanation={`${label} songs for ${cat.name}`} />
              <div className="vx-track-list">
                {songs.map((song, i) => (
                  <SongRow key={song.id} song={song} songs={songs} index={i} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
