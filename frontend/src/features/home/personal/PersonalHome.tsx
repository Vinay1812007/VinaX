/**
 * The personal engine's block on Home: the composed shelves (each through
 * the same Shelf, MediaCard and exposure path as every other shelf, so the
 * lens, dedupe and "why" line work as usual), a greeting when the composer
 * wrote one, and the way into the playlist maker. Renders nothing at all
 * when there is no personal page, so the on-device Home shows unchanged.
 */
import { lazy, Suspense, useEffect, useState } from 'react';
import { Shelf } from '@/components/Shelf';
import { MediaCard } from '@/components/MediaCard';
import { ShelfSkeleton } from '@/components/Skeletons';
import { SparkleIcon } from '@/components/Icons';
import { usePlayerStore } from '@/store/playerStore';
import { markPersonalSource } from '@/services/personal/reporter';
import { recordExposure } from '@/services/recommendation/exposure';
import { songPath } from '@/utils/slug';
import { bestImage } from '@/utils/images';
import { cn } from '@/utils/cn';
import { useShelfLens } from '../blocks/shared';
import { usePersonalHome, type PersonalShelfView } from './usePersonalHome';
import type { Song } from '@/types';

const PlaylistMaker = lazy(() => import('./PlaylistMaker'));

function PersonalShelf({ shelf }: { shelf: PersonalShelfView }) {
  const playQueue = usePlayerStore((s) => s.playQueue);
  const lens = useShelfLens();
  const songs = lens(shelf.items, 'personal');
  // As every shelf does: what went on screen is recorded in the exposure ledger, once per list.
  const fingerprint = songs.map((s) => s.id).join(',');
  useEffect(() => {
    if (songs.length) recordExposure(songs, 'shown');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one write per distinct list of songs
  }, [fingerprint]);
  if (songs.length < 4) return null;
  const play = (song: Song, i: number) => {
    markPersonalSource(song.id, `home:${shelf.key.split(':')[0]}`, shelf.key, i);
    playQueue(songs, i);
  };
  return (
    <Shelf title={shelf.title} explanation={shelf.reason || undefined} layout={songs.length <= 8 ? 'grid' : 'rail'}>
      {songs.map((song, i) => (
        <MediaCard key={song.id} to={songPath(song)} image={bestImage(song.images)} images={song.images} title={song.title} subtitle={song.subtitle} song={song} onPlay={() => play(song, i)} />
      ))}
    </Shelf>
  );
}

export function PlaylistMakerEntry({ onOpen, className }: { onOpen: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'group relative flex w-full items-center gap-4 my-6 p-4 pr-5 text-left rounded-[var(--vx-radius-panel)] overflow-hidden',
        'bg-ink-850 border border-ink-700/70 hover:border-ember-500/60 transition-colors',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-ember-500',
        className,
      )}
      data-tour="playlist-maker"
    >
      <span aria-hidden className="grid place-items-center w-12 h-12 shrink-0 rounded-2xl text-[var(--vx-on-accent)]" style={{ background: 'var(--vx-glow, rgb(var(--ember-500)))' }}>
        <SparkleIcon className="w-6 h-6" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-ink-100 font-bold text-[17px] leading-tight" style={{ fontFamily: 'var(--vx-font-display)' }}>Make me a playlist</span>
        <span className="block text-ink-300 text-sm leading-snug mt-0.5">Say what you want in plain words. The engine builds it from your taste and the catalogue.</span>
      </span>
      <span className="shrink-0 rounded-full px-4 py-2 text-sm font-bold bg-ember-500 text-[var(--vx-on-accent)] group-hover:brightness-110">Build</span>
    </button>
  );
}

export function PersonalHome({ generation }: { generation: number }) {
  const { view, loading, enabled } = usePersonalHome(generation);
  const [makerOpen, setMakerOpen] = useState(false);
  if (!enabled) return null;
  return (
    <section className="vxh-personal" aria-label="Personalised for you" data-home-block="personal-engine">
      <PlaylistMakerEntry onOpen={() => setMakerOpen(true)} />
      {makerOpen && (
        <Suspense fallback={null}>
          <PlaylistMaker onClose={() => setMakerOpen(false)} />
        </Suspense>
      )}
      {loading && !view && <ShelfSkeleton />}
      {view && (
        <>
          {view.page.greeting && <p className="vxh-personal-greeting">{view.page.greeting}</p>}
          {view.shelves.map((shelf) => <PersonalShelf key={shelf.key} shelf={shelf} />)}
          <p className="vxh-personal-note">
            {view.page.model ? 'Arranged for this moment by VinaX AI from your taste model.' : 'Built from your taste model.'}{' '}
            <a href="/settings#privacy" className="underline">What it uses</a>
          </p>
        </>
      )}
    </section>
  );
}
