import { DestinationGrid } from '@/components/DestinationGrid';
import { SearchWorkspace, SavedSearches } from '@/features/search/SearchWorkspace';
import { refineSongs } from '@/features/search/workspace';
import { useSearchWorkspaceStore, type SearchPreset } from '@/store/searchWorkspaceStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useHistoryStore } from '@/store/historyStore';
import { isNativePlatform } from '@/services/native';
import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { albumPath, artistPath, playlistPath } from '@/utils/slug';
import { Link, useNavigate, useNavigationType, useParams } from 'react-router-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { SongRow } from '@/components/SongRow';
import { TrackMenu } from '@/components/TrackMenu';
import { MediaCard } from '@/components/MediaCard';
import { Chip } from '@/components/Chip';
import { ListSkeleton } from '@/components/Skeletons';
import { EmptyState, ErrorState } from '@/components/States';
import { InfiniteSentinel } from '@/components/InfiniteSentinel';
import { ClockIcon, PlayIcon, SearchIcon, SparkleIcon, XIcon } from '@/components/Icons';
import { normalizeQuery, rankSongs, useSearchAll } from '@/features/search/useSearch';
import {
  flattenAlbumPages,
  flattenArtistPages,
  flattenPlaylistPages,
  flattenSongPages,
  useInfiniteAlbums,
  useInfiniteArtists,
  useInfinitePlaylists,
  useInfiniteSongs,
} from '@/features/search/useInfiniteSongs';
import {
  createSttSession,
  probeSttSupport,
  sttSupported,
  type SttSession,
} from '@/features/voice/stt';
import { isSongSort, SONG_SORTS, useSearchStore } from '@/store/searchStore';
import { usePlayerStore } from '@/store/playerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { toast } from '@/store/toastStore';
import { loadProfile } from '@/services/personalization/storage';
import { topArtists } from '@/services/personalization/profile';
import { recordSearchPlay } from '@/services/personalization/updater';
import { fetchWithTimeout } from '@/services/api/client';
import { expertSongSearch } from '@/services/ai/expert';
import type { Song } from '@/types';
import { playAlbum, playArtist, playPlaylist } from '@/features/player/playEntity';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { letterAvatar } from '@/utils/avatar';
import { cn } from '@/utils/cn';
import { languageLabel } from '@/constants/languages';
import { MOODS } from '@/constants/seeds';
import { useTrendingNow } from '@/features/home/useHomeShelves';
import { shouldSyncRouteToInput } from '@/features/search/routeSync';
import { looksLikeLyric, splitHighlight } from '@/features/search/lyricsSearch';
import { useLyricsSearch } from '@/features/search/useLyricsSearch';
import { filterSongsLocally, SONG_SORT_LABELS, sortSongs } from '@/features/search/sortSongs';
import { exampleQueries } from '@/features/search/searchTips';
import { rerankSongs, suggestTitles } from '@/features/search/rerank';
import { candidatePool, COMMON_NAMES, didYouMean } from '@/features/search/didYouMean';
import { useQuickResults } from '@/features/search/useQuickResults';
import { putCachedQuick, QUICK_LIMIT } from '@/features/search/quickResults';
import { PageHeader } from '@/components/PageHeader';
import { looksLikeNaturalLanguage } from '@/services/ai/musicIntent';
import { Shelf } from '@/components/Shelf';
import { IconButton } from '@/components/IconButton';
import '@/styles/pages/browse.css';

// 8.2.0 — natural-language matches load only for queries that read like a description.
const SemanticMatches = lazy(() => import('@/features/search/SemanticMatches'));

const TABS = ['All', 'Songs', 'Albums', 'Artists', 'Playlists'] as const;
type Tab = (typeof TABS)[number];

// Package D4 — the picked filter tab sticks for the whole browsing session, so
// leaving Search and coming back lands on the same view (session-scoped only;
// a fresh open always starts on All).
const TAB_KEY = 'vinax.search.tab.v1';
function loadStickyTab(): Tab {
  try {
    const t = window.sessionStorage.getItem(TAB_KEY);
    return (TABS as readonly string[]).includes(t ?? '') ? (t as Tab) : 'All';
  } catch {
    return 'All';
  }
}

/** Bold the matched substring so suggestions read as completions (P2-30). */
function Highlight({ text, term }: { text: string; term: string }) {
  const i = term ? text.toLowerCase().indexOf(term.toLowerCase()) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <span className="text-ink-100 font-extrabold">{text.slice(i, i + term.length)}</span>
      {text.slice(i + term.length)}
    </>
  );
}

/** v5.17.0 — a small push-pin, used on pinned recents. */
function PinGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M9 3h6l-1 6.5 3 2.5v2H7v-2l3-2.5L9 3z" />
      <path d="M12 14v7" />
    </svg>
  );
}

/** v5.17.0 — one recent search: tap opens it, long-press (or the pin
 *  button) pins it to the front, × forgets it.
 *  8.0.0 — a list row (clock or pin sleeve, the words, then the tools). Pin
 *  and × fade in on hover or keyboard focus; on touch screens only × stays
 *  visible and long-press does the pinning. */
function RecentRow({
  query,
  pinned,
  onOpen,
  onTogglePin,
  onRemove,
}: {
  query: string;
  pinned: boolean;
  onOpen: () => void;
  onTogglePin: (viaLongPress: boolean) => void;
  onRemove: () => void;
}) {
  const timer = useRef<number | null>(null);
  const longPressed = useRef(false);
  const cancel = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => cancel, []);
  return (
    <li className="search-recent-row">
      <button
        type="button"
        className="search-recent-open"
        onPointerDown={() => {
          longPressed.current = false;
          cancel();
          timer.current = window.setTimeout(() => {
            longPressed.current = true;
            onTogglePin(true);
          }, 550);
        }}
        onPointerUp={cancel}
        onPointerLeave={cancel}
        onPointerCancel={cancel}
        onContextMenu={(e) => {
          // A long-press on touch also raises contextmenu — swallow it once.
          if (longPressed.current) e.preventDefault();
        }}
        onClick={() => {
          if (longPressed.current) {
            longPressed.current = false;
            return;
          }
          onOpen();
        }}
      >
        <span className="search-recent-icon" aria-hidden>
          {pinned ? <PinGlyph /> : <ClockIcon />}
        </span>
        <span className="min-w-0">
          <span className="search-recent-text">{query}</span>
          {pinned && <span className="search-recent-meta">Pinned</span>}
        </span>
      </button>
      <span className="search-recent-tools">
        <button
          type="button"
          aria-label={pinned ? `Unpin ${query}` : `Pin ${query}`}
          aria-pressed={pinned}
          onClick={() => onTogglePin(false)}
          className="search-recent-tool search-recent-pin"
        >
          <PinGlyph className="w-4 h-4" />
        </button>
        <button type="button" aria-label={`Remove ${query}`} onClick={onRemove} className="search-recent-tool">
          <XIcon className="w-4 h-4" />
        </button>
      </span>
    </li>
  );
}

