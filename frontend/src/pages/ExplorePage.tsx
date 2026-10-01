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
import { PageHeader } from '@/components/PageHeader';
import { SectionHeader } from '@/components/SectionHeader';
import { BrowseTile, DestTile, TileGlyph } from '@/features/discover/BrowseTile';
import { HUB_TONE } from '@/features/discover/HubMoodTiles';
import { moodTone } from '@/features/discover/tones';
import '@/styles/pages/browse.css';

const tiles: Array<{ to: string; label: string; meta: string; tone: number; icon: typeof CompassIcon }> = [
  { to: '/discover', label: 'Discover', meta: 'Everything to browse', tone: 1, icon: CompassIcon },
  { to: '/charts', label: 'Charts', meta: 'Popular right now', tone: 8, icon: WaveIcon },
  { to: '/videos', label: 'Videos', meta: 'Music videos', tone: 6, icon: VideoIcon },
  { to: '/movies', label: 'Movies', meta: 'Film soundtracks', tone: 5, icon: FilmIcon },
  { to: '/moods', label: 'Moods', meta: 'For how you feel', tone: 3, icon: SparkleIcon },
  { to: '/languages', label: 'Languages', meta: 'In your own script', tone: 2, icon: MusicIcon },
  { to: '/regions', label: 'Regions', meta: 'Local favourites', tone: 4, icon: GlobeIcon },
  { to: '/made-for-you', label: 'Made for you', meta: 'Mixes from your listening', tone: 7, icon: HeartIcon },
  { to: '/quiz', label: 'Music quiz', meta: 'Guess the song', tone: 11, icon: PlayIcon },
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
    <section className="vx-section">
      <SectionHeader title="Any mood, your language" explanation="Pick a language, then a mood" />
      <div className="vx-chip-rail" role="group" aria-label="Language">
        {langs.map((l) => (
          <Chip key={l} active={lang === l} onClick={() => setLang(l)}>
            {languageLabel(l)}
          </Chip>
        ))}
      </div>
      <div className="bx-tile-grid is-quad">
        {MOODS.map((m) => (
          <BrowseTile
            key={m.id}
            to={`/search/${encodeURIComponent(moodSeed(m.id, lang))}`}
            shape="mood"
            tone={moodTone(m.id)}
            title={m.label}
            meta={languageLabel(lang)}
            visual={<TileGlyph emoji>{m.emoji}</TileGlyph>}
          />
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
  { id: '60s', query: '60s', tone: 10 },
  { id: '70s', query: '70s', tone: 11 },
  { id: '80s', query: '80s', tone: 9 },
  { id: '90s', query: '90s', tone: 3 },
  { id: '2000s', query: '2000s', tone: 4 },
  { id: '2010s', query: '2010s', tone: 2 },
  { id: '2020s', query: '2020s', tone: 1 },
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
    <section className="vx-section" aria-label="Decade radio">
      <SectionHeader title="Decade radio" explanation={`One tap plays the hits of a decade in ${languageLabel(lang)}`} />
      <div className="bx-tile-rail is-decades !mb-0">
        {DECADES.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => void start(d.query)}
            aria-pressed={busy === d.query}
            aria-busy={busy === d.query}
            disabled={busy !== null && busy !== d.query}
            className={`bx-decade vx-tone-${d.tone}`}
          >
            <strong>{d.id}</strong>
            <span>{busy === d.query ? 'Loading…' : `${languageLabel(lang)} hits`}</span>
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
    <section className="vx-section" aria-label="Pick a year">
      <SectionHeader title="Pick a year" explanation={`${languageLabel(lang)} songs from any year since 1970`} />
      <div className="bx-year">
        <label className="sr-only" htmlFor="explore-year">Year</label>
        <select id="explore-year" value={year} onChange={(e) => setYear(Number(e.target.value))} className="bx-select">
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <button type="button" onClick={() => void play()} disabled={busy} aria-busy={busy} className="btn-primary">
          <PlayIcon /> {busy ? 'Loading…' : `Play ${year}`}
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
    <section className="vx-section" aria-label="Language and mood hubs">
      <SectionHeader title="Language × mood" explanation="A page for every pairing, your languages first" />
      <div className="vx-hub-grid">
        {shown.map((t) => {
          const [tone, Icon] = HUB_TONE[t.mood.slug] ?? [1, MusicIcon];
          return (
            <Link key={t.to} to={t.to} className={`vx-hub-cell vx-tone-${tone}`}>
              <TileGlyph>
                <Icon />
              </TileGlyph>
              <span>
                <b>{languageLabel(t.lang)}</b>
                <small>{t.mood.label}</small>
              </span>
            </Link>
          );
        })}
      </div>
      {tiles.length > 12 && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          aria-expanded={showAll}
          className="bx-text-btn mt-3 -ml-3"
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
      className="bx-pill min-h-touch"
      aria-label="Open a surprise album from your listening"
    >
      <SparkleIcon className="w-4 h-4" /> Surprise album
    </button>
  );
}

export default function ExplorePage() {
  usePageTitle('Explore');
  return (
    <div className="vx-browse vx-browse-page max-w-screen-2xl mx-auto">
      <PageHeader title="Explore" subtitle="Radio by decade, a year to play, and every mood in every language." actions={<SurpriseAlbumButton />} />
      <nav className="bx-dests-wrap" aria-label="Explore destinations">
        <div className="bx-dests is-thirds">
          {tiles.map(({ to, label, meta, tone, icon: Icon }) => (
            <DestTile key={to} to={to} title={label} meta={meta} tone={`vx-tone-${tone}`} icon={<Icon />} />
          ))}
        </div>
      </nav>
      <DecadeRadio />
      <YearPicker />
      <MoodLanguageGrid />
      <HubGrid />
    </div>
  );
}
