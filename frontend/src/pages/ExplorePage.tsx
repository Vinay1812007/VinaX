import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import { Chip } from '@/components/Chip';
import { MOODS, moodSeed } from '@/constants/seeds';
import { HUB_LANGUAGES, languageLabel } from '@/constants/languages';
import { MOOD_HUBS } from '@/constants/hubs';
import { useSettingsStore } from '@/store/settingsStore';
import { usePlayerStore } from '@/store/playerStore';
import { useHistoryStore } from '@/store/historyStore';
import { useLibraryStore } from '@/store/libraryStore';
import { searchSongs } from '@/services/api';
import { toast } from '@/store/toastStore';
import { cn } from '@/utils/cn';
import { loadProfile } from '@/services/personalization/storage';
import { topLanguages } from '@/services/personalization/profile';
import {
  CompassIcon,
  VideoIcon,
  PlayIcon,
  FilmIcon,
  GlobeIcon,
  HeartIcon,
  MusicIcon,
  SparkleIcon,
  WaveIcon,
} from '@/components/Icons';

const tiles: Array<{ to: string; label: string; hint: string; icon: typeof CompassIcon }> = [
  { to: '/discover', label: 'Discover', hint: 'Fresh picks & playlists', icon: CompassIcon },
  { to: '/charts', label: 'Charts', hint: 'Top songs by language', icon: WaveIcon },
  { to: '/videos', label: 'Videos', hint: 'Watch music videos', icon: VideoIcon },
  { to: '/movies', label: 'Movies', hint: 'Film soundtracks', icon: FilmIcon },
  { to: '/moods', label: 'Moods', hint: 'Music for every vibe', icon: SparkleIcon },
  { to: '/languages', label: 'Languages', hint: 'Pin what you listen to', icon: MusicIcon },
  { to: '/regions', label: 'Regions', hint: 'Tuned to your region', icon: GlobeIcon },
  { to: '/made-for-you', label: 'Made For You', hint: 'Your personal mixes', icon: HeartIcon },
  { to: '/quiz', label: 'Music Quiz', hint: 'Guess the song, beat your streak', icon: PlayIcon },
];

/** Package D3 — the mood × language matrix. Pick a language, tap a mood cell,
 *  land on real playable results for that exact combination. Languages come
 *  from what the listener actually plays (profile) plus their pinned set. */