/** v5.19.0 — one compact, playable "Quick results" row under the suggestions. */
function QuickRow({ song, onPlay, dim }: { song: Song; onPlay: () => void; dim: boolean }) {
  const pointer = useRef<{ x: number; y: number } | null>(null);
  return (
    <button
      type="button"
      onClick={(e) => {
        if (e.detail === 0 && !dim) onPlay();
      }}
      disabled={dim}
      onPointerDown={(e) => {
        e.preventDefault(); // keep the box focused so the panel stays open
        pointer.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={(e) => {
        const p = pointer.current;
        pointer.current = null;
        if (p && Math.abs(e.clientX - p.x) < 12 && Math.abs(e.clientY - p.y) < 12) onPlay();
      }}
      className={cn(
        'w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-ink-800/60 transition-opacity',
        dim && 'opacity-50',
      )}
    >
      <img
        src={bestImage(song.images, 150)}
        onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)}
        alt=""
        className="w-9 h-9 rounded-md object-cover shrink-0"
      />
      <span className="min-w-0 flex-1">
        <span className="block text-sm truncate">{song.title}</span>
        <span className="block text-xs text-ink-400 truncate">{song.subtitle}</span>
      </span>
      <PlayIcon className="w-4 h-4 text-ink-400 shrink-0" />
    </button>
  );
}

/**
 * A song played from results the listener TYPED a query for is search intent,
 * on top of the ordinary play the row records. The row owns its own play
 * handler, so this layout-neutral wrapper listens for the same two gestures
 * that reach it (the row's buttons stop their own clicks from bubbling).
 */
function SearchPlay({ song, children }: { song: Song; children: React.ReactNode }) {
  return (
    <div
      className="contents"
      onClick={() => recordSearchPlay(song)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') recordSearchPlay(song);
      }}
    >
      {children}
    </div>
  );
}

/** Loading / error / empty for the Albums, Artists and Playlists tabs — the
 *  same trio, from the same components, the Songs tab shows. */
function GridTabState({
  result,
  count,
  noun,
}: {
  result: { isLoading: boolean; isError: boolean; refetch: () => unknown };
  count: number;
  noun: string;
}) {
  if (result.isLoading) return <ListSkeleton />;
  if (result.isError) return <ErrorState retry={() => void result.refetch()} />;
  if (count > 0) return null;
  return (
    <div className="search-no-matches" role="status">
      <h3>No matching {noun} yet</h3>
      <p>Try another name or spelling — or look under a different tab.</p>
    </div>
  );
}

