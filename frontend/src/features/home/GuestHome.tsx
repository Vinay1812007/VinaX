import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useUiStore } from '@/store/uiStore';
import { useSettingsStore } from '@/store/settingsStore';
import { HUB_LANGUAGES, languageLabel } from '@/constants/languages';
import { useTrendingNow } from './useHomeShelves';
import { useNewAlbums } from './useCatalogFeeds';
import { resetShelfLedger, setShelfBlockOrder } from './shelfLedger';
import { DeferredBlock, HomeSignalsProvider } from './blocks/shared';
import { ChartsBlock, MoodsBlock } from './blocks/CatalogueBlocks';
import { ArtistStationsRow, CityHotRow, EditorialRows, PodcastsRow, RadioStationsRow, TRENDING_NOW_BLOCK, TrendingNowRow } from './CatalogueRows';
import { Shelf } from '@/components/Shelf';
import { MediaCard } from '@/components/MediaCard';
import { albumPath } from '@/utils/slug';
import { bestImage } from '@/utils/images';

/**
 * Home for a signed-out visitor: the catalogue only (trending, charts,
 * editorial picks, radio, podcasts, new albums, moods), with one slim card
 * asking them to sign in. Nothing personal runs here — no mixes, no personal
 * engine, no AI layout, no friends — so it costs no account calls. Playing,
 * liking and saving ask the visitor to sign in (services/auth/gate).
 */

function NewAlbumsRow() {
  const albums = useNewAlbums();
  if (albums.isError || !albums.data?.length) return null;
  return (
    <Shelf title="New releases">
      {albums.data.map((a) => (
        <MediaCard key={a.id} to={albumPath(a)} image={bestImage(a.images)} images={a.images} title={a.title} subtitle={a.subtitle} />
      ))}
    </Shelf>
  );
}

export function GuestSignInCard() {
  const openSignIn = useUiStore((s) => s.openSignIn);
  return (
    <aside className="vxh-guest-card" aria-label="Sign in">
      <p>Sign in to save your music and get picks made for you.</p>
      <button type="button" className="vxh-pill" onClick={() => openSignIn('account')}>Sign in</button>
    </aside>
  );
}

export function GuestHome() {
  useState(() => {
    resetShelfLedger();
    setShelfBlockOrder([TRENDING_NOW_BLOCK, 'moods']);
  });
  const trending = useTrendingNow();
  const pinned = useSettingsStore((s) => s.pinnedLanguages);
  const langs = [...pinned, ...(HUB_LANGUAGES as readonly string[]).filter((l) => !pinned.includes(l))].slice(0, 10);
  return (
    <HomeSignalsProvider generation={0}>
      <div className="vx-home vx-stagger vxh-guest">
        <header className="vxh-greet is-compact">
          <h1>Hi there</h1>
        </header>
        <GuestSignInCard />
        <TrendingNowRow songs={trending.data} loading={trending.isLoading} />
        <nav className="vxh-chips" aria-label="Browse">
          <Link className="vxh-chip" to="/languages">All languages</Link>
          {langs.map((l) => <Link key={l} className="vxh-chip" to={`/${l}-songs`}>{languageLabel(l)}</Link>)}
          <Link className="vxh-chip" to="/charts">Charts</Link>
          <Link className="vxh-chip" to="/moods">Moods</Link>
          <Link className="vxh-chip" to="/podcasts">Podcasts</Link>
        </nav>
        <ChartsBlock />
        <DeferredBlock render={() => <NewAlbumsRow />} />
        <DeferredBlock render={() => <EditorialRows />} />
        <DeferredBlock render={() => <CityHotRow />} />
        <DeferredBlock render={() => <RadioStationsRow />} />
        <DeferredBlock render={() => <ArtistStationsRow />} />
        <DeferredBlock render={() => <PodcastsRow />} />
        <DeferredBlock render={() => <MoodsBlock />} />
      </div>
    </HomeSignalsProvider>
  );
}
