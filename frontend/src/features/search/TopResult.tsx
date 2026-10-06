import { useMemo, type MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Artist, Song } from '@/types';
import { TrackMenu } from '@/components/TrackMenu';
import { ListSkeleton } from '@/components/Skeletons';
import { PlayIcon } from '@/components/Icons';
import { artSrcSet, bestImage, derivedVariants, FALLBACK_ART } from '@/utils/images';
import { letterAvatar } from '@/utils/avatar';
import { artistPath } from '@/utils/slug';

/** Clicks on the card's own controls (play, menu, links) are theirs, not the card's. */
const fromControl = (e: MouseEvent) => !!(e.target as HTMLElement).closest('button, a');

function useArt(images: Song['images']) {
  return useMemo(() => {
    const dv = derivedVariants(images);
    return { src: bestImage(dv, 250), srcSet: artSrcSet(dv, 350), glow: bestImage(images, 150) };
  }, [images]);
}

const onArtError = (e: React.SyntheticEvent<HTMLImageElement>) => {
  const t = e.currentTarget;
  t.srcset = '';
  t.src = FALLBACK_ART;
};

/**
 * The search's top song: its artwork leads (and glows, blurred, behind the
 * card). The whole card plays; the squircle is its keyboard target, and the
 * card feeds the song context menu like a row does.
 */
export function SongTopResult({ song, onPlay }: { song: Song; onPlay: () => void }) {
  const art = useArt(song.images);
  return (
    <div
      className="search-top-result"
      data-song-id={song.id}
      data-deter-context
      onClick={(e) => {
        if (fromControl(e)) return;
        onPlay();
      }}
    >
      <img className="search-top-bg" src={art.glow} alt="" aria-hidden decoding="async" />
      <img className="search-top-art" src={art.src} srcSet={art.srcSet} sizes="(min-width: 768px) 152px, 96px" alt="" width={152} height={152} decoding="async" onError={onArtError} />
      <div className="search-top-body">
        <p className="search-top-result-name">{song.title}</p>
        <p className="search-top-result-meta">
          <span className="search-type-pill">Song</span>
          <span>{song.subtitle}</span>
        </p>
      </div>
      <div className="search-top-tools">
        <TrackMenu song={song} />
      </div>
      <button type="button" onClick={onPlay} aria-label={`Play ${song.title} by ${song.subtitle}`} className="vx-play-fab">
        <PlayIcon />
      </button>
    </div>
  );
}

/**
 * When the words are an artist's exact name, the artist is the clearest
 * answer: a circle (people are circles), their name linking to their page,
 * and the squircle playing their songs.
 */
export function ArtistTopResult({ artist, onPlay }: { artist: Artist; onPlay: () => void }) {
  const navigate = useNavigate();
  const art = useArt(artist.images);
  const missing = bestImage(artist.images) === FALLBACK_ART;
  const src = missing ? letterAvatar(artist.name) : art.src;
  const to = artistPath(artist);
  return (
    <div
      className="search-top-result"
      onClick={(e) => {
        if (fromControl(e)) return;
        navigate(to);
      }}
    >
      {!missing && <img className="search-top-bg" src={art.glow} alt="" aria-hidden decoding="async" />}
      <img className="search-top-art is-artist" src={src} srcSet={missing ? undefined : art.srcSet} sizes="(min-width: 768px) 152px, 96px" alt="" width={152} height={152} decoding="async" onError={onArtError} />
      <div className="search-top-body">
        <p className="search-top-result-name">
          <Link to={to}>{artist.name}</Link>
        </p>
        <p className="search-top-result-meta">
          <span className="search-type-pill">Artist</span>
          {artist.subtitle && artist.subtitle !== 'Artist' && <span>{artist.subtitle}</span>}
        </p>
      </div>
      <button type="button" onClick={onPlay} aria-label={`Play ${artist.name}`} className="vx-play-fab">
        <PlayIcon />
      </button>
    </div>
  );
}

/** The shape of the All results while they load: the top card and its songs. */
export function ResultsSkeleton() {
  return (
    <div className="search-lead-wrap" role="status" aria-label="Loading results">
      <div className="search-results-lead">
        <div>
          <div className="skeleton h-6 w-32 mb-4 rounded" />
          <div className="skeleton search-skel-card" />
        </div>
        <div>
          <div className="skeleton h-6 w-24 mb-3 rounded" />
          <ListSkeleton rows={4} />
        </div>
      </div>
    </div>
  );
}
