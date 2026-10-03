import { Fragment, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import '@/styles/pages/home.css';
import { TopBarActions } from '@/components/TopBar';
import { IconButton } from '@/components/IconButton';
import { PullToRefresh } from '@/components/PullToRefresh';
import { PromoBanner } from '@/components/PromoBanner';
import { GetAppBanner } from '@/components/GetAppBanner';
import { PushPromptCard } from '@/components/PushPromptCard';
import { NotificationSheet } from '@/components/NotificationSheet';
import { DownloadCta } from '@/components/DownloadCta';
import { BellIcon, ChevronDownIcon, MoonIcon, SunIcon } from '@/components/Icons';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDiscoveryStore } from '@/store/discoveryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useHistoryStore } from '@/store/historyStore';
import { usePlayerStore, useCurrentSong } from '@/store/playerStore';
import { toast } from '@/store/toastStore';
import { invalidateRecommendationCache } from '@/services/recommendation/engine';
import { recordServed, songKey } from '@/services/recommendation/songIdentity';
import { HOME_DESIGN_KEY, loadHomeDesign, validateHomeDesign, type HomeDesign, type HomeSection } from '@/services/recommendation/homeDesign';
import { loadProfile } from '@/services/personalization/storage';
import { topArtists, topLanguages } from '@/services/personalization/profile';
import { activeFestivalMusic } from '@/services/recommendation/festival';
import { getLocal } from '@/services/storage/local';
import { KEYS } from '@/constants/storage-keys';
import { HUB_LANGUAGES, languageLabel } from '@/constants/languages';
import { getStreak } from '@/utils/streak';
import { listeningTotal } from '@/features/stats/listening';
import { useRegion } from '@/features/location/useRegion';
import { useExperiment } from '@/features/experiments/useExperiment';
import { EXP_HOME_SHELF_ORDER, homeShelfOrder } from '@/features/experiments/homeShelfOrder';
import { useRecommendations } from '@/features/recommendations/useRecommendations';
import { HomeHero } from '@/features/home/HomeHero';
import { ListeningGuide } from '@/features/home/ListeningGuide';
import { HomeStudio } from '@/features/home/HomeStudio';
import { HomeAbout } from '@/features/home/HomeAbout';
import { composeHomeLayout } from '@/features/home/homeLayout';
import { orderHomeBlocks, sessionHomeOrder } from '@/features/home/homeOrder';
import { attributeSong, installHomeOutcomeTracking, loadHomeSignals, noteBlockTap } from '@/features/home/homeSignals';
import { blockForTap } from '@/features/home/homeTaps';
import { genreAffinityStrength } from '@/features/home/genreAffinity';
import { resetShelfLedger, setShelfBlockOrder } from '@/features/home/shelfLedger';
import { resetShelfDeduper } from '@/features/home/dedupeShelves';
import { personalMessage } from '@/features/home/personalMessage';
import { useClientConfig } from '@/features/home/useAppConfig';
import { useContinueListening, useTrendingNow } from '@/features/home/useHomeShelves';
import { useDailyMix } from '@/features/home/useDailyMix';
import { refreshHome, useHomeVisit } from '@/features/home/homeRefresh';
import { useShelfSafety } from '@/features/home/useShelfSafety';
import { DeferredBlock, HomeSignalsProvider } from '@/features/home/blocks/shared';
import { PersonalBlock } from '@/features/home/blocks/PersonalBlock';
import { AiHomeBlock, DiscoveryBlock } from '@/features/home/blocks/DiscoveryBlocks';
import { AlbumsBlock, ArtistsBlock, ChartsBlock, DayPicksBlock, FeedBlock, GenresBlock, LovedBlock, MoodsBlock, QuickBlock, readTaste, SeasonalBlock } from '@/features/home/blocks/CatalogueBlocks';

/**
 * Home blocks are self-contained: every catalogue query a block needs lives
 * INSIDE it. Only blocks in the composed layout render at all (an owner- or
 * listener-hidden shelf never fetches); blocks beyond the first two mount
 * through DeferredBlock as they scroll near.
 */