function MoodLanguageGrid() {
  const pinned = useSettingsStore((s) => s.pinnedLanguages);
  const [langs] = useState<string[]>(() => {
    const fromProfile = topLanguages(loadProfile(), 4).map((l) => l.id);
    const merged = [...new Set([...pinned, ...fromProfile])].slice(0, 4);
    return merged.length ? merged : ['hindi', 'english'];
  });
  const [lang, setLang] = useState(langs[0]);
  return (
    <section className="mt-8">
      <h2 className="text-lg font-extrabold tracking-tight mb-1">Any mood, your language</h2>
      <p className="text-xs text-ink-400 mb-3">Pick a language, tap a mood — instant results.</p>
      <div className="flex gap-2 overflow-x-auto no-scrollbar mb-3">
        {langs.map((l) => (
          <Chip key={l} active={lang === l} onClick={() => setLang(l)}>
            {languageLabel(l)}
          </Chip>
        ))}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {MOODS.map((m) => (
          <Link
            key={m.id}
            to={`/search/${encodeURIComponent(moodSeed(m.id, lang))}`}
            className="glass-card glass-hover rounded-xl px-3 py-3 flex items-center gap-2.5 active:scale-[0.97] transition-transform"
          >
            <span aria-hidden className="text-lg">{m.emoji}</span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold truncate">{m.label}</span>
              <span className="block text-[10px] text-ink-500 truncate">{languageLabel(lang)}</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

/** v5.17.0 — primary language for generated searches: first pinned, else Telugu. */
function usePrimaryLanguage(): string {
  const pinned = useSettingsStore((s) => s.pinnedLanguages);
  return pinned[0] ?? 'telugu';
}

const DECADES = [
  { id: '60s', query: '60s' },
  { id: '70s', query: '70s' },
  { id: '80s', query: '80s' },
  { id: '90s', query: '90s' },
  { id: '2000s', query: '2000s' },
  { id: '2010s', query: '2010s' },
  { id: '2020s', query: '2020s' },
] as const;

/** v5.17.0 — Decade radio: one tap searches "<decade> <language> hits" and plays. */
function DecadeRadio() {
  const lang = usePrimaryLanguage();
  const playQueue = usePlayerStore((s) => s.playQueue);
  const [busy, setBusy] = useState<string | null>(null);
  const start = async (decade: string): Promise<void> => {
    if (busy) return;
    setBusy(decade);
    try {
      const songs = await searchSongs(`${decade} ${lang} hits`, 30);
      if (!songs.length) {
        toast(`No ${decade} ${languageLabel(lang)} hits found — try another decade`);
        return;
      }
      playQueue(songs, 0);
      toast(`Decade radio · ${decade} ${languageLabel(lang)}`);
    } catch {
      toast('Could not start that radio — check your connection');
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="mt-8" aria-label="Decade radio">
      <h2 className="text-lg font-extrabold tracking-tight mb-1">Decade radio</h2>
      <p className="text-xs text-ink-400 mb-3">Tap a decade — {languageLabel(lang)} hits from that era start playing.</p>
      <div className="flex gap-2 overflow-x-auto no-scrollbar">
        {DECADES.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => void start(d.query)}
            aria-pressed={busy === d.query}
            aria-busy={busy === d.query}
            disabled={busy !== null && busy !== d.query}
            className={cn(
              'px-3.5 py-1.5 rounded-full text-sm font-semibold border whitespace-nowrap transition-[color,background-color,border-color,opacity,transform] active:scale-95 disabled:opacity-50',
              busy === d.query ? 'bg-ink-100 border-ink-100 text-ink-950' : 'bg-ink-800 border-transparent text-ink-100 hover:bg-ink-700',
            )}
          >
            {busy === d.query ? `${d.id} · loading…` : d.id}
          </button>
        ))}
      </div>
    </section>
  );
}

/** v5.17.0 — Pick a year: "<year> <language> songs", then play. */
function YearPicker() {
  const lang = usePrimaryLanguage();
  const playQueue = usePlayerStore((s) => s.playQueue);
  const thisYear = new Date().getFullYear();
  const years = useMemo(() => {
    const out: number[] = [];
    for (let y = thisYear; y >= 1970; y--) out.push(y);
    return out;
  }, [thisYear]);
  const [year, setYear] = useState(thisYear);
  const [busy, setBusy] = useState(false);
  const play = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const songs = await searchSongs(`${year} ${lang} songs`, 30);
      if (!songs.length) {
        toast(`Nothing found for ${year} — try a nearby year`);
        return;
      }
      playQueue(songs, 0);
      toast(`Playing ${year} · ${languageLabel(lang)}`);
    } catch {
      toast('Could not load that year — check your connection');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="mt-8" aria-label="Pick a year">
      <h2 className="text-lg font-extrabold tracking-tight mb-1">Pick a year</h2>
      <p className="text-xs text-ink-400 mb-3">Relive one year of {languageLabel(lang)} music.</p>
      <div className="flex items-center gap-2">
        <label className="sr-only" htmlFor="explore-year">Year</label>
        <select
          id="explore-year"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="h-10 rounded-full bg-ink-800 border border-transparent focus:border-ink-600 px-4 text-sm font-semibold text-ink-100 outline-none"
        >
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void play()}
          disabled={busy}
          aria-busy={busy}
          className="flex items-center gap-1.5 px-4 h-10 rounded-full btn-primary text-sm font-bold active:scale-95 transition-transform disabled:opacity-60"
        >
          <PlayIcon className="w-3.5 h-3.5" /> {busy ? 'Loading…' : `Play ${year}`}
        </button>
      </div>
    </section>
  );
}

/** v5.17.0 — Language × mood hub grid: only routes that exist (HUB_LANGUAGES × MOOD_HUBS), pinned languages first. */
function HubGrid() {
  const pinned = useSettingsStore((s) => s.pinnedLanguages);
  const [showAll, setShowAll] = useState(false);
  const langs = useMemo(() => {
    const hub = HUB_LANGUAGES as readonly string[];
    const first = pinned.filter((l) => hub.includes(l));
    return [...first, ...hub.filter((l) => !first.includes(l))];
  }, [pinned]);
  const tiles = useMemo(
    () => langs.flatMap((l) => MOOD_HUBS.map((m) => ({ to: `/${l}-${m.slug}-songs`, lang: l, mood: m }))),
    [langs],
  );
  const shown = showAll ? tiles : tiles.slice(0, 12);
  return (
    <section className="mt-8" aria-label="Language and mood hubs">
      <h2 className="text-lg font-extrabold tracking-tight mb-1">Language × mood</h2>
      <p className="text-xs text-ink-400 mb-3">Curated hub pages — your pinned languages come first.</p>
      <div className="grid grid-cols-3 gap-2">
        {shown.map((t) => (
          <Link
            key={t.to}
            to={t.to}
            className="glass-card glass-hover rounded-xl px-3 py-2.5 min-w-0 active:scale-[0.97] transition-transform"
          >
            <span className="block text-[13px] font-semibold truncate">{languageLabel(t.lang)}</span>
            <span className="block text-[11px] text-ink-400 truncate">{t.mood.label}</span>
          </Link>
        ))}
      </div>
      {tiles.length > 12 && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          aria-expanded={showAll}
          className="mt-3 text-xs font-semibold text-ember-400 hover:text-ember-300"
        >
          {showAll ? 'Show fewer' : `Show all ${tiles.length} combinations`}
        </button>
      )}
    </section>
  );
}

