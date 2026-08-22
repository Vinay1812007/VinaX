import { isNativePlatform } from '@/services/native';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { albumPath, artistPath, playlistPath } from '@/utils/slug';
import { Link, useNavigate, useParams } from 'react-router-dom';
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
  useSearchAlbums,
  useSearchAll,
  useSearchArtists,
  useSearchPlaylists,
} from '@/features/search/useSearch';
import { flattenSongPages, useInfiniteSongs } from '@/features/search/useInfiniteSongs';
import { createSttSession, probeSttSupport, sttSupported, type SttSession } from '@/features/voice/stt';
import { useSearchStore } from '@/store/searchStore';
import { usePlayerStore } from '@/store/playerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { expertSongSearch } from '@/services/ai/expert';
import type { Song } from '@/types';
import { playAlbum, playArtist, playPlaylist } from '@/features/player/playEntity';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { letterAvatar } from '@/utils/avatar';
import { languageLabel } from '@/constants/languages';
import { MOODS } from '@/constants/seeds';
import { useTrendingNow } from '@/features/home/useHomeShelves';
import { shouldSyncRouteToInput } from '@/features/search/routeSync';

const TABS = ['All', 'Songs', 'Albums', 'Artists', 'Playlists'] as const;
type Tab = (typeof TABS)[number];