const HOME_BLOCKS: Record<HomeSection, () => ReactNode> = {
  quick: QuickBlock,
  personal: PersonalBlock,
  aihome: AiHomeBlock,
  discovery: DiscoveryBlock,
  charts: ChartsBlock,
  seasonal: SeasonalBlock,
  moods: MoodsBlock,
  genres: GenresBlock,
  artists: ArtistsBlock,
  albums: AlbumsBlock,
  daypicks: DayPicksBlock,
  loved: LovedBlock,
  feed: FeedBlock,
};

// Default order honours the home-shelf-order experiment (personal <-> discovery).
const HOME_BLOCK_KEYS: HomeSection[] = ['quick', 'personal', 'aihome', 'discovery', 'charts', 'seasonal', 'moods', 'genres', 'artists', 'albums', 'daypicks', 'loved', 'feed'];
/**
 * 9.0.0 — progressive disclosure: the first PRIMARY_BLOCKS visible blocks
 * (by default the shortcuts, For you, Designed for you and Fresh
 * discoveries) are the page; the wider catalogue (charts, moods, genres,
 * artists, albums, the endless feed…) waits behind "Explore more". The order
 * and the hidden set still come from Customise Home and the owner's layout.
 */
const PRIMARY_BLOCKS = 4;
/** Blocks with an inner disclosure claim shelves in their own ledger slot, right after their block. */
const INNER = { personal: 'personal-more', discovery: 'discovery-more' } as const;

function useRememberedOpen(id: string): [boolean, (v: boolean) => void] {
  const key = `vinax.home.open.${id}`;
  const [open, setOpen] = useState(() => {
    try { return sessionStorage.getItem(key) === '1'; } catch { return false; }
  });
  return [open, (v) => {
    setOpen(v);
    try { if (v) sessionStorage.setItem(key, '1'); else sessionStorage.removeItem(key); } catch { /* a convenience */ }
  }];
}

/** The playing song's lyrics, one tap from Home (8.2.0). Its own component so a track change re-renders only the chip. */
function LyricsChip() {
  const song = useCurrentSong();
  if (!song) return null;
  return <Link className="vxh-chip" to={`/lyrics/${song.id}`}>Lyrics</Link>;
}

