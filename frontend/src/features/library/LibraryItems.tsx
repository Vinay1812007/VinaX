import type { SyntheticEvent } from 'react';
import { Link } from 'react-router-dom';
import type { Song } from '@/types';
import type { LocalCollection, SavedEntity } from '@/store/libraryStore';
import { EntityMenu, type EntityMenuItem } from '@/components/EntityHeader';
import { PlayIcon } from '@/components/Icons';
import { FALLBACK_ART } from '@/utils/images';
import { cn } from '@/utils/cn';
import { CollageCover } from './CollageCover';
import { TagChips } from './TagEditor';
import { PinMarkIcon } from './LibraryGlyphs';

/**
 * 9.0 — one entry of the Library list: a playlist of your own, or an album,
 * artist or playlist you saved. The page decides order, filters and copy;
 * these components only draw an entry as a row (list view) or a card (grid
 * view), artwork first, with a ⋯ menu for pin / delete / remove.
 */
export type LibraryItem =
  | { type: 'collection'; key: string; at: number; title: string; col: LocalCollection; songs: Song[]; downloaded: number }
  | { type: 'saved'; key: string; at: number; title: string; entity: SavedEntity };

export const itemPath = (item: LibraryItem): string =>
  item.type === 'collection' ? `/collection/${item.col.id}` : `/${item.entity.kind}/${item.entity.id}`;

const toFallback = (e: SyntheticEvent<HTMLImageElement>) => {
  const img = e.target as HTMLImageElement;
  if (img.src !== FALLBACK_ART) img.src = FALLBACK_ART;
};

function Art({ item, minPx }: { item: LibraryItem; minPx: number }) {
  if (item.type === 'collection') return <CollageCover songs={item.col.songs} emoji={item.col.emoji} minPx={minPx} />;
  return (
    <img
      src={item.entity.image || FALLBACK_ART}
      onError={toFallback}
      alt=""
      loading="lazy"
      decoding="async"
      width={minPx}
      height={minPx}
    />
  );
}

function Title({ item }: { item: LibraryItem }) {
  return (
    <>
      {item.type === 'collection' && item.col.emoji && <span className="vx-lp-emoji" aria-hidden>{item.col.emoji}</span>}
      <span className="t">{item.title}</span>
    </>
  );
}

function Meta({ item, meta }: { item: LibraryItem; meta: string }) {
  const pinned = item.type === 'collection' && item.col.pinned;
  return (
    <>
      {pinned && (
        <>
          <PinMarkIcon className="vx-lp-pin" />
          <span className="sr-only">Pinned · </span>
        </>
      )}
      <span className="m">{meta}</span>
    </>
  );
}

interface Props {
  item: LibraryItem;
  meta: string;
  menu: EntityMenuItem[];
}

/** List view: 56px squircle art (a circle for artists), title, one meta line, ⋯. */
export function LibraryRow({ item, meta, menu }: Props) {
  const round = item.type === 'saved' && item.entity.kind === 'artist';
  return (
    <div className="vx-lp-row">
      <Link to={itemPath(item)} className="vx-lp-row-link">
        <span className={cn('vx-lp-row-art', round && 'is-round')}><Art item={item} minPx={150} /></span>
        <span className="vx-lp-row-text">
          <span className="vx-lp-row-title"><Title item={item} /></span>
          <span className="vx-lp-row-meta"><Meta item={item} meta={meta} /></span>
          {item.type === 'collection' && <TagChips tags={item.col.tags} className="mt-1.5" />}
        </span>
      </Link>
      <EntityMenu items={menu} size="md" align="end" label={`More actions for ${item.title}`} className="vx-lp-more" />
    </div>
  );
}

/** Grid view: artwork-led card with a play squircle and the same ⋯ menu. */
export function LibraryCard({ item, meta, menu, onPlay }: Props & { onPlay?: () => void }) {
  const round = item.type === 'saved' && item.entity.kind === 'artist';
  return (
    <article className="vx-lp-card group">
      <div className={cn('vx-lp-card-art', round && 'is-round')}>
        <Link to={itemPath(item)} tabIndex={-1} aria-hidden="true" className="vx-lp-card-cover">
          <Art item={item} minPx={300} />
        </Link>
        {onPlay && (
          <button type="button" aria-label={`Play ${item.title}`} onClick={onPlay} className="card-play">
            <PlayIcon />
          </button>
        )}
      </div>
      <div className="vx-lp-card-foot">
        <Link to={itemPath(item)} className="vx-lp-card-text">
          <span className="vx-lp-card-title"><Title item={item} /></span>
          <span className="vx-lp-card-meta"><Meta item={item} meta={meta} /></span>
        </Link>
        <EntityMenu items={menu} size="md" align="end" label={`More actions for ${item.title}`} className="vx-lp-more" />
      </div>
    </article>
  );
}
