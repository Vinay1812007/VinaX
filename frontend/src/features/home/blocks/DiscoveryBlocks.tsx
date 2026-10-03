import { ShelfSkeleton } from '@/components/Skeletons';
import { useSettingsStore } from '@/store/settingsStore';
import { HUB_LANGUAGES, languageLabel } from '@/constants/languages';
import { trendingSeed } from '@/constants/seeds';
import { useRegion } from '@/features/location/useRegion';
import { useAiHome } from '../useAiHome';
import { useFeatureEnabled } from '../useAppConfig';
import { useAiTrending } from '../useAiTrending';
import { useTrendingForLanguage, useNewReleases, usePopular } from '../useHomeShelves';
import { useFreshFinds, useHiddenGems, useTrendingNearYou } from '../useDiscoveryShelves';
import { useCurrentNow } from '../useCurrentNow';
import { useMoodShelf } from '../useMoodShelves';
import { useShelfDedupe } from '../shelfLedger';
import { MoreShelves, SongShelf, useShelfLens } from './shared';

const hubOrSearch = (language: string): string =>
  (HUB_LANGUAGES as readonly string[]).includes(language) ? `/${language}-songs` : `/search/${encodeURIComponent(trendingSeed(language))}`;

/** v6.2.0 — "Designed for you": AI-titled shelves resolved against the catalogue. Renders nothing until they exist. */
export function AiHomeBlock() {
  const dedupe = useShelfDedupe('aihome');
  const lens = useShelfLens();
  const allowed = useFeatureEnabled('aiHome');
  const shelves = useAiHome(allowed);
  if (!allowed || !shelves.data?.length) {
    return shelves.isLoading && allowed ? <ShelfSkeleton /> : null;
  }
  return (
    <section aria-label="Designed for you" className="vxh-band">
      <h2 className="vxh-band-title">Designed for you</h2>
      {shelves.data.map((shelf) => (
        <SongShelf key={shelf.title} title={shelf.title} explanation={shelf.description || shelf.reason} songs={dedupe(lens(shelf.songs, 'discovery'))} seeAllTo={`/search/${encodeURIComponent(shelf.query)}`} />
      ))}
    </section>
  );
}

/**
 * Fresh discoveries: what is popular near the listener and in their
 * languages, ordered by their taste; the long tail of trending shelves is
 * behind "More trending". Every list uses the discovery rule: songs heard in
 * the last stretch or skipped this sitting are left out, songs Home already
 * showed this week go to the back.
 */
export function DiscoveryBlock() {
  const dedupe = useShelfDedupe('discovery');
  const lens = useShelfLens();
  const region = useRegion();
  const pinned = useSettingsStore((s) => s.pinnedLanguages);
  const primaryLang = pinned[0] ?? 'hindi';
  const nearYou = useTrendingNearYou();
  const trendingNow = useAiTrending();
  const trending = useTrendingForLanguage(primaryLang);
  const newReleases = useNewReleases();
  // 9.1.0 — the one shelf with outside evidence behind it. Absent when the
  // discovery service has nothing to show, which is why it is not skeletoned:
  // a shelf that may legitimately not exist should not reserve space.
  const current = useCurrentNow();
  return (
    <>
      {current.songs.length > 0 && (
        <SongShelf
          title="Current now"
          explanation={`Songs a current chart or web source named, checked against the catalogue.${current.note ? ` ${current.note}` : ''}`}
          songs={dedupe(lens(current.songs, 'discovery'))}
        />
      )}
      {nearYou.isLoading ? <ShelfSkeleton /> : (
        <SongShelf title={region?.country ? `Trending near you · ${region.regionLabel ?? region.country}` : 'Trending near you'} songs={dedupe(lens(nearYou.data, 'discovery'))} />
      )}
      {/* Popular picks for you — the catalogue's popular pool, ordered by taste (and by the AI when it is on). Public charts with real provenance live on the Charts page. */}
      {trendingNow.isLoading ? <ShelfSkeleton /> : (
        <SongShelf
          title="Popular picks for you"
          explanation={trendingNow.by === 'ai' ? 'Popular in the catalogue, put in your order by VinaX AI' : 'Popular in the catalogue, in the order your taste suggests'}
          songs={dedupe(lens(trendingNow.songs, 'discovery'))}
          seeAllTo="/charts"
        />
      )}
      {trending.isLoading ? <ShelfSkeleton /> : <SongShelf title={`Trending · ${languageLabel(primaryLang)}`} songs={dedupe(lens(trending.data, 'discovery'))} seeAllTo={hubOrSearch(primaryLang)} />}
      {newReleases.isLoading ? <ShelfSkeleton /> : <SongShelf title="New releases" songs={dedupe(lens(newReleases.data, 'discovery'))} />}
      <MoreShelves id="discovery-more" label="More trending" hint="Popular in your languages, fresh finds, hidden gems, classics">
        {() => <MoreDiscovery primaryLang={primaryLang} secondLang={pinned[1] && pinned[1] !== primaryLang ? pinned[1] : null} />}
      </MoreShelves>
    </>
  );
}

function MoreDiscovery({ primaryLang, secondLang }: { primaryLang: string; secondLang: string | null }) {
  const dedupe = useShelfDedupe('discovery-more');
  const lens = useShelfLens();
  const popular = usePopular();
  const freshFinds = useFreshFinds();
  const hiddenGems = useHiddenGems();
  const decadeRewind = useMoodShelf(`90s ${primaryLang} hits`, primaryLang, 12);
  // Hook order stays static: the second-language query just goes unused when there isn't one.
  const trendingSecond = useTrendingForLanguage(secondLang ?? primaryLang);
  return (
    <>
      {popular.isLoading ? <ShelfSkeleton /> : <SongShelf title="Popular in your languages" songs={dedupe(lens(popular.data, 'discovery'))} seeAllTo="/charts" />}
      {freshFinds.isLoading ? <ShelfSkeleton /> : <SongShelf title="Fresh finds" songs={dedupe(lens(freshFinds.data, 'discovery'))} />}
      {hiddenGems.isLoading ? <ShelfSkeleton /> : <SongShelf title="Hidden gems" songs={dedupe(lens(hiddenGems.data, 'discovery'))} />}
      <SongShelf title={`90s ${languageLabel(primaryLang)} classics`} songs={dedupe(lens(decadeRewind.data, 'discovery'))} />
      {secondLang && <SongShelf title={`Trending · ${languageLabel(secondLang)}`} songs={dedupe(lens(trendingSecond.data, 'discovery'))} seeAllTo={hubOrSearch(secondLang)} />}
    </>
  );
}
