import { isNativePlatform } from '@/services/native';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { albumPath, artistPath, playlistPath } from '@/utils/slug';
import { Link, useNavigate, useNavigationType, useParams } from 'react-router-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { SongRow } from '@/components/SongRow';
import { MediaCard } from '@/components/MediaCard';
import { Chip } from '@/components/Chip';
import { ListSkeleton } from '@/components/Skeletons';
import { EmptyState, ErrorState } from '@/components/States';
import { InfiniteSentinel } from '@/components/InfiniteSentinel';
import { ClockIcon, PlayIcon, SearchIcon, SparkleIcon, XIcon } from '@/components/Icons';
import {
  normalizeQuery,
  rankSongs,
  useSearchAll,
} from '@/features/search/useSearch';
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
import { createSttSession, probeSttSupport, sttSupported, type SttSession } from '@/features/voice/stt';
import { isSongSort, SONG_SORTS, useSearchStore } from '@/store/searchStore';
import { usePlayerStore } from '@/store/playerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { toast } from '@/store/toastStore';
import { loadProfile } from '@/services/personalization/storage';
import { topArtists } from '@/services/personalization/profile';
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
import { exampleQueries, SEARCH_TIP_LINE } from '@/features/search/searchTips';
import { rerankSongs } from '@/features/search/rerank';
import { candidatePool, COMMON_NAMES, didYouMean } from '@/features/search/didYouMean';
import { useQuickResults } from '@/features/search/useQuickResults';
import { putCachedQuick, QUICK_LIMIT } from '@/features/search/quickResults';

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
      <span className="text-ember-400 font-bold">{text.slice(i, i + term.length)}</span>
      {text.slice(i + term.length)}
    </>
  );
}

/** v5.17.0 — a small push-pin, used on pinned recents. */
function PinGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M9 3h6l-1 6.5 3 2.5v2H7v-2l3-2.5L9 3z" />
      <path d="M12 14v7" />
    </svg>
  );
}

/** v5.17.0 — one recent-search chip: tap opens it, long-press (or the pin
 *  button) pins it to the front, × forgets it.
 *  v5.19.0 — decluttered: the chip shows only its text (plus a small pin
 *  glyph when pinned). Pin/× fade in on hover or keyboard focus; on touch
 *  screens only a single small × stays visible and long-press does the pinning. */
function RecentChip({
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
    <span className="group inline-flex items-center">
      <span
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
      >
        <Chip
          onClick={() => {
            if (longPressed.current) {
              longPressed.current = false;
              return;
            }
            onOpen();
          }}
        >
          {pinned && <PinGlyph className="w-3 h-3 mr-1 inline-block -mt-0.5 text-ember-400" />}
          {query}
        </Chip>
      </span>
      <span className="relative flex items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">
        <button
          aria-label={pinned ? `Unpin ${query}` : `Pin ${query}`}
          aria-pressed={pinned}
          onClick={() => onTogglePin(false)}
          className={cn('p-1 rounded-full hover:bg-ink-700/70 [@media(hover:none)]:hidden', pinned ? 'text-ember-400' : 'text-ink-500 hover:text-ink-200')}
        >
          <PinGlyph className="w-3.5 h-3.5" />
        </button>
        <button aria-label={`Remove ${query}`} onClick={onRemove} className="p-1 rounded-full text-ink-500 hover:text-ink-200 hover:bg-ink-700/70">
          <XIcon className="w-3 h-3" />
        </button>
      </span>
    </span>
  );
}