export default function SearchPage() {
  const { query: routeQuery } = useParams();
  const navigate = useNavigate();
  const [input, setInput] = useState(routeQuery ?? '');
  const [tab, setTab] = useState<Tab>('All');
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
  // Live focus for effects: the route→input sync must read the CURRENT focus
  // synchronously (state is one render behind), so it never fights typing.
  const focusedRef = useRef(false);
  const debounced = useDebouncedValue(input, 350);
  const q = normalizeQuery(debounced);
  usePageTitle(q ? `“${q}”` : 'Search');

  const recent = useSearchStore((s) => s.recent);
  const { addRecent, removeRecent, clearRecent } = useSearchStore.getState();
  const playQueue = usePlayerStore((s) => s.playQueue);
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

  // A new search query starts a fresh round with the expert.
  useEffect(() => {
    setAiSongs(null);
    setAiError(null);
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
  const trendingNow = useTrendingNow();
  const recRef = useRef<SttSession | null>(null);
  const suggPointer = useRef<{ x: number; y: number } | null>(null);

  // Make sure the speech-recognition mic is released if we leave the page mid
  // listen — an open mic forces Bluetooth into the low-quality call profile.
  useEffect(() => () => recRef.current?.abort(), []);

  // The last route value we deliberately mirrored into the box — so a route
  // change WE caused (a commit below) never echoes back onto the input.
  const lastRouteApplied = useRef<string | null>(routeQuery ?? null);

  // MANUAL, Spotify-style commit: Enter, or tapping a suggestion/chip, performs
  // the search (updates the URL for deep-linking + records a recent). We do NOT
  // auto-navigate on partial typing, so the route can never feed back and
  // overwrite the box mid-keystroke — the root cause of the "input won't accept
  // more typing / snaps back" bug. Live results below still update on debounce.
  const commitSearch = useCallback(
    (raw: string) => {
      const cq = normalizeQuery(raw);
      if (cq.length < 1) return;
      lastRouteApplied.current = cq; // our own commit — don't mirror it back in
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
    }
  }, [routeQuery]);

  const all = useSearchAll(q);
  const infiniteSongs = useInfiniteSongs(q, tab === 'Songs');
  const albums = useSearchAlbums(q, tab === 'Albums');
  const artists = useSearchArtists(q, tab === 'Artists');
  const playlists = useSearchPlaylists(q, tab === 'Playlists');

  const active = q.length > 1;
  const rankedAllSongs = all.data ? rankSongs(all.data.songs) : [];

  // Search analytics: one event per settled query, with its result count.
  const lastTracked = useRef('');
  useEffect(() => {
    const q = debounced.trim();
    if (q.length < 2 || !all.data || lastTracked.current === q) return;
    lastTracked.current = q;
    const count = all.data.songs.length;
    void import('@/services/analytics/telemetry').then((mm) => mm.trackSearch(q, count));
  }, [debounced, all.data]);
  const topResult = rankedAllSongs[0];
  const allSongList = flattenSongPages(infiniteSongs.data?.pages);
  const availableLangs = [...new Set(allSongList.map((s) => s.language).filter((l): l is string => !!l && l !== 'unknown'))];
  const songList = langFilter ? allSongList.filter((s) => s.language === langFilter) : allSongList;
  const albumLangs = [...new Set((albums.data ?? []).map((a) => a.language).filter((l): l is string => !!l && l !== 'unknown'))];
  const albumList = albumLang ? (albums.data ?? []).filter((a) => a.language === albumLang) : (albums.data ?? []);
  const trimmed = input.trim();
  const recentMatches = trimmed
    ? recent.filter((r) => r.toLowerCase().includes(trimmed.toLowerCase()) && r !== q).slice(0, 3)
    : [];
  const titleSuggest = (() => {
    const ranked = all.data ? rankSongs(all.data.songs) : [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const s of ranked) {
      const t = s.title.trim();
      const key = t.toLowerCase();
      if (t && key !== trimmed.toLowerCase() && !seen.has(key)) {
        seen.add(key);
        out.push(t);
      }
      if (out.length >= 7) break;
    }
    return out;
  })();
  const showSuggest = focused && trimmed.length >= 1 && (recentMatches.length > 0 || titleSuggest.length > 0);

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
          if (finalText) setInput(finalText);
        },
      },
    );
    if (!session) return;
    recRef.current = session;
    setListening(true);
  };

  // Community top searches (aggregated + cached) — chips under the bar.
  const trendingQ = useQuery<{ queries: string[] }>({
    queryKey: ['trending-searches'],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const base = isNativePlatform() ? 'https://www.sirimillavinay.online' : '';
      const r = await fetch(`${base}/api/trending-searches`);
      return r.ok ? ((await r.json()) as { queries: string[] }) : { queries: [] };
    },
  });

  return (
    <div className="max-w-3xl mx-auto">
      <div className="sticky top-0 z-20 -mx-4 px-4 pt-1 pb-3 bg-ink-900/95 backdrop-blur-md md:-mx-8 md:px-8">
      <h1 className="text-display tracking-tight mb-4">Search</h1>
      {!input && (trendingQ.data?.queries.length ?? 0) > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="text-[11px] font-bold uppercase tracking-widest text-ink-400">Top searches</span>
          {trendingQ.data?.queries.map((q) => (
            <button
              key={q}
              onClick={() => setInput(q)}
              className="px-3 py-1.5 rounded-full text-xs font-semibold bg-ink-800/70 text-ink-200 border border-white/5 hover:bg-ink-700 hover:text-ink-100 transition"
            >
              {q}
            </button>
          ))}
        </div>
      )}
      <div className="relative">
        <SearchIcon className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-ink-400" />
        <input
          autoFocus
          value={input}
          maxLength={120}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitSearch(input);
            }
          }}
          onFocus={() => {
            focusedRef.current = true;
            setFocused(true);
          }}
          onBlur={() => {
            focusedRef.current = false;
            window.setTimeout(() => setFocused(false), 120);
          }}
          placeholder={listening ? 'Listening…' : 'Songs, albums, artists, playlists…'}
          className={`w-full glass-search rounded-2xl pl-12 pr-20 py-3.5 text-sm outline-none transition-all focus:ring-2 focus:ring-ember-500/35 focus:shadow-[0_0_34px_-8px_rgb(var(--ember-500)/0.5)] ${listening ? 'border-ember-500 ring-2 ring-ember-500/40' : ''}`}
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
        {showSuggest && (
          <div className="absolute left-0 right-0 top-full mt-2 z-30 bg-ink-850 border border-ink-700/70 shadow-float rounded-2xl py-2 max-h-80 overflow-y-auto">
            {recentMatches.map((r) => (
              <button
                key={`r-${r}`}
                onPointerDown={(e) => {
                  e.preventDefault();
                  suggPointer.current = { x: e.clientX, y: e.clientY };
                }}
                onPointerUp={(e) => {
                  const p = suggPointer.current;
                  suggPointer.current = null;
                  if (p && Math.abs(e.clientX - p.x) < 12 && Math.abs(e.clientY - p.y) < 12) applySuggestion(r);
                }}
                className="w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-ink-800/60"
              >
                <ClockIcon className="w-4 h-4 text-ink-400 shrink-0" />
                <span className="text-sm truncate">{r}</span>
              </button>
            ))}
            {titleSuggest.map((t) => (
              <button
                key={`t-${t}`}
                onPointerDown={(e) => {
                  e.preventDefault();
                  suggPointer.current = { x: e.clientX, y: e.clientY };
                }}
                onPointerUp={(e) => {
                  const p = suggPointer.current;
                  suggPointer.current = null;
                  if (p && Math.abs(e.clientX - p.x) < 12 && Math.abs(e.clientY - p.y) < 12) applySuggestion(t);
                }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-ink-800/60"
              >
                <SearchIcon className="w-4 h-4 text-ink-400 shrink-0" />
                <span className="text-sm truncate">{t}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {active && (
        <div className="flex gap-2 overflow-x-auto no-scrollbar mt-3">
          {TABS.map((t) => (
            <Chip key={t} active={tab === t} onClick={() => setTab(t)}>{t}</Chip>
          ))}
        </div>
      )}
      </div>

      {!active && (
        <div>
          {recent.length > 0 ? (
            <>
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold text-ink-300">Recent searches</p>
                <button onClick={clearRecent} className="text-xs text-ink-400 hover:text-ink-100">Clear all</button>
              </div>
              <div className="flex flex-wrap gap-2">
                {recent.map((r) => (
                  <span key={r} className="inline-flex items-center gap-1">
                    <Chip onClick={() => setInput(r)}>{r}</Chip>
                    <button aria-label={`Remove ${r}`} onClick={() => removeRecent(r)} className="p-1.5 rounded-full text-ink-500 hover:text-ink-200 hover:bg-ink-700/70 -ml-0.5">
                      <XIcon className="w-3.5 h-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            </>
          ) : (
            <EmptyState title="Find your next favorite" message="Search across songs, albums, artists, and playlists. Results rank toward your languages — scroll for unlimited results." />
          )}

          <div className="mt-7 rounded-2xl glass-card px-4 py-3.5">
            <button
              onClick={() => setAiOpen((v) => !v)}
              className="w-full flex items-center gap-3 text-left"
            >
              <span className="w-9 h-9 rounded-xl bg-premium text-white flex items-center justify-center shrink-0">
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

      {active && (
        <div className="pt-4">
          {tab === 'All' && (
            <>
              {all.isLoading && <ListSkeleton />}
              {all.isError && <ErrorState retry={() => all.refetch()} />}
              {all.data && (
                <div className="space-y-7">
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
              {infiniteSongs.isLoading && <ListSkeleton />}
              {infiniteSongs.isError && <ErrorState retry={() => infiniteSongs.refetch()} />}
              {songList.map((song, i) => (
                <SongRow key={song.id} song={song} songs={songList} index={i} />
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
            </>
          )}
          {tab === 'Artists' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {(artists.data ?? []).map((a) => <MediaCard key={a.id} to={artistPath(a)} image={bestImage(a.images) === FALLBACK_ART ? letterAvatar(a.name) : bestImage(a.images)} images={a.images} title={a.name} subtitle="Artist" round fluid onPlay={() => void playArtist(a.id, a.name)} />)}
            </div>
          )}
          {tab === 'Playlists' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {(playlists.data ?? []).map((p) => <MediaCard key={p.id} to={playlistPath(p)} image={bestImage(p.images)} images={p.images} title={p.title} subtitle={p.subtitle} fluid onPlay={() => void playPlaylist(p.id, p.title)} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