export default function SearchPage() {
  const { query: routeQuery } = useParams();
  const navigate = useNavigate();
  const [input, setInput] = useState(routeQuery ?? '');
  const [tab, setTabState] = useState<Tab>(loadStickyTab);
  const setTab = useCallback((t: Tab) => {
    setTabState(t);
    try {
      window.sessionStorage.setItem(TAB_KEY, t);
    } catch {
      /* private mode — the tab just won't stick */
    }
  }, []);
  const [listening, setListening] = useState(false);
  // Voice search rides the same STT abstraction as the AI page: Web Speech in
  // browsers, the system recognizer (native plugin) inside the Android app.
  const [voiceReady, setVoiceReady] = useState<boolean>(() => sttSupported());
  useEffect(() => {
    void probeSttSupport().then(setVoiceReady);
  }, []);
  const filters = useSearchWorkspaceStore((s) => s.filters);
  const compactResults = useSearchWorkspaceStore((s) => s.compact);
  const favorites = useLibraryStore((s) => s.favorites);
  const history = useHistoryStore((s) => s.entries);
  const favoriteIds = useMemo(() => new Set(favorites.map((s) => s.id)), [favorites]);
  const heardIds = useMemo(() => new Set(history.map((e) => e.song.id)), [history]);
  const restoredLanguage = useRef<string | null>(null);
  const [langFilter, setLangFilter] = useState<string | null>(null);
  const [albumLang, setAlbumLang] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  // v5.17.0 — "Search by lyrics" mode (local to the visit; never in the URL).
  const [lyricsMode, setLyricsMode] = useState(false);
  const [lyricHintDismissed, setLyricHintDismissed] = useState('');
  // v5.17.0 — local "filter these results" text on the Songs tab.
  const [resultFilter, setResultFilter] = useState('');
  const navigationType = useNavigationType();
  const searchInputRef = useRef<HTMLInputElement>(null);
  // Focus the box only on a FRESH arrival at /search with no query — never on
  // back-navigation, where a popping keyboard + focus scroll would fight the
  // restored position (delta audit P1-17).
  useEffect(() => {
    if (!routeQuery && navigationType !== 'POP') searchInputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only by design
  }, []);
  // Live focus for effects: the route→input sync must read the CURRENT focus
  // synchronously (state is one render behind), so it never fights typing.
  const focusedRef = useRef(false);
  const debounced = useDebouncedValue(input, 350);
  // v5.19.0 — a COMMITTED query (Enter, chip, suggestion, voice, deep link)
  // skips the typing debounce: the request — and its skeleton — start on the
  // same frame as the commit. Live typing still settles through `debounced`.
  const [commitQ, setCommitQ] = useState<string | null>(() =>
    routeQuery ? normalizeQuery(routeQuery) : null,
  );
  const typedNow = normalizeQuery(input);
  const q = commitQ !== null && typedNow === commitQ ? commitQ : normalizeQuery(debounced);
  usePageTitle(q ? `“${q}”` : 'Search');

  const recent = useSearchStore((s) => s.recent);
  const pinned = useSearchStore((s) => s.pinned);
  const songSort = useSearchStore((s) => s.songSort);
  const addRecent = useSearchStore((s) => s.addRecent);
  const removeRecent = useSearchStore((s) => s.removeRecent);
  const clearRecent = useSearchStore((s) => s.clearRecent);
  const togglePin = useSearchStore((s) => s.togglePin);
  const setSongSort = useSearchStore((s) => s.setSongSort);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const enqueueAll = usePlayerStore((s) => s.enqueueAll);
  const pinnedLangs = useSettingsStore((s) => s.pinnedLanguages);
  const mutedLangs = useSettingsStore((s) => s.mutedLanguages);

  // Ask AI for songs — the Search page's own music expert (a dedicated,
  // personalized discovery engine; separate from the AI Playlist builder).
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSongs, setAiSongs] = useState<Song[] | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  const askExpert = async (text: string) => {
    const p = text.trim();
    if (!p || aiLoading) return;
    setAiPrompt(p);
    setAiLoading(true);
    setAiError(null);
    setAiSongs(null);
    const res = await expertSongSearch(p, pinnedLangs, mutedLangs);
    setAiLoading(false);
    if (res.ok) {
      setAiSongs(res.songs);
      return;
    }
    // 8.2.0 — `not_configured` is now only a real switch-off or a missing
    // setup; a busy, over-budget or briefly unavailable service is `error`.
    if (res.reason === 'not_configured') setAiError('The music expert is switched off on this server.');
    else if (res.reason === 'empty') setAiError('The music expert came up empty — try rephrasing.');
    else setAiError('The music expert is unavailable right now — try again in a minute.');
  };

  // A new search query starts a fresh round with the expert — and clears any
  // language filters chosen for the previous query, so a filtered tab never
  // silently shows nothing (delta audit P1-12). The local result filter
  // (v5.17.0) resets for the same reason.
  useEffect(() => {
    setAiSongs(null);
    setAiError(null);
    setLangFilter(restoredLanguage.current);
    restoredLanguage.current = null;
    setAlbumLang(null);
    setResultFilter('');
  }, [q]);

  const expertPanel = (aiLoading || aiError || (aiSongs?.length ?? 0) > 0) && (
    <div className="mt-4">
      {aiLoading && <ListSkeleton />}
      {!aiLoading && aiError && <p className="text-sm text-ink-400">{aiError}</p>}
      {!aiLoading && aiSongs && aiSongs.length > 0 && (
        <section>
          <div className="search-section-heading !mb-1">
            <h2 className="!text-[17px]">Expert picks</h2>
            <button type="button" onClick={() => playQueue(aiSongs, 0)}>
              Play all
            </button>
          </div>
          <div className="vx-track-list">
            {aiSongs.map((song, i) => (
              <SongRow key={song.id} song={song} songs={aiSongs} index={i} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
  // Community top searches (aggregated + cached) — chips under the bar.
  const trendingQ = useQuery<{ queries: string[] }>({
    queryKey: ['trending-searches'],
    staleTime: 10 * 60_000,
    queryFn: async ({ signal }) => {
      const base = isNativePlatform() ? 'https://www.sirimillavinay.online' : '';
      // Decorative chips: never worth a hung request — 6 s, and gone on unmount.
      const r = await fetchWithTimeout(`${base}/api/trending-searches`, 6000, signal);
      const j = r.ok ? ((await r.json()) as { queries?: string[] }) : null;
      return { queries: Array.isArray(j?.queries) ? j.queries : [] };
    },
  });

  const trendingNow = useTrendingNow();
  const recRef = useRef<SttSession | null>(null);
  const suggPointer = useRef<{ x: number; y: number } | null>(null);

  // Make sure the speech-recognition mic is released if we leave the page mid
  // listen — an open mic forces Bluetooth into the low-quality call profile.
  useEffect(() => () => recRef.current?.abort(), []);

  // The last route value we deliberately mirrored into the box — so a route
  // change WE caused (a commit below) never echoes back onto the input.
  const lastRouteApplied = useRef<string | null>(routeQuery ?? null);

  // MANUAL commit: Enter, or tapping a suggestion/chip, performs
  // the search (updates the URL for deep-linking + records a recent). We do NOT
  // auto-navigate on partial typing, so the route can never feed back and
  // overwrite the box mid-keystroke — the root cause of the "input won't accept
  // more typing / snaps back" bug. Live results below still update on debounce.
  const commitSearch = useCallback(
    (raw: string) => {
      const cq = normalizeQuery(raw);
      if (cq.length < 1) return;
      lastRouteApplied.current = cq; // our own commit — don't mirror it back in
      setCommitQ(cq);
      if (cq !== routeQuery) navigate(`/search/${encodeURIComponent(cq)}`, { replace: true });
      if (cq.length >= 2) addRecent(cq);
    },
    [navigate, routeQuery, addRecent],
  );

  // Tapping a suggestion fills the box AND runs the search (explicit commit).
  const applySuggestion = useCallback(
    (value: string) => {
      setInput(value);
      commitSearch(value);
    },
    [commitSearch],
  );

  // Recents also record a query you simply rest on (no Enter needed) — but only
  // after a real pause, never on every keystroke.
  useEffect(() => {
    if (q.trim().length < 3) return undefined;
    const t = window.setTimeout(() => addRecent(q.trim()), 2500);
    return () => window.clearTimeout(t);
  }, [q, addRecent]);

  // Sync the box from the URL ONLY on a real external route change (deep link,
  // back/forward, a tapped chip) and ONLY while the box is not focused. While
  // the listener is typing the input is theirs alone — the route never writes
  // back into it. This is the definitive fix for the input hijack/snap-back.
  useEffect(() => {
    if (shouldSyncRouteToInput(routeQuery, lastRouteApplied.current, focusedRef.current)) {
      lastRouteApplied.current = routeQuery ?? null;
      setInput(routeQuery ?? '');
      setCommitQ(routeQuery ? normalizeQuery(routeQuery) : null);
    }
  }, [routeQuery]);

  const all = useSearchAll(q, !lyricsMode);
  const infiniteSongs = useInfiniteSongs(q, tab === 'Songs' && !lyricsMode, { search: true });
  const albums = useInfiniteAlbums(q, tab === 'Albums' && !lyricsMode); // paged — was capped at 20 (P2-29)
  const artists = useInfiniteArtists(q, tab === 'Artists' && !lyricsMode); // paged — was capped at 20 (P2-30)
  const playlists = useInfinitePlaylists(q, tab === 'Playlists' && !lyricsMode);

  const active = q.length > 1;
  const naturalQuery = useMemo(() => looksLikeNaturalLanguage(q), [q]);
  // v5.17.0 — lyric-line search: the lyrics service finds the candidates and
  // the catalogue resolves each one to a playable song.
  const lyricsQ = useLyricsSearch(q, lyricsMode && active);
  const lyricMatches = lyricsQ.data;
  const lyricSongs = useMemo(() => (lyricMatches ?? []).map((m) => m.song), [lyricMatches]);
  const suggestLyrics = active && !lyricsMode && looksLikeLyric(q) && lyricHintDismissed !== q;
  // One memoized ranking pass per settled result set (was recomputed twice
  // per render — P2-19), in search mode: junk filter off, relevance on.
  const allSongs = all.data?.songs;
  const allPlaceholder = all.isPlaceholderData;
  // v5.19.0 — then the literal-match tiers (exact title → starts-with → all
  // words) with a nudge for pinned languages, on top of the taste pass.
  const rankedAllSongs = useMemo(
    () =>
      allSongs
        ? rerankSongs(rankSongs(allSongs, { query: q, searchMode: true }), q, pinnedLangs)
        : [],
    [allSongs, q, pinnedLangs],
  );
  // v5.19.0 — a settled full search seeds the quick-results cache, so
  // re-typing (or returning to) this query previews instantly, no request.
  useEffect(() => {
    if (allSongs && !allPlaceholder && q.length >= 2)
      putCachedQuick(q, rankedAllSongs.slice(0, QUICK_LIMIT));
  }, [allSongs, allPlaceholder, q, rankedAllSongs]);

  // Search analytics: one event per settled query, with its result count.
  const lastTracked = useRef('');
  useEffect(() => {
    if (q.length < 2 || !all.data || allPlaceholder || lastTracked.current === q) return;
    lastTracked.current = q;
    const count = all.data.songs.length;
    void import('@/services/analytics/telemetry').then((mm) => mm.trackSearch(q, count));
  }, [q, all.data, allPlaceholder]);
  const topResult = rankedAllSongs[0];
  const songPages = infiniteSongs.data?.pages;
  const allSongList = useMemo(() => flattenSongPages(songPages), [songPages]);
  const availableLangs = [
    ...new Set(
      allSongList.map((s) => s.language).filter((l): l is string => !!l && l !== 'unknown'),
    ),
  ];
  const songList = langFilter ? allSongList.filter((s) => s.language === langFilter) : allSongList;
  // v5.17.0 — the Songs tab shows the language-filtered list, in the chosen
  // sort order, narrowed by the local "filter these results" text.
  const displaySongs = useMemo(
    () =>
      refineSongs(
        filterSongsLocally(sortSongs(songList, songSort), resultFilter),
        filters,
        favoriteIds,
        heardIds,
      ),
    [songList, songSort, resultFilter, filters, favoriteIds, heardIds],
  );
  const allAlbums = flattenAlbumPages(albums.data?.pages);
  const albumLangs = [
    ...new Set(allAlbums.map((a) => a.language).filter((l): l is string => !!l && l !== 'unknown')),
  ];
  const albumList = albumLang ? allAlbums.filter((a) => a.language === albumLang) : allAlbums;
  const artistList = flattenArtistPages(artists.data?.pages);
  const playlistList = flattenPlaylistPages(playlists.data?.pages);
  const trimmed = input.trim();
  // v5.17.0 — pinned recents first (in pin order), then the rest as recorded.
  const recentOrdered = useMemo(
    () => [
      ...pinned.filter((p) => recent.includes(p)),
      ...recent.filter((r) => !pinned.includes(r)),
    ],
    [recent, pinned],
  );
  const recentMatches = useMemo(
    () =>
      trimmed
        ? recent
            .filter((r) => r.toLowerCase().includes(trimmed.toLowerCase()) && r !== q)
            .slice(0, 3)
        : [],
    [trimmed, recent, q],
  );
  // Only from SETTLED results for the text in the box: placeholder data and
  // the debounce gap both mean `rankedAllSongs` belongs to another query.
  const titleSuggest = useMemo(
    () =>
      suggestTitles(rankedAllSongs, trimmed, {
        resultsQuery: q,
        typedQuery: typedNow,
        placeholder: allPlaceholder,
      }),
    [rankedAllSongs, trimmed, q, typedNow, allPlaceholder],
  );
  const showSuggest =
    focused && trimmed.length >= 1 && (recentMatches.length > 0 || titleSuggest.length > 0);
  // Keyboard-first autocomplete (P2-30): ↑/↓ walk the combined list, Enter
  // picks the highlighted entry (or commits the typed text), Esc dismisses.
  const suggList = useMemo(
    () => [...recentMatches, ...titleSuggest],
    [recentMatches, titleSuggest],
  );
  const [suggSel, setSuggSel] = useState(-1);
  useEffect(() => setSuggSel(-1), [trimmed, focused]);

  // v5.19.0 — search-as-you-type preview: six playable songs under the
  // suggestions, 250 ms after the (normalised) text settles, previous request
  // aborted, URL untouched. Off in lyrics mode and while the box is blurred.
  const quick = useQuickResults(focused && !lyricsMode ? typedNow : '');
  const quickSongs = useMemo(
    () =>
      rerankSongs(
        rankSongs(quick.songs, { query: quick.key, searchMode: true }),
        quick.key,
        pinnedLangs,
      ),
    [quick.songs, quick.key, pinnedLangs],
  );
  const showQuick =
    focused && !lyricsMode && typedNow.length >= 2 && (quickSongs.length > 0 || quick.loading);
  const showPanel = showSuggest || showQuick;

  // v5.19.0 — "Did you mean …?" once a committed query settles with no songs:
  // nearest of trending queries + recents + a small built-in name list.
  const trendingQueries = trendingQ.data?.queries;
  const noSongsSettled = !!all.data && !allPlaceholder && rankedAllSongs.length === 0;
  const dym = useMemo(() => {
    if (!noSongsSettled || q.length < 2) return null;
    return didYouMean(q, candidatePool(q, [trendingQueries ?? [], recent, COMMON_NAMES]));
  }, [noSongsSettled, q, trendingQueries, recent]);
  const dymBar = dym ? (
    <p role="status" className="search-dym">
      Did you mean{' '}
      <button type="button" onClick={() => applySuggestion(dym)}>
        {dym}
      </button>
      ?
    </p>
  ) : null;

  const startVoice = () => {
    if (!voiceReady) return;
    if (recRef.current) {
      // Toggle off: stop listening and hand the mic back immediately.
      recRef.current.abort();
      recRef.current = null;
      setListening(false);
      return;
    }
    const session = createSttSession(
      // The device language, on purpose: recognition in a pinned Indic language
      // returns native-script text, and the catalogue matches romanized titles
      // far better than native script.
      { lang: navigator.language },
      {
        onInterim: (t) => {
          if (t) setInput(t);
        },
        onEnd: (finalText, fatal) => {
          if (recRef.current !== session) return;
          recRef.current = null;
          setListening(false);
          // A session that ends with nothing to search says so — the mic
          // button used to just go quiet.
          if (fatal === 'denied') {
            toast('Microphone access is blocked — allow it in settings to search by voice');
            return;
          }
          if (fatal === 'error') {
            toast('Voice search is not available right now — try again, or type your search');
            return;
          }
          if (!finalText.trim()) {
            toast('Didn’t catch that — tap the mic and try again');
            return;
          }
          // Commit, don't just fill the box — voice queries now reach the
          // URL and recents like typed ones (audit P2-20).
          applySuggestion(finalText);
        },
      },
    );
    if (!session) return;
    recRef.current = session;
    setListening(true);
  };

  const openPreset = (preset: SearchPreset) => {
    useSearchWorkspaceStore.getState().setFilters(preset.filters);
    setSongSort(preset.sort);
    restoredLanguage.current = normalizeQuery(preset.query) !== q ? preset.language : null;
    setLangFilter(preset.language);
    setTab('Songs');
    setLyricsMode(false);
    applySuggestion(preset.query);
  };

  const lyricsChip = (
    <Chip active={lyricsMode} onClick={() => setLyricsMode((v) => !v)}>
      <span aria-hidden className="mr-1">
        ♪
      </span>
      Search by lyrics
    </Chip>
  );

  const showAllTab = (t: Tab, title: string) => (
    <button type="button" className="vx-section-link" onClick={() => setTab(t)} aria-label={`Show all ${title.toLowerCase()}`}>
      Show all
    </button>
  );

  return (
    <div className={cn('search-experience vx-browse mx-auto', active && 'is-searching')}>
      <PageHeader title="Search" />
      <div className="search-sticky">
        <div className={cn('vx-field search-field', listening && 'is-listening')}>
          <SearchIcon />
          <input
            ref={searchInputRef}
            value={input}
            maxLength={120}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (showSuggest && e.key === 'ArrowDown') {
                e.preventDefault();
                setSuggSel((v) => (v + 1) % suggList.length);
              } else if (showSuggest && e.key === 'ArrowUp') {
                e.preventDefault();
                setSuggSel((v) => (v <= 0 ? suggList.length - 1 : v - 1));
              } else if (e.key === 'Escape' && showPanel) {
                setFocused(false);
              } else if (e.key === 'Enter') {
                e.preventDefault();
                const picked = suggSel >= 0 ? suggList[suggSel] : null;
                if (picked) applySuggestion(picked);
                else commitSearch(input);
              }
            }}
            aria-label="Search music"
            role="combobox"
            aria-expanded={showPanel}
            aria-controls="search-suggest"
            aria-activedescendant={suggSel >= 0 ? `sugg-${suggSel}` : undefined}
            onFocus={() => {
              focusedRef.current = true;
              setFocused(true);
            }}
            onBlur={() => {
              focusedRef.current = false;
              window.setTimeout(() => setFocused(false), 120);
            }}
            data-tour="search-input"
            placeholder={
              listening
                ? 'Listening…'
                : lyricsMode
                  ? 'Type a line you remember…'
                  : 'Songs, albums, artists, playlists…'
            }
          />
          <div className="vx-field-actions">
            {input && (
              <button
                type="button"
                aria-label="Clear"
                onClick={() => {
                  setInput('');
                  setCommitQ(null);
                  lastRouteApplied.current = null;
                  navigate('/search', { replace: true });
                }}
                className="search-field-btn"
              >
                <XIcon />
              </button>
            )}
            {voiceReady && (
              <button
                type="button"
                aria-label={listening ? 'Listening…' : 'Voice search'}
                onClick={startVoice}
                className={cn('search-field-btn', listening && 'is-live')}
              >
                {listening && <span className="absolute inset-0 rounded-full bg-ember-500/20" aria-hidden />}
                <svg
                  viewBox="0 0 24 24"
                  fill={listening ? 'currentColor' : 'none'}
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  className="relative"
                  aria-hidden
                >
                  <rect x="9" y="2" width="6" height="12" rx="3" />
                  <path d="M5 10a7 7 0 0014 0M12 17v5" />
                </svg>
              </button>
            )}
          </div>
          {showPanel && (
            <div className="search-panel">
              <div
                id="search-suggest"
                role="listbox"
                aria-label="Search suggestions"
                hidden={!showSuggest}
              >
                {suggList.map((text, i) => {
                  const isRecent = i < recentMatches.length;
                  const Icon = isRecent ? ClockIcon : SearchIcon;
                  return (
                    <button
                      key={`${isRecent ? 'r' : 't'}-${text}`}
                      id={`sugg-${i}`}
                      role="option"
                      aria-selected={suggSel === i}
                      onClick={(e) => {
                        if (e.detail === 0) applySuggestion(text);
                      }}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        suggPointer.current = { x: e.clientX, y: e.clientY };
                      }}
                      onPointerUp={(e) => {
                        const p = suggPointer.current;
                        suggPointer.current = null;
                        if (p && Math.abs(e.clientX - p.x) < 12 && Math.abs(e.clientY - p.y) < 12)
                          applySuggestion(text);
                      }}
                      className={cn(
                        'w-full min-h-[44px] flex items-center gap-3 px-4 py-2 text-left hover:bg-ink-800',
                        suggSel === i && 'bg-ink-800',
                      )}
                    >
                      <Icon className="w-4 h-4 text-ink-400 shrink-0" />
                      <span className="text-[15px] truncate">
                        <Highlight text={text} term={trimmed} />
                      </span>
                    </button>
                  );
                })}
              </div>
              {showQuick && (
                <section
                  aria-label="Quick results"
                  aria-busy={quick.loading}
                  className={cn(showSuggest && 'mt-1 pt-1 border-t border-[var(--vx-border)]')}
                >
                  <p className="search-panel-label">Quick results</p>
                  {quickSongs.length === 0 && quick.loading && <ListSkeleton rows={3} />}
                  {quickSongs.map((song, i) => (
                    <QuickRow
                      key={song.id}
                      song={song}
                      dim={quick.stale}
                      onPlay={() => {
                        playQueue(quickSongs, i);
                        recordSearchPlay(song);
                      }}
                    />
                  ))}
                </section>
              )}
            </div>
          )}
        </div>
        {(active || lyricsMode || !trimmed) && (
          <div className="search-filters">
            {!lyricsMode &&
              TABS.map((t) => (
                <Chip
                  key={t}
                  active={tab === t}
                  onClick={() => {
                    setTab(t);
                    setFocused(false);
                    searchInputRef.current?.blur();
                  }}
                >
                  {t}
                </Chip>
              ))}
            {!lyricsMode && <span aria-hidden className="search-filters-sep" />}
            {lyricsChip}
          </div>
        )}
        {suggestLyrics && (
          <div role="status" className="search-hint">
            <span>That reads like a lyric line.</span>
            <button
              type="button"
              onClick={() => setLyricsMode(true)}
              className="font-bold text-ink-100 underline underline-offset-2"
            >
              Search by lyrics
            </button>
            <IconButton size="sm" label="Dismiss" onClick={() => setLyricHintDismissed(q)}>
              <XIcon className="w-3.5 h-3.5" />
            </IconButton>
          </div>
        )}
      </div>

      {!active && (
        <div className="search-discovery">
          {recent.length > 0 && (
            <section className="search-block" aria-label="Recent searches">
              <div className="search-section-heading">
                <h2>Recent searches</h2>
                <button
                  type="button"
                  onClick={() => {
                    clearRecent();
                    if (pinned.length) toast('Cleared — pinned searches kept');
                  }}
                >
                  Clear all
                </button>
              </div>
              <ul className="search-recent-list">
                {recentOrdered.map((r) => {
                  const isPinned = pinned.includes(r);
                  return (
                    <RecentRow
                      key={r}
                      query={r}
                      pinned={isPinned}
                      onOpen={() => applySuggestion(r)}
                      onTogglePin={(viaLongPress) => {
                        togglePin(r);
                        if (viaLongPress) toast(isPinned ? 'Unpinned' : 'Pinned to the front');
                      }}
                      onRemove={() => removeRecent(r)}
                    />
                  );
                })}
              </ul>
              {pinned.length === 0 && recent.length > 1 && (
                <p className="search-recent-tip">Long-press (or hover) a search to pin it.</p>
              )}
            </section>
          )}

          <div className="search-block empty:hidden">
            <SavedSearches onOpen={openPreset} />
          </div>

          {!!trendingQ.data?.queries.length && (
            <section className="search-block search-trending-queries" aria-label="Trending searches">
              <div className="search-section-heading">
                <h2>Trending searches</h2>
              </div>
              <ol>
                {trendingQ.data.queries.slice(0, 8).map((term, i) => (
                  <li key={term}>
                    <button type="button" onClick={() => applySuggestion(term)}>
                      <span>{i + 1}</span>
                      <span>{term}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <section className="search-block search-browse" aria-label="Browse a vibe">
            <div className="search-section-heading">
              <h2>Moods and moments</h2>
              <Link to="/moods">Show all</Link>
            </div>
            <div className="search-vibe-grid">
              {[
                {
                  title: 'After hours',
                  detail: 'Slow down. Tune in.',
                  query: 'late night chill melodies',
                  art: 'night',
                  glyph: '☾',
                  tone: 8,
                },
                {
                  title: 'The golden years',
                  detail: 'Forever on repeat.',
                  query: `${pinnedLangs[0] || 'Telugu'} 90s hits`,
                  art: 'gold',
                  glyph: '◎',
                  tone: 11,
                },
                {
                  title: 'Full volume',
                  detail: 'Find your second wind.',
                  query: 'workout energetic hits',
                  art: 'energy',
                  glyph: '↗',
                  tone: 7,
                },
                {
                  title: 'Heart on sleeve',
                  detail: 'For all the feelings.',
                  query: `${pinnedLangs[0] || 'Telugu'} love melodies`,
                  art: 'love',
                  glyph: '♡',
                  tone: 3,
                },
              ].map((v) => (
                <button
                  key={v.art}
                  type="button"
                  className={`search-vibe search-vibe-${v.art} vx-browse-tile vx-tone-${v.tone}`}
                  onClick={() => applySuggestion(v.query)}
                >
                  <span className="vx-browse-tile-title">{v.title}</span>
                  <span className="vx-browse-tile-meta">{v.detail}</span>
                  <span className="vx-browse-tile-art is-glyph" aria-hidden="true">
                    {v.glyph}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="search-block" aria-label="Browse all">
            <div className="search-section-heading">
              <h2>Browse all</h2>
            </div>
            <DestinationGrid area="discover" />
          </section>

          {!trimmed && (
            <section className="search-block" aria-label="Search tips">
              <div className="search-section-heading">
                <h2>Try searching</h2>
              </div>
              <div className="vx-chip-row">
                {exampleQueries(pinnedLangs).map((ex) => (
                  <Chip key={ex} onClick={() => applySuggestion(ex)}>
                    {ex}
                  </Chip>
                ))}
              </div>
            </section>
          )}

          {(() => {
            // Package D4 — cold-box suggestions straight from the on-device
            // taste profile: one tap searches an artist you actually play.
            const mine = topArtists(loadProfile(), 8)
              .map((a) => a.affinity.name)
              .filter(Boolean);
            return mine.length >= 2 ? (
              <section className="search-block" aria-label="From your artists">
                <div className="search-section-heading">
                  <h2>From your artists</h2>
                </div>
                <div className="vx-chip-row">
                  {mine.map((name) => (
                    <Chip key={name} onClick={() => applySuggestion(name)}>
                      {name}
                    </Chip>
                  ))}
                </div>
              </section>
            ) : null;
          })()}

          <section className="search-block" aria-label="In the mood for">
            <div className="search-section-heading">
              <h2>In the mood for</h2>
            </div>
            <div className="vx-chip-row">
              {MOODS.map((m) => (
                <Chip key={m.id} onClick={() => setInput(m.query)}>
                  <span aria-hidden className="mr-1">
                    {m.emoji}
                  </span>
                  {m.label}
                </Chip>
              ))}
            </div>
          </section>

          <section className="search-block" aria-label="Trending now">
            <div className="search-section-heading">
              <h2>Trending now</h2>
              {(trendingNow.data?.length ?? 0) > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    if (trendingNow.data) playQueue(trendingNow.data, 0);
                  }}
                >
                  Play all
                </button>
              )}
            </div>
            {trendingNow.isLoading && <ListSkeleton />}
            <div className="vx-track-list max-w-[960px]">
              {(trendingNow.data ?? []).slice(0, 6).map((song, i) => (
                <SongRow key={song.id} song={song} songs={trendingNow.data ?? []} index={i} />
              ))}
            </div>
          </section>

          <section className={cn('search-assist', aiOpen && 'is-open')} aria-label="Ask for songs">
            <div>
              <button
                type="button"
                onClick={() => setAiOpen((v) => !v)}
                aria-expanded={aiOpen}
                className="search-assist-row"
              >
                <span className="search-assist-icon is-accent">
                  <SparkleIcon />
                </span>
                <span className="min-w-0">
                  <span className="search-assist-title">Ask AI for songs</span>
                  <span className="search-assist-meta">Describe a mood, an era or a memory</span>
                </span>
              </button>
              {aiOpen && (
                <div className="search-assist-panel">
                  <div className="flex gap-2">
                    <input
                      value={aiPrompt}
                      maxLength={200}
                      onChange={(e) => setAiPrompt(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void askExpert(aiPrompt);
                      }}
                      placeholder="e.g. rainy-evening Telugu melodies"
                      aria-label="Describe the songs you want"
                      className="flex-1 min-w-0"
                    />
                    <button
                      type="button"
                      onClick={() => void askExpert(aiPrompt)}
                      disabled={aiLoading || !aiPrompt.trim()}
                      className="px-5 min-h-[44px] rounded-full btn-primary text-sm font-bold disabled:opacity-50 shrink-0"
                    >
                      {aiLoading ? 'Asking…' : 'Ask'}
                    </button>
                  </div>
                  {expertPanel}
                </div>
              )}
            </div>
            <Link to="/VinaXAI" className="search-assist-row">
              <span className="search-assist-icon">
                <SparkleIcon />
              </span>
              <span className="min-w-0">
                <span className="search-assist-title">Chat with VinaX AI</span>
                <span className="search-assist-meta">Find songs, talk music, ask anything</span>
              </span>
            </Link>
          </section>
        </div>
      )}

      {active && lyricsMode && (
        <div className="search-results">
          {lyricsQ.isLoading && <ListSkeleton />}
          {lyricsQ.isError && <ErrorState retry={() => lyricsQ.refetch()} />}
          {!lyricsQ.isLoading && !lyricsQ.isError && !lyricMatches && (
            <p className="vx-meta-line">Type a line you remember — a few words in a row work best.</p>
          )}
          {lyricMatches && lyricMatches.length === 0 && (
            <EmptyState
              icon={<SearchIcon className="w-8 h-8" />}
              title="No song has those words — try a longer line."
              message="The lyrics service matches whole phrases best — a full line beats a couple of words."
              action={
                <button
                  type="button"
                  onClick={() => setLyricsMode(false)}
                  className="px-5 py-2.5 rounded-full btn-primary"
                >
                  Search titles instead
                </button>
              }
            />
          )}
          {lyricMatches && lyricMatches.length > 0 && (
            <section>
              <div className="search-section-heading">
                <h2>Songs with those words</h2>
                <button type="button" onClick={() => playQueue(lyricSongs, 0)}>
                  Play all
                </button>
              </div>
              {lyricMatches.every((m) => m.source === 'catalogue') && (
                <p className="vx-meta-line mb-2">
                  The lyrics service had no match — these titles begin with those words.
                </p>
              )}
              <div className="vx-track-list">
                {lyricMatches.map((m, i) => (
                  <div key={m.song.id}>
                    <SongRow song={m.song} songs={lyricSongs} index={i} />
                    {m.source === 'catalogue' && (
                      <p className="search-lyric-note">
                        <span className="search-lyric-badge">Matched by title</span>
                      </p>
                    )}
                    {m.source === 'lyrics' && m.hit.snippet && (
                      <p className="search-lyric-note">
                        {splitHighlight(m.hit.snippet, q).map((run, j) =>
                          run.hit ? <mark key={j}>{run.text}</mark> : <span key={j}>{run.text}</span>,
                        )}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {active && !lyricsMode && (
        <div className="search-results">
          {tab === 'All' && (
            <>
              {all.isLoading && <ListSkeleton />}
              {all.isError && <ErrorState retry={() => all.refetch()} />}
              {dymBar}
              {allPlaceholder && (
                <div aria-hidden className="skeleton h-1 w-full rounded-full mb-4" />
              )}
              {all.data && (
                <div
                  aria-busy={allPlaceholder}
                  className={cn('transition-opacity', allPlaceholder && 'opacity-40')}
                >
                  {naturalQuery && !allPlaceholder && (
                    <Suspense fallback={null}>
                      <SemanticMatches key={q} query={q} results={all.data} />
                    </Suspense>
                  )}
                  {(topResult || rankedAllSongs.length > 1) && (
                    <div className="search-results-lead">
                      {topResult && (
                        <section aria-label="Top result">
                          <div className="search-section-heading">
                            <h2>Top result</h2>
                          </div>
                          {/* The whole card plays (the round button is its keyboard target); it is a song, so it feeds the song context menu too. */}
                          <div
                            className="search-top-result"
                            data-song-id={topResult.id}
                            data-deter-context
                            onClick={(e) => {
                              if ((e.target as HTMLElement).closest('button')) return;
                              playQueue(rankedAllSongs, 0);
                              recordSearchPlay(topResult);
                            }}
                          >
                            <img
                              src={bestImage(topResult.images, 300)}
                              onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)}
                              alt=""
                            />
                            <div>
                              <p className="search-top-result-name">{topResult.title}</p>
                              <p className="search-top-result-meta">
                                <span className="search-type-pill">Song</span>
                                <span>{topResult.subtitle}</span>
                              </p>
                            </div>
                            <div className="search-top-result-menu">
                              <TrackMenu song={topResult} />
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                playQueue(rankedAllSongs, 0);
                                recordSearchPlay(topResult);
                              }}
                              aria-label={`Play ${topResult.title} by ${topResult.subtitle}`}
                              className="vx-play-fab"
                            >
                              <PlayIcon />
                            </button>
                          </div>
                        </section>
                      )}
                      {rankedAllSongs.length > 1 && (
                        <section aria-label="Songs" className="min-w-0">
                          <div className="search-section-heading">
                            <h2>Songs</h2>
                            <button type="button" onClick={() => setTab('Songs')} aria-label="Show all songs">
                              Show all
                            </button>
                          </div>
                          <div className="search-top-songs">
                            {rankedAllSongs.slice(1, 5).map((song, i) => (
                              <SearchPlay key={song.id} song={song}>
                                <SongRow song={song} songs={rankedAllSongs} index={i + 1} />
                              </SearchPlay>
                            ))}
                          </div>
                        </section>
                      )}
                    </div>
                  )}
                  {all.data.artists.length > 0 && (
                    <Shelf title="Artists" action={showAllTab('Artists', 'Artists')}>
                      {all.data.artists.map((a) => (
                        <MediaCard
                          key={a.id}
                          to={artistPath(a)}
                          image={
                            bestImage(a.images) === FALLBACK_ART
                              ? letterAvatar(a.name)
                              : bestImage(a.images)
                          }
                          images={a.images}
                          title={a.name}
                          subtitle="Artist"
                          round
                          onPlay={() => void playArtist(a.id, a.name)}
                        />
                      ))}
                    </Shelf>
                  )}
                  {all.data.albums.length > 0 && (
                    <Shelf title="Albums" action={showAllTab('Albums', 'Albums')}>
                      {all.data.albums.map((a) => (
                        <MediaCard
                          key={a.id}
                          to={albumPath(a)}
                          image={bestImage(a.images)}
                          images={a.images}
                          title={a.title}
                          subtitle={a.subtitle}
                          onPlay={() => void playAlbum(a.id, a.title)}
                        />
                      ))}
                    </Shelf>
                  )}
                  {all.data.playlists.length > 0 && (
                    <Shelf title="Playlists" action={showAllTab('Playlists', 'Playlists')}>
                      {all.data.playlists.map((p) => (
                        <MediaCard
                          key={p.id}
                          to={playlistPath(p)}
                          image={bestImage(p.images)}
                          images={p.images}
                          title={p.title}
                          subtitle={p.subtitle}
                          onPlay={() => void playPlaylist(p.id, p.title)}
                        />
                      ))}
                    </Shelf>
                  )}
                  {rankedAllSongs.length === 0 &&
                    all.data.albums.length === 0 &&
                    all.data.artists.length === 0 &&
                    all.data.playlists.length === 0 &&
                    naturalQuery && (
                      <div className="mt-2">
                        <p className="vx-meta-line mb-3">No titles use those exact words.</p>
                        <button
                          type="button"
                          onClick={() => void askExpert(q)}
                          disabled={aiLoading}
                          className="px-5 py-2.5 rounded-full btn-primary disabled:opacity-50"
                        >
                          {aiLoading ? '✨ Asking the expert…' : '✨ Ask AI instead'}
                        </button>
                        {expertPanel}
                      </div>
                    )}
                  {rankedAllSongs.length === 0 &&
                    all.data.albums.length === 0 &&
                    all.data.artists.length === 0 &&
                    all.data.playlists.length === 0 &&
                    !naturalQuery && (
                      <>
                        <EmptyState
                          icon={<SearchIcon className="w-8 h-8" />}
                          title="No results"
                          message={`Nothing matched “${q}”. Try a shorter or transliterated spelling — or ask the AI.`}
                          action={
                            <button
                              type="button"
                              onClick={() => void askExpert(q)}
                              disabled={aiLoading}
                              className="px-5 py-2.5 rounded-full btn-primary disabled:opacity-50"
                            >
                              {aiLoading ? '✨ Asking the expert…' : '✨ Ask AI instead'}
                            </button>
                          }
                        />
                        {expertPanel}
                      </>
                    )}
                </div>
              )}
            </>
          )}

          {tab === 'Songs' && (
            <div
              className={compactResults ? 'search-song-results is-compact' : 'search-song-results'}
            >
              <SearchWorkspace
                query={q}
                songs={displaySongs}
                total={allSongList.length}
                language={langFilter}
              />
              {availableLangs.length > 1 && (
                <div className="vx-chip-rail" role="group" aria-label="Language">
                  <Chip active={!langFilter} onClick={() => setLangFilter(null)}>
                    All languages
                  </Chip>
                  {availableLangs.map((l) => (
                    <Chip key={l} active={langFilter === l} onClick={() => setLangFilter(l)}>
                      {languageLabel(l)}
                    </Chip>
                  ))}
                </div>
              )}
              {allSongList.length > 0 && (
                <div className="search-songs-tools">
                  <label>
                    <span className="max-md:sr-only">Sort</span>
                    <select
                      value={songSort}
                      onChange={(e) => {
                        if (isSongSort(e.target.value)) setSongSort(e.target.value);
                      }}
                      aria-label="Sort results"
                    >
                      {SONG_SORTS.map((s) => (
                        <option key={s} value={s}>
                          {SONG_SORT_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <span className="flex-1" />
                  {displaySongs.length > 0 && (
                    <>
                      <button type="button" onClick={() => playQueue(displaySongs, 0)} className="vx-pill-btn">
                        <PlayIcon /> Play all
                      </button>
                      <button type="button" onClick={() => enqueueAll(displaySongs)} className="vx-pill-btn">
                        Queue all
                      </button>
                    </>
                  )}
                </div>
              )}
              {allSongList.length > 0 && (
                <div className="vx-field search-local-filter">
                  <SearchIcon />
                  <input
                    value={resultFilter}
                    maxLength={80}
                    onChange={(e) => setResultFilter(e.target.value)}
                    aria-label="Filter these results"
                    placeholder="Filter these results"
                  />
                  {resultFilter && (
                    <div className="vx-field-actions">
                      <IconButton size="sm" label="Clear filter" onClick={() => setResultFilter('')}>
                        <XIcon className="w-3.5 h-3.5" />
                      </IconButton>
                    </div>
                  )}
                </div>
              )}
              {infiniteSongs.isLoading && <ListSkeleton />}
              {infiniteSongs.isError && <ErrorState retry={() => infiniteSongs.refetch()} />}
              {infiniteSongs.data &&
                !infiniteSongs.isFetching &&
                allSongList.length === 0 &&
                dymBar}
              {resultFilter.trim() && displaySongs.length === 0 && songList.length > 0 && (
                <p className="vx-meta-line px-2 mb-3">
                  Nothing loaded so far matches “{resultFilter.trim()}” — scroll to load more, or
                  clear the filter.
                </p>
              )}
              {!infiniteSongs.isLoading && !infiniteSongs.isError && displaySongs.length === 0 && (
                <div className="search-no-matches" role="status">
                  <h3>No matching songs yet</h3>
                  <p>
                    {allSongList.length
                      ? 'Try clearing a refinement, switching languages, or loading more songs.'
                      : 'Try another title, artist, or spelling.'}
                  </p>
                </div>
              )}
              <div className="vx-track-list">
                {displaySongs.map((song, i) => (
                  <SearchPlay key={song.id} song={song}>
                    <SongRow song={song} songs={displaySongs} index={i} />
                  </SearchPlay>
                ))}
              </div>
              <InfiniteSentinel
                onVisible={() =>
                  infiniteSongs.hasNextPage &&
                  !infiniteSongs.isFetchingNextPage &&
                  infiniteSongs.fetchNextPage()
                }
                disabled={!infiniteSongs.hasNextPage}
                loading={infiniteSongs.isFetchingNextPage}
              />
              {infiniteSongs.hasNextPage && (
                <button
                  type="button"
                  className="search-load-more"
                  disabled={infiniteSongs.isFetchingNextPage}
                  onClick={() => void infiniteSongs.fetchNextPage()}
                >
                  Load more songs
                </button>
              )}
            </div>
          )}
          {tab === 'Albums' && (
            <>
              {albumLangs.length > 1 && (
                <div className="vx-chip-rail" role="group" aria-label="Language">
                  <Chip active={!albumLang} onClick={() => setAlbumLang(null)}>
                    All languages
                  </Chip>
                  {albumLangs.map((l) => (
                    <Chip key={l} active={albumLang === l} onClick={() => setAlbumLang(l)}>
                      {languageLabel(l)}
                    </Chip>
                  ))}
                </div>
              )}
              <GridTabState result={albums} count={albumList.length} noun="albums" />
              <div className="vx-card-grid">
                {albumList.map((a) => (
                  <MediaCard
                    key={a.id}
                    to={albumPath(a)}
                    image={bestImage(a.images)}
                    images={a.images}
                    title={a.title}
                    subtitle={a.subtitle}
                    fluid
                    onPlay={() => void playAlbum(a.id, a.title)}
                  />
                ))}
              </div>
              <InfiniteSentinel
                onVisible={() => void albums.fetchNextPage()}
                disabled={!albums.hasNextPage || albums.isFetchingNextPage}
                loading={albums.isFetchingNextPage}
              />
            </>
          )}
          {tab === 'Artists' && (
            <>
              <GridTabState result={artists} count={artistList.length} noun="artists" />
              <div className="vx-card-grid">
                {artistList.map((a) => (
                  <MediaCard
                    key={a.id}
                    to={artistPath(a)}
                    image={
                      bestImage(a.images) === FALLBACK_ART
                        ? letterAvatar(a.name)
                        : bestImage(a.images)
                    }
                    images={a.images}
                    title={a.name}
                    subtitle="Artist"
                    round
                    fluid
                    onPlay={() => void playArtist(a.id, a.name)}
                  />
                ))}
              </div>
              <InfiniteSentinel
                onVisible={() => void artists.fetchNextPage()}
                disabled={!artists.hasNextPage || artists.isFetchingNextPage}
                loading={artists.isFetchingNextPage}
              />
            </>
          )}
          {tab === 'Playlists' && (
            <>
              <GridTabState result={playlists} count={playlistList.length} noun="playlists" />
              <div className="vx-card-grid">
                {playlistList.map((p) => (
                  <MediaCard
                    key={p.id}
                    to={playlistPath(p)}
                    image={bestImage(p.images)}
                    images={p.images}
                    title={p.title}
                    subtitle={p.subtitle}
                    fluid
                    onPlay={() => void playPlaylist(p.id, p.title)}
                  />
                ))}
              </div>
              <InfiniteSentinel
                onVisible={() => void playlists.fetchNextPage()}
                disabled={!playlists.hasNextPage || playlists.isFetchingNextPage}
                loading={playlists.isFetchingNextPage}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