export default function HomePage() {
  // 9.0.0 — one Home generation per visit window (features/home/homeRefresh.ts).
  const generation = useHomeVisit();
  const [homeDesign, setHomeDesign] = useState<HomeDesign | null>(loadHomeDesign);
  // A fresh visit starts with an empty cross-shelf ledger.
  useState(() => resetShelfLedger());
  usePageTitle('Home');
  const pinned = useSettingsStore((s) => s.pinnedLanguages);
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const navigate = useNavigate();
  const qc = useQueryClient();
  // Warms the region lookup the Charts and Trending-near-you blocks read.
  useRegion();
  const historyEntries = useHistoryStore((s) => s.entries);
  // 8.2.0 — how songs started from Home end feeds the dynamic order.
  useEffect(() => installHomeOutcomeTracking(), []);

  // 9.0.0 — the opening goes through the listener's current safety settings too (a hide, a mute, Kid mode: at once).
  const allowed = useShelfSafety();
  const continueListening = useContinueListening().filter(allowed);
  // Above-the-fold data: the Aura Mix and its fallbacks. Every other catalogue query lives in its block.
  const daily = useDailyMix();
  const trendingNow = useTrendingNow();
  const mixes = useRecommendations();
  const playQueue = usePlayerStore((s) => s.playQueue);
  const shelfOrder = homeShelfOrder(useExperiment(EXP_HOME_SHELF_ORDER));
  const personalMix = mixes.data?.find((mix) => mix.kind === 'made-for-you')?.songs;
  const heroSongs = (personalMix?.length ? personalMix : daily.data?.length ? daily.data : trendingNow.data?.length ? trendingNow.data : continueListening).filter(allowed);

  // Quick-play home-screen widget: ?widget=play (cold start) or a sessionStorage flag (warm start) starts the Aura Mix once.
  const widgetPlayed = useRef(false);
  useEffect(() => {
    if (widgetPlayed.current || !heroSongs.length) return;
    let want = false;
    try {
      want = sessionStorage.getItem('vinax.widget-play') === '1' || new URLSearchParams(window.location.search).get('widget') === 'play';
    } catch { /* private mode */ }
    if (!want) return;
    widgetPlayed.current = true;
    try {
      sessionStorage.removeItem('vinax.widget-play');
      window.history.replaceState(null, '', window.location.pathname);
    } catch { /* best effort */ }
    playQueue(heroSongs, 0);
  }, [heroSongs, playQueue]);

  const userName = getLocal<string>(KEYS.userName, '');
  const weekAgo = Date.now() - 7 * 86_400_000;
  // The greeting: on-device only, day-stable, never flips mid-visit.
  const hello = useMemo(() => {
    const now = new Date();
    const profile = loadProfile();
    const lastTs = historyEntries[0]?.ts ?? null;
    return personalMessage({
      name: userName,
      hour: now.getHours(),
      dayOfWeek: now.getDay(),
      dateKey: now.toISOString().slice(0, 10),
      totalPlays: historyEntries.length,
      weekPlays: historyEntries.filter((e) => e.ts >= weekAgo).length,
      weekMinutes: listeningTotal(historyEntries, weekAgo).minutes,
      streakDays: getStreak(),
      daysSinceLastListen: lastTs ? (Date.now() - lastTs) / 86_400_000 : Infinity,
      topLanguage: topLanguages(profile, 1)[0]?.id ?? null,
      topArtist: topArtists(profile, 1)[0]?.affinity.name ?? null,
      festivalId: activeFestivalMusic(now)?.id ?? null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- day-stable inputs
  }, [userName, historyEntries.length]);
  const streakDays = getStreak();
  const [notifOpen, setNotifOpen] = useState(false);

  // An explicit refresh: a new Home generation (every generation-keyed query
  // builds again, the old shelves stay on screen meanwhile), a new discovery
  // round, and a refetch of the shelves that rotate by day. PullToRefresh
  // waits for all of it before it lets go.
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = (fewerRepeats = false) => {
    recordServed(heroSongs.map(songKey));
    useDiscoveryStore.getState().refresh();
    invalidateRecommendationCache();
    resetShelfDeduper();
    resetShelfLedger();
    // 9.1.0 — `fewerRepeats` runs this one generation under the strict
    // repetition rule (features/home/homeRefresh.ts).
    refreshHome({ fewerRepeats });
    return Promise.all(
      ['trending', 'new-releases-lang', 'time-of-day', 'vinax-daily', 'weekly-mix', 'unlimited-feed', 'recently-played-albums', 'because-you-listened-to', 'because-liked', 'fresh-finds', 'hidden-gems', 'trending-near-you', 'trending-albums', 'trending-artists-src', 'seasonal', 'mood-shelf', 'genre-shelf']
        .map((key) => qc.invalidateQueries({ queryKey: [key] })),
    );
  };
  const refreshNow = async (fewerRepeats = false) => {
    setRefreshing(true);
    try {
      await handleRefresh(fewerRepeats);
      toast(
        fewerRepeats
          ? 'Home refreshed, leaving out everything you have heard lately — some shelves may be shorter.'
          : 'Home refreshed with new picks',
      );
    } catch {
      toast('Could not refresh right now. Try again shortly.');
    } finally {
      setRefreshing(false);
    }
  };
  const surprise = () => {
    // Songs the page already holds — no extra catalogue call for a surprise.
    const pool = [...heroSongs, ...(trendingNow.data ?? []), ...continueListening];
    if (!pool.length) return toast('Still loading — try again in a second');
    const i = Math.floor(Math.random() * pool.length);
    playQueue(pool, i);
    toast(`Surprise: ${pool[i].title}`);
  };

  // The language chips: pinned first, then the hub languages in the owner's order (Admin → Language Order).
  const clientCfg = useClientConfig();
  const langOrder = clientCfg?.languageOrder ?? [];
  const rank = (l: string) => { const i = langOrder.indexOf(l); return i < 0 ? 999 : i; };
  const railLangs = [...pinned, ...(HUB_LANGUAGES as readonly string[]).filter((l) => !pinned.includes(l)).sort((a, b) => rank(a) - rank(b))].slice(0, 10);

  const defaultOrder = shelfOrder === 'discovery-first'
    ? HOME_BLOCK_KEYS.map((k) => (k === 'personal' ? 'discovery' : k === 'discovery' ? 'personal' : k))
    : HOME_BLOCK_KEYS;
  // Listener order wins; owner-disabled shelves stay disabled (homeLayout.ts).
  const layout = composeHomeLayout(homeDesign, clientCfg?.homeLayout, defaultOrder);
  // 8.2.0 — when nobody chose an order, Home orders itself once per session (homeOrder.ts): nothing moves while the listener scrolls.
  const blocks = layout.orderChosen || shelfOrder !== 'control'
    ? layout.visible
    : sessionHomeOrder(layout.visible, () => orderHomeBlocks({ base: layout.visible, hour: new Date().getHours(), now: Date.now(), signals: loadHomeSignals(), genreStrength: genreAffinityStrength(readTaste().genres) }));
  // Customise Home starts from the order the listener actually sees.
  const design = layout.orderChosen ? layout.design : { ...layout.design, order: [...blocks, ...layout.design.order.filter((k) => !blocks.includes(k))] };
  setShelfBlockOrder(blocks.flatMap((b) => (b in INNER ? [b, INNER[b as keyof typeof INNER]] : [b])));
  const primary = blocks.slice(0, PRIMARY_BLOCKS);
  const explore = blocks.slice(PRIMARY_BLOCKS);
  const [exploreOpen, setExploreOpen] = useRememberedOpen('explore');
  const exploreRegion = useId();

  const applyDesign = (value: HomeDesign) => {
    const checked = validateHomeDesign(value);
    setHomeDesign(checked);
    try { localStorage.setItem(HOME_DESIGN_KEY, JSON.stringify(checked)); toast('Your Home layout is saved'); } catch { toast('Layout applied for this visit. Device storage is unavailable.'); }
  };
  const resetDesign = () => { setHomeDesign(null); try { localStorage.removeItem(HOME_DESIGN_KEY); } catch { /* session reset still works */ } };
  const studio = <HomeStudio design={design} locked={layout.ownerHidden} onApply={applyDesign} onReset={resetDesign} />;

  // 8.2.0 — usage signal: which block a tap landed in, and the song it started (if any).
  const noteTap = (e: React.MouseEvent<HTMLDivElement>) => {
    const block = blockForTap(e.currentTarget, e.target);
    if (!block) return;
    noteBlockTap(block);
    const before = usePlayerStore.getState().queue[usePlayerStore.getState().index]?.id;
    window.setTimeout(() => {
      const st = usePlayerStore.getState();
      const started = st.queue[st.index]?.id;
      if (started && started !== before) attributeSong(started, block);
    }, 0);
  };
  const renderBlock = (k: HomeSection, i: number) => {
    const Block = HOME_BLOCKS[k];
    return (
      <Fragment key={k}>
        {/* Invisible block markers for the usage signal (features/home/homeTaps.ts). */}
        <span hidden data-home-block={k} />
        {i < 2 ? <Block /> : <DeferredBlock render={() => <Block />} />}
        <span hidden data-home-block="" />
      </Fragment>
    );
  };
  const feedInExplore = explore.includes('feed');

  return (
    <PullToRefresh onRefresh={handleRefresh}>
      <HomeSignalsProvider generation={generation}>
        <div className="vx-home vx-stagger" onClickCapture={noteTap}>
          <TopBarActions>
            <IconButton label="Toggle theme" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <SunIcon className="w-5 h-5" /> : <MoonIcon className="w-5 h-5" />}</IconButton>
            <IconButton label="Notifications" onClick={() => setNotifOpen(true)}><BellIcon className="w-5 h-5" /></IconButton>
          </TopBarActions>
          <NotificationSheet open={notifOpen} onClose={() => setNotifOpen(false)} />

          <header className="vxh-greet">
            <h1>{hello.title}</h1>
            <p className="vxh-greet-sub">
              {hello.subtitle}
              {streakDays > 1 && <span className="vxh-streak">{streakDays}-day streak</span>}
            </p>
            {clientCfg?.greeting?.text && <p className="vxh-greet-note">{clientCfg.greeting.text}</p>}
          </header>

          <HomeHero
            design={design}
            songs={heroSongs}
            recent={continueListening}
            onPlay={() => heroSongs.length && playQueue(heroSongs, 0)}
            onResume={(index) => playQueue(continueListening, index)}
            onRadio={() => navigate('/radio')}
            onSurprise={surprise}
          />
          <ListeningGuide />

          {primary.map(renderBlock)}

          <section className="vxh-explore" aria-labelledby={`${exploreRegion}-title`}>
            <div className="vxh-explore-head">
              <h2 id={`${exploreRegion}-title`}>Explore more</h2>
              <div className="vxh-explore-actions">
                <button type="button" className="vxh-pill is-quiet" disabled={refreshing} onClick={() => void refreshNow()}>{refreshing ? 'Refreshing…' : 'Refresh Home'}</button>
                {/* 9.1.0 — the strict rule for one refresh: nothing the listener has met lately. */}
                <button type="button" className="vxh-pill is-quiet" disabled={refreshing} onClick={() => void refreshNow(true)} title="Leave out everything you have heard or been shown lately">Fewer repeats</button>
                {exploreOpen && explore.length > 0 && (
                  <button type="button" className="vxh-pill is-quiet" aria-expanded aria-controls={exploreRegion} onClick={() => setExploreOpen(false)}>Show less</button>
                )}
              </div>
            </div>
            <nav className="vxh-chips" aria-label="Browse">
              <Link className="vxh-chip" to="/languages">All languages</Link>
              {railLangs.map((l) => <Link key={l} className="vxh-chip" to={`/${l}-songs`}>{languageLabel(l)}</Link>)}
              <Link className="vxh-chip" to="/charts">Charts</Link>
              <Link className="vxh-chip" to="/trending">Trending</Link>
              <Link className="vxh-chip" to="/moods">Moods</Link>
              <Link className="vxh-chip" to="/regions">Regions</Link>
              <Link className="vxh-chip" to="/made-for-you">Made for you</Link>
              <LyricsChip />
            </nav>
            <p className="sr-only" role="status">{refreshing ? 'Refreshing Home…' : ''}</p>
            {explore.length > 0 && (
              <>
                {exploreOpen && (
                  <div id={exploreRegion}>
                    {explore.map((k, i) => (
                      <Fragment key={k}>
                        {k === 'feed' && studio}
                        {renderBlock(k, primary.length + i)}
                      </Fragment>
                    ))}
                  </div>
                )}
                {!exploreOpen && (
                  <button type="button" className="vxh-disclose" aria-expanded={false} onClick={() => setExploreOpen(true)}>
                    <span className="vxh-disclose-text">
                      <span>Show more for you</span>
                      <span className="vxh-disclose-hint">{explore.length} more {explore.length === 1 ? 'section' : 'sections'}: charts, moods, genres, artists and an endless feed</span>
                    </span>
                    <ChevronDownIcon className="w-5 h-5" />
                  </button>
                )}
              </>
            )}
          </section>

          <div className="vxh-asks">
            <GetAppBanner />
            <DownloadCta />
            <PushPromptCard />
            {/* Owner-published promo banner (admin → Banner & Promotion). */}
            <PromoBanner />
          </div>
          {!(exploreOpen && feedInExplore) && studio}
          <HomeAbout />
        </div>
      </HomeSignalsProvider>
    </PullToRefresh>
  );
}