/** v5.19.0 — one compact, playable "Quick results" row under the suggestions. */
function QuickRow({ song, onPlay, dim }: { song: Song; onPlay: () => void; dim: boolean }) {
  const pointer = useRef<{ x: number; y: number } | null>(null);
  return (
    <button
      type="button"
      onPointerDown={(e) => {
        e.preventDefault(); // keep the box focused so the panel stays open
        pointer.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={(e) => {
        const p = pointer.current;
        pointer.current = null;
        if (p && Math.abs(e.clientX - p.x) < 12 && Math.abs(e.clientY - p.y) < 12) onPlay();
      }}
      className={cn('w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-ink-800/60 transition-opacity', dim && 'opacity-50')}
    >
      <img src={bestImage(song.images, 150)} onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)} alt="" className="w-9 h-9 rounded-md object-cover shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm truncate">{song.title}</span>
        <span className="block text-xs text-ink-400 truncate">{song.subtitle}</span>
      </span>
      <PlayIcon className="w-4 h-4 text-ink-400 shrink-0" />
    </button>
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
  const [commitQ, setCommitQ] = useState<string | null>(() => (routeQuery ? normalizeQuery(routeQuery) : null));
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
    if (res.reason === 'not_configured') setAiError('AI features are not enabled on this server yet.');
    else if (res.reason === 'empty') setAiError('The music expert came up empty — try rephrasing.');
    else setAiError('Something went wrong. Please try again.');
  };

  // A new search query starts a fresh round with the expert — and clears any
  // language filters chosen for the previous query, so a filtered tab never
  // silently shows nothing (delta audit P1-12). The local result filter
  // (v5.17.0) resets for the same reason.
  useEffect(() => {
    setAiSongs(null);
    setAiError(null);
    setLangFilter(null);
    setAlbumLang(null);
    setResultFilter('');
  }, [q]);

  const expertPanel = (aiLoading || aiError || (aiSongs?.length ?? 0) > 0) && (
    <div className="mt-4">
      {aiLoading && <ListSkeleton />}
      {!aiLoading && aiError && <p className="text-sm text-ink-400">{aiError}</p>}
      {!aiLoading && aiSongs && aiSongs.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-ink-300">Expert picks</p>
            <button
              onClick={() => playQueue(aiSongs, 0)}
              className="text-xs font-semibold text-ember-400 hover:text-ember-300"
            >
              Play all
            </button>
          </div>
          {aiSongs.map((song, i) => (
            <SongRow key={song.id} song={song} songs={aiSongs} index={i} />
          ))}
        </section>
      )}
    </div>
  );
  // Community top searches (aggregated + cached) — chips under the bar.
  const trendingQ = useQuery<{ queries: string[] }>({
    queryKey: ['trending-searches'],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const base = isNativePlatform() ? 'https://www.sirimillavinay.online' : '';
      const r = await fetch(`${base}/api/trending-searches`);
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

  const all = useSearchAll(q);
  const infiniteSongs = useInfiniteSongs(q, tab === 'Songs' && !lyricsMode, { search: true });
  const albums = useInfiniteAlbums(q, tab === 'Albums' && !lyricsMode); // paged — was capped at 20 (P2-29)
  const artists = useInfiniteArtists(q, tab === 'Artists' && !lyricsMode); // paged — was capped at 20 (P2-30)
  const playlists = useInfinitePlaylists(q, tab === 'Playlists' && !lyricsMode);

  const active = q.length > 1;
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
    () => (allSongs ? rerankSongs(rankSongs(allSongs, { query: q, searchMode: true }), q, pinnedLangs) : []),
    [allSongs, q, pinnedLangs],
  );
  // v5.19.0 — a settled full search seeds the quick-results cache, so
  // re-typing (or returning to) this query previews instantly, no request.
  useEffect(() => {
    if (allSongs && !allPlaceholder && q.length >= 2) putCachedQuick(q, rankedAllSongs.slice(0, QUICK_LIMIT));
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
  const availableLangs = [...new Set(allSongList.map((s) => s.language).filter((l): l is string => !!l && l !== 'unknown'))];
  const songList = langFilter ? allSongList.filter((s) => s.language === langFilter) : allSongList;
  // v5.17.0 — the Songs tab shows the language-filtered list, in the chosen
  // sort order, narrowed by the local "filter these results" text.
  const displaySongs = useMemo(
    () => filterSongsLocally(sortSongs(songList, songSort), resultFilter),
    [songList, songSort, resultFilter],
  );
  const allAlbums = flattenAlbumPages(albums.data?.pages);
  const albumLangs = [...new Set(allAlbums.map((a) => a.language).filter((l): l is string => !!l && l !== 'unknown'))];
  const albumList = albumLang ? allAlbums.filter((a) => a.language === albumLang) : allAlbums;
  const trimmed = input.trim();
  // v5.17.0 — pinned recents first (in pin order), then the rest as recorded.
  const recentOrdered = useMemo(
    () => [...pinned.filter((p) => recent.includes(p)), ...recent.filter((r) => !pinned.includes(r))],
    [recent, pinned],
  );
  const recentMatches = useMemo(
    () => (trimmed ? recent.filter((r) => r.toLowerCase().includes(trimmed.toLowerCase()) && r !== q).slice(0, 3) : []),
    [trimmed, recent, q],
  );
  const titleSuggest = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const s of rankedAllSongs) {
      const t = s.title.trim();
      const key = t.toLowerCase();
      if (t && key !== trimmed.toLowerCase() && !seen.has(key)) {
        seen.add(key);
        out.push(t);
      }
      if (out.length >= 7) break;
    }
    return out;
  }, [rankedAllSongs, trimmed]);
  const showSuggest = focused && trimmed.length >= 1 && (recentMatches.length > 0 || titleSuggest.length > 0);
  // Keyboard-first autocomplete (P2-30): ↑/↓ walk the combined list, Enter
  // picks the highlighted entry (or commits the typed text), Esc dismisses.
  const suggList = useMemo(() => [...recentMatches, ...titleSuggest], [recentMatches, titleSuggest]);
  const [suggSel, setSuggSel] = useState(-1);
  useEffect(() => setSuggSel(-1), [trimmed, focused]);

  // v5.19.0 — search-as-you-type preview: six playable songs under the
  // suggestions, 250 ms after the (normalised) text settles, previous request
  // aborted, URL untouched. Off in lyrics mode and while the box is blurred.
  const quick = useQuickResults(focused && !lyricsMode ? typedNow : '');
  const quickSongs = useMemo(() => rerankSongs(quick.songs, quick.key, pinnedLangs), [quick.songs, quick.key, pinnedLangs]);
  const showQuick = focused && !lyricsMode && typedNow.length >= 2 && (quickSongs.length > 0 || quick.loading);
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
    <p role="status" className="mb-4 text-sm text-ink-300">
      Did you mean{' '}
      <button onClick={() => applySuggestion(dym)} className="font-bold text-ember-400 hover:text-ember-300">
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
      { lang: navigator.language || 'en-IN' },
      {
        onInterim: (t) => {
          if (t) setInput(t);
        },
        onEnd: (finalText) => {
          if (recRef.current !== session) return;
          recRef.current = null;
          setListening(false);
          // Commit, don't just fill the box — voice queries now reach the
          // URL and recents like typed ones (audit P2-20).
          if (finalText) applySuggestion(finalText);
        },
      },
    );
    if (!session) return;
    recRef.current = session;
    setListening(true);
  };

  const lyricsChip = (
    <Chip active={lyricsMode} onClick={() => setLyricsMode((v) => !v)}>
      <span aria-hidden className="mr-1">♪</span>
      Search by lyrics
    </Chip>
  );

  return (
    <div className="max-w-3xl mx-auto">
      <div className="sticky top-0 z-20 -mx-4 px-4 pt-1 pb-3 bg-ink-900/95 backdrop-blur-md md:-mx-8 md:px-8">
      <h1 className="text-display tracking-tight mb-4">Search</h1>
      {!input && (trendingQ.data?.queries?.length ?? 0) > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="text-[11px] font-bold uppercase tracking-widest text-ink-400">Top searches</span>
          {trendingQ.data?.queries.map((q) => (
            <button
              key={q}
              onClick={() => applySuggestion(q)}
              className="px-3 py-1.5 rounded-full text-xs font-semibold bg-ink-800/70 text-ink-200 border border-glass hover:bg-ink-700 hover:text-ink-100 transition"
            >
              {q}
            </button>
          ))}
        </div>
      )}
      <div className="relative">
        <SearchIcon className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-ink-400" />
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
          placeholder={listening ? 'Listening…' : lyricsMode ? 'Type a line you remember…' : 'Songs, albums, artists, playlists…'}
          className={`w-full glass-search rounded-2xl pl-12 pr-20 py-3.5 text-sm outline-none transition-[color,background-color,border-color,opacity,transform] focus:ring-2 focus:ring-ember-500/35 focus:shadow-[0_0_34px_-8px_rgb(var(--ember-500)/0.5)] ${listening ? 'border-ember-500 ring-2 ring-ember-500/40' : ''}`}
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
          {input && (
            <button aria-label="Clear" onClick={() => setInput('')} className="p-2.5 text-ink-400 hover:text-ink-100 rounded-full hover:bg-ink-700/70">
              <XIcon className="w-4 h-4" />
            </button>
          )}
          {voiceReady && (
            <button
              aria-label={listening ? 'Listening…' : 'Voice search'}
              onClick={startVoice}
              className={`relative p-2.5 rounded-full hover:bg-ink-700/70 ${listening ? 'text-ember-400' : 'text-ink-400 hover:text-ink-100'}`}
            >
              {listening && (
                <>
                  <span className="absolute inset-0 rounded-full bg-ember-500/30 animate-ping" />
                  <span className="absolute inset-[-6px] rounded-full border border-ember-500/40 animate-pulse" />
                </>
              )}
              <svg viewBox="0 0 24 24" fill={listening ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="relative w-4 h-4">
                <rect x="9" y="2" width="6" height="12" rx="3" />
                <path d="M5 10a7 7 0 0014 0M12 17v5" />
              </svg>
            </button>
          )}
        </div>
        {showPanel && (
          <div className="absolute left-0 right-0 top-full mt-2 z-30 bg-ink-850 border border-ink-700/70 shadow-float rounded-2xl py-2 max-h-[28rem] overflow-y-auto">
          <div id="search-suggest" role="listbox" aria-label="Search suggestions" hidden={!showSuggest}>
            {suggList.map((text, i) => {
              const isRecent = i < recentMatches.length;
              const Icon = isRecent ? ClockIcon : SearchIcon;
              return (
                <button
                  key={`${isRecent ? 'r' : 't'}-${text}`}
                  id={`sugg-${i}`}
                  role="option"
                  aria-selected={suggSel === i}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    suggPointer.current = { x: e.clientX, y: e.clientY };
                  }}
                  onPointerUp={(e) => {
                    const p = suggPointer.current;
                    suggPointer.current = null;
                    if (p && Math.abs(e.clientX - p.x) < 12 && Math.abs(e.clientY - p.y) < 12) applySuggestion(text);
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-ink-800/60 ${suggSel === i ? 'bg-ink-800/80' : ''}`}
                >
                  <Icon className="w-4 h-4 text-ink-400 shrink-0" />
                  <span className="text-sm truncate">
                    <Highlight text={text} term={trimmed} />
                  </span>
                </button>
              );
            })}
          </div>
          {showQuick && (
            <section aria-label="Quick results" aria-busy={quick.loading} className={cn(showSuggest && 'mt-1 pt-1 border-t border-ink-700/60')}>
              <p className="px-4 pt-1 pb-1 text-[11px] font-bold uppercase tracking-widest text-ink-400">Quick results</p>
              {quickSongs.length === 0 && quick.loading && <ListSkeleton rows={3} />}
              {quickSongs.map((song, i) => (
                <QuickRow key={song.id} song={song} dim={quick.stale} onPlay={() => playQueue(quickSongs, i)} />
              ))}
            </section>
          )}
          </div>
        )}
      </div>
      {(active || lyricsMode) && (
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar mt-3">
          {lyricsChip}
          {!lyricsMode && <span aria-hidden className="w-px h-5 bg-ink-700 shrink-0" />}
          {!lyricsMode && TABS.map((t) => (
            <Chip key={t} active={tab === t} onClick={() => setTab(t)}>{t}</Chip>
          ))}
        </div>
      )}
      {suggestLyrics && (
        <div role="status" className="mt-2 flex items-center gap-2 text-xs text-ink-300">
          <span>That reads like a lyric line.</span>
          <button onClick={() => setLyricsMode(true)} className="font-semibold text-ember-400 hover:text-ember-300">
            Search by lyrics →
          </button>
          <button aria-label="Dismiss" onClick={() => setLyricHintDismissed(q)} className="p-1 rounded-full text-ink-500 hover:text-ink-200 hover:bg-ink-700/70">
            <XIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      </div>

      {!active && (
        <div>
          {!trimmed && (
            <section className="mb-6" aria-label="Search tips">
              <p className="text-xs text-ink-400 mb-2">{SEARCH_TIP_LINE}</p>
              <div className="flex flex-wrap gap-2">
                {exampleQueries(pinnedLangs).map((ex) => (
                  <Chip key={ex} onClick={() => applySuggestion(ex)}>{ex}</Chip>
                ))}
              </div>
            </section>
          )}
          {recent.length > 0 ? (
            <>
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold text-ink-300">Recent searches</p>
                <button
                  onClick={() => {
                    clearRecent();
                    if (pinned.length) toast('Cleared — pinned searches kept');
                  }}
                  className="text-xs text-ink-400 hover:text-ink-100"
                >
                  Clear all
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {recentOrdered.map((r) => {
                  const isPinned = pinned.includes(r);
                  return (
                    <RecentChip
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
              </div>
              {pinned.length === 0 && recent.length > 1 && (
                <p className="mt-2 text-[11px] text-ink-500">Long-press (or hover) a search to pin it.</p>
              )}
            </>
          ) : (
            <EmptyState icon={<SearchIcon className="w-8 h-8" />} title="Find your next favorite" message="Search across songs, albums, artists, and playlists. Results rank toward your languages — scroll for unlimited results." />
          )}

          <div className="mt-7 rounded-2xl glass-card px-4 py-3.5">
            <button
              onClick={() => setAiOpen((v) => !v)}
              className="w-full flex items-center gap-3 text-left"
            >
              <span className="w-9 h-9 rounded-xl bg-ember-500 text-black flex items-center justify-center shrink-0">
                <SparkleIcon className="w-5 h-5" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-bold">Ask AI for songs</span>
                <span className="block text-xs text-ink-400 truncate">Describe a mood, an era, a memory — a music expert answers</span>
              </span>
            </button>
            {aiOpen && (
              <div className="mt-3">
                <div className="flex gap-2">
                  <input
                    value={aiPrompt}
                    maxLength={200}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void askExpert(aiPrompt);
                    }}
                    placeholder="e.g. rainy-evening Telugu melodies"
                    className="glass-input flex-1 min-w-0 px-3 py-2 rounded-xl text-sm outline-none"
                  />
                  <button
                    onClick={() => void askExpert(aiPrompt)}
                    disabled={aiLoading || !aiPrompt.trim()}
                    className="px-4 py-2 rounded-full btn-primary text-sm font-semibold disabled:opacity-50 shrink-0"
                  >
                    {aiLoading ? 'Asking…' : 'Ask'}
                  </button>
                </div>
                {expertPanel}
              </div>
            )}
          </div>

          <Link
            to="/VinaXAI"
            className="mt-3 w-full flex items-center gap-3 rounded-2xl glass-card px-4 py-3.5 hover:bg-ink-800/40 transition-colors text-left"
          >
            <span className="w-9 h-9 rounded-xl bg-ink-800 text-ember-300 flex items-center justify-center shrink-0">
              <SparkleIcon className="w-5 h-5" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-bold">Chat with VinaX AI</span>
              <span className="block text-xs text-ink-400 truncate">Find songs, talk music, ask anything — full chat with web search</span>
            </span>
          </Link>

          {(() => {
            // Package D4 — cold-box suggestions straight from the on-device
            // taste profile: one tap searches an artist you actually play.
            const mine = topArtists(loadProfile(), 8).map((a) => a.affinity.name).filter(Boolean);
            return mine.length >= 2 ? (
              <section className="mt-7">
                <p className="text-sm font-semibold text-ink-300 mb-3">From your artists</p>
                <div className="flex flex-wrap gap-2">
                  {mine.map((name) => (
                    <Chip key={name} onClick={() => applySuggestion(name)}>
                      {name}
                    </Chip>
                  ))}
                </div>
              </section>
            ) : null;
          })()}

          <section className="mt-7">
            <p className="text-sm font-semibold text-ink-300 mb-3">In the mood for</p>
            <div className="flex flex-wrap gap-2">
              {MOODS.map((m) => (
                <Chip key={m.id} onClick={() => setInput(m.query)}>
                  <span aria-hidden className="mr-1">{m.emoji}</span>
                  {m.label}
                </Chip>
              ))}
            </div>
          </section>

          <section className="mt-7">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-ink-300">Trending now</p>
              {(trendingNow.data?.length ?? 0) > 0 && (
                <button
                  onClick={() => {
                    if (trendingNow.data) playQueue(trendingNow.data, 0);
                  }}
                  className="text-xs font-semibold text-ember-400 hover:text-ember-300"
                >
                  Play all
                </button>
              )}
            </div>
            {trendingNow.isLoading && <ListSkeleton />}
            {(trendingNow.data ?? []).slice(0, 6).map((song, i) => (
              <SongRow key={song.id} song={song} songs={trendingNow.data ?? []} index={i} />
            ))}
          </section>
        </div>
      )}

      {active && lyricsMode && (
        <div className="pt-4">
          {lyricsQ.isLoading && <ListSkeleton />}
          {lyricsQ.isError && <ErrorState retry={() => lyricsQ.refetch()} />}
          {!lyricsQ.isLoading && !lyricsQ.isError && !lyricMatches && (
            <p className="text-sm text-ink-400">Type a line you remember — a few words in a row work best.</p>
          )}
          {lyricMatches && lyricMatches.length === 0 && (
            <EmptyState
              icon={<SearchIcon className="w-8 h-8" />}
              title="No song has those words — try a longer line."
              message="The lyrics service matches whole phrases best — a full line beats a couple of words."
              action={
                <button onClick={() => setLyricsMode(false)} className="px-5 py-2.5 rounded-full btn-primary">
                  Search titles instead
                </button>
              }
            />
          )}
          {lyricMatches && lyricMatches.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-lg font-bold">Songs with those words</h2>
                <button onClick={() => playQueue(lyricSongs, 0)} className="text-xs font-semibold text-ember-400 hover:text-ember-300">
                  Play all
                </button>
              </div>
              {lyricMatches.every((m) => m.source === 'catalogue') && (
                <p className="mb-2 text-xs text-ink-400">The lyrics service had no match — these titles begin with those words.</p>
              )}
              {lyricMatches.map((m, i) => (
                <div key={m.song.id}>
                  <SongRow song={m.song} songs={lyricSongs} index={i} />
                  {m.source === 'catalogue' && (
                    <p className="pl-[3.75rem] pr-2 -mt-1 mb-2">
                      <span className="inline-block rounded-full border border-ink-700 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-400">Matched by title</span>
                    </p>
                  )}
                  {m.source === 'lyrics' && m.hit.snippet && (
                    <p className="pl-[3.75rem] pr-2 -mt-1 mb-2 text-xs text-ink-400 leading-relaxed">
                      {splitHighlight(m.hit.snippet, q).map((run, j) =>
                        run.hit ? (
                          <mark key={j} className="bg-transparent text-ember-300 font-semibold">{run.text}</mark>
                        ) : (
                          <span key={j}>{run.text}</span>
                        ),
                      )}
                    </p>
                  )}
                </div>
              ))}
            </section>
          )}
        </div>
      )}

      {active && !lyricsMode && (
        <div className="pt-4">
          {tab === 'All' && (
            <>
              {all.isLoading && <ListSkeleton />}
              {all.isError && <ErrorState retry={() => all.refetch()} />}
              {dymBar}
              {allPlaceholder && <div aria-hidden className="skeleton h-1 w-full rounded-full mb-4" />}
              {all.data && (
                <div aria-busy={allPlaceholder} className={cn('space-y-7 transition-opacity', allPlaceholder && 'opacity-40')}>
                  {topResult && (
                    <section>
                      <h2 className="text-lg font-bold mb-2">Top Result</h2>
                      <div className="rounded-2xl border border-ink-700 bg-ink-850/60 p-4 flex items-center gap-4">
                        <img src={bestImage(topResult.images, 300)} onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)} alt="" className="w-20 h-20 rounded-xl object-cover shadow-lg" />
                        <div className="min-w-0 flex-1">
                          <p className="text-lg font-bold truncate">{topResult.title}</p>
                          <p className="text-sm text-ink-300 truncate">{topResult.subtitle}</p>
                        </div>
                        <button
                          onClick={() => playQueue(rankedAllSongs, 0)}
                          aria-label={`Play ${topResult.title}`}
                          className="w-12 h-12 rounded-full btn-primary flex items-center justify-center hover:bg-ember-400 shrink-0"
                        >
                          <PlayIcon className="w-5 h-5 ml-0.5" />
                        </button>
                      </div>
                    </section>
                  )}
                  {rankedAllSongs.length > 1 && (
                    <section>
                      <h2 className="text-lg font-bold mb-2">Songs</h2>
                      {rankedAllSongs.slice(1, 8).map((song, i) => (
                        <SongRow key={song.id} song={song} songs={rankedAllSongs} index={i + 1} />
                      ))}
                      <button onClick={() => setTab('Songs')} className="mt-2 text-xs font-semibold text-ember-400 px-2">
                        See all songs (endless) →
                      </button>
                    </section>
                  )}
                  {all.data.albums.length > 0 && (
                    <section>
                      <h2 className="text-lg font-bold mb-2">Albums</h2>
                      <div className="flex gap-3 overflow-x-auto no-scrollbar">
                        {all.data.albums.map((a) => (
                          <MediaCard key={a.id} to={albumPath(a)} image={bestImage(a.images)} images={a.images} title={a.title} subtitle={a.subtitle} onPlay={() => void playAlbum(a.id, a.title)} />
                        ))}
                      </div>
                    </section>
                  )}
                  {all.data.artists.length > 0 && (
                    <section>
                      <h2 className="text-lg font-bold mb-2">Artists</h2>
                      <div className="flex gap-3 overflow-x-auto no-scrollbar">
                        {all.data.artists.map((a) => (
                          <MediaCard key={a.id} to={artistPath(a)} image={bestImage(a.images) === FALLBACK_ART ? letterAvatar(a.name) : bestImage(a.images)} images={a.images} title={a.name} subtitle="Artist" round onPlay={() => void playArtist(a.id, a.name)} />
                        ))}
                      </div>
                    </section>
                  )}
                  {all.data.playlists.length > 0 && (
                    <section>
                      <h2 className="text-lg font-bold mb-2">Playlists</h2>
                      <div className="flex gap-3 overflow-x-auto no-scrollbar">
                        {all.data.playlists.map((p) => (
                          <MediaCard key={p.id} to={playlistPath(p)} image={bestImage(p.images)} images={p.images} title={p.title} subtitle={p.subtitle} onPlay={() => void playPlaylist(p.id, p.title)} />
                        ))}
                      </div>
                    </section>
                  )}
                  {rankedAllSongs.length === 0 && all.data.albums.length === 0 && all.data.artists.length === 0 && all.data.playlists.length === 0 && (
                    <>
                      <EmptyState
                        icon={<SearchIcon className="w-8 h-8" />}
                        title="No results"
                        message={`Nothing matched “${q}”. Try a shorter or transliterated spelling — or ask the AI.`}
                        action={
                          <button
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
            <>
              {availableLangs.length > 1 && (
                <div className="flex gap-2 overflow-x-auto no-scrollbar mb-4">
                  <Chip active={!langFilter} onClick={() => setLangFilter(null)}>All languages</Chip>
                  {availableLangs.map((l) => (
                    <Chip key={l} active={langFilter === l} onClick={() => setLangFilter(l)}>
                      {languageLabel(l)}
                    </Chip>
                  ))}
                </div>
              )}
              {allSongList.length > 0 && (
                <div className="flex items-center gap-3 mb-3 flex-wrap">
                  <label className="flex items-center gap-1.5 text-xs text-ink-400">
                    Sort
                    <select
                      value={songSort}
                      onChange={(e) => {
                        if (isSongSort(e.target.value)) setSongSort(e.target.value);
                      }}
                      aria-label="Sort results"
                      className="glass-input rounded-lg px-2 py-1 text-xs font-semibold text-ink-100 outline-none focus:ring-2 focus:ring-ember-500/35"
                    >
                      {SONG_SORTS.map((s) => (
                        <option key={s} value={s}>{SONG_SORT_LABELS[s]}</option>
                      ))}
                    </select>
                  </label>
                  <span className="flex-1" />
                  {displaySongs.length > 0 && (
                    <>
                      <button onClick={() => playQueue(displaySongs, 0)} className="text-xs font-semibold text-ember-400 hover:text-ember-300">
                        Play all
                      </button>
                      <button onClick={() => enqueueAll(displaySongs)} className="text-xs font-semibold text-ink-300 hover:text-ink-100">
                        Queue all
                      </button>
                    </>
                  )}
                </div>
              )}
              {allSongList.length >= 20 && (
                <div className="relative mb-3">
                  <input
                    value={resultFilter}
                    maxLength={80}
                    onChange={(e) => setResultFilter(e.target.value)}
                    aria-label="Filter these results"
                    placeholder="Filter these results"
                    className="glass-input w-full rounded-xl px-3 py-2 pr-9 text-sm outline-none focus:ring-2 focus:ring-ember-500/35"
                  />
                  {resultFilter && (
                    <button
                      aria-label="Clear filter"
                      onClick={() => setResultFilter('')}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-full text-ink-400 hover:text-ink-100 hover:bg-ink-700/70"
                    >
                      <XIcon className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}
              {infiniteSongs.isLoading && <ListSkeleton />}
              {infiniteSongs.isError && <ErrorState retry={() => infiniteSongs.refetch()} />}
              {infiniteSongs.data && !infiniteSongs.isFetching && allSongList.length === 0 && dymBar}
              {resultFilter.trim() && displaySongs.length === 0 && songList.length > 0 && (
                <p className="text-sm text-ink-400 px-2">Nothing loaded so far matches “{resultFilter.trim()}” — scroll to load more, or clear the filter.</p>
              )}
              {displaySongs.map((song, i) => (
                <SongRow key={song.id} song={song} songs={displaySongs} index={i} />
              ))}
              <InfiniteSentinel
                onVisible={() => infiniteSongs.hasNextPage && !infiniteSongs.isFetchingNextPage && infiniteSongs.fetchNextPage()}
                disabled={!infiniteSongs.hasNextPage}
                loading={infiniteSongs.isFetchingNextPage}
              />
            </>
          )}
          {tab === 'Albums' && (
            <>
              {albumLangs.length > 1 && (
                <div className="flex gap-2 overflow-x-auto no-scrollbar mb-4">
                  <Chip active={!albumLang} onClick={() => setAlbumLang(null)}>All languages</Chip>
                  {albumLangs.map((l) => (
                    <Chip key={l} active={albumLang === l} onClick={() => setAlbumLang(l)}>
                      {languageLabel(l)}
                    </Chip>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {albumList.map((a) => <MediaCard key={a.id} to={albumPath(a)} image={bestImage(a.images)} images={a.images} title={a.title} subtitle={a.subtitle} fluid onPlay={() => void playAlbum(a.id, a.title)} />)}
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
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {flattenArtistPages(artists.data?.pages).map((a) => <MediaCard key={a.id} to={artistPath(a)} image={bestImage(a.images) === FALLBACK_ART ? letterAvatar(a.name) : bestImage(a.images)} images={a.images} title={a.name} subtitle="Artist" round fluid onPlay={() => void playArtist(a.id, a.name)} />)}
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
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {flattenPlaylistPages(playlists.data?.pages).map((p) => <MediaCard key={p.id} to={playlistPath(p)} image={bestImage(p.images)} images={p.images} title={p.title} subtitle={p.subtitle} fluid onPlay={() => void playPlaylist(p.id, p.title)} />)}
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