/** v5.17.0 — Surprise album: a random album from your history and favourites. */
function SurpriseAlbumButton() {
  const navigate = useNavigate();
  const entries = useHistoryStore((s) => s.entries);
  const favorites = useLibraryStore((s) => s.favorites);
  const albumIds = useMemo(() => {
    const ids = new Set<string>();
    for (const s of favorites) if (s.album?.id) ids.add(s.album.id);
    for (const e of entries) if (e.song?.album?.id) ids.add(e.song.album.id);
    return [...ids];
  }, [entries, favorites]);
  const surprise = (): void => {
    if (!albumIds.length) {
      toast('Play or like a few songs first — then we can surprise you');
      return;
    }
    const id = albumIds[Math.floor(Math.random() * albumIds.length)];
    navigate(`/album/${encodeURIComponent(id)}`);
  };
  return (
    <button
      type="button"
      onClick={surprise}
      className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full btn-premium text-sm font-bold active:scale-95 transition-transform"
      aria-label="Open a surprise album from your listening"
    >
      <SparkleIcon className="w-4 h-4" /> Surprise album
    </button>
  );
}

export default function ExplorePage() {
  usePageTitle('Explore');
  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-display tracking-tight mb-1">Explore</h1>
          <p className="text-sm text-ink-400">Everything VinaX has to offer, in one place.</p>
        </div>
        <div className="shrink-0 pt-1">
          <SurpriseAlbumButton />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {tiles.map(({ to, label, hint, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="glass-card glass-hover rounded-2xl p-4 flex flex-col gap-3 active:scale-[0.98] transition-transform"
          >
            <span className="w-11 h-11 rounded-xl bg-ember-500/15 text-ember-400 flex items-center justify-center">
              <Icon className="w-6 h-6" />
            </span>
            <span>
              <span className="block font-semibold">{label}</span>
              <span className="block text-xs text-ink-400">{hint}</span>
            </span>
          </Link>
        ))}
      </div>
      <DecadeRadio />
      <YearPicker />
      <MoodLanguageGrid />
      <HubGrid />
    </div>
  );
}
