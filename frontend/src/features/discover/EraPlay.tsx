import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { languageLabel } from '@/constants/languages';
import { usePlayerStore } from '@/store/playerStore';
import { useHistoryStore } from '@/store/historyStore';
import { useLibraryStore } from '@/store/libraryStore';
import { searchSongs } from '@/services/api';
import { toast } from '@/store/toastStore';
import { requireAccount } from '@/services/auth/gate';
import { PlayIcon, SparkleIcon } from '@/components/Icons';
import { SectionHeader } from '@/components/SectionHeader';
import '@/styles/pages/browse.css';

/**
 * Discover's play-by-era pieces (they were Explore's until Explore folded
 * into Discover): Decade radio, Pick a year and Surprise album. The first two
 * follow the language picked on Discover, like every shelf there.
 */

const DECADES = [
  { id: '60s', tone: 10 },
  { id: '70s', tone: 11 },
  { id: '80s', tone: 9 },
  { id: '90s', tone: 3 },
  { id: '2000s', tone: 4 },
  { id: '2010s', tone: 2 },
  { id: '2020s', tone: 1 },
] as const;

/** The first year Pick a year offers. */
export const FIRST_YEAR = 1970;

/** Every year from this one back to FIRST_YEAR, newest first. */
export function yearsBack(thisYear: number): number[] {
  const out: number[] = [];
  for (let y = thisYear; y >= FIRST_YEAR; y--) out.push(y);
  return out;
}

/** Decade radio: one tap searches "<decade> <language> hits" and plays. */
export function DecadeRadio({ lang }: { lang: string }) {
  const playQueue = usePlayerStore((s) => s.playQueue);
  const [busy, setBusy] = useState<string | null>(null);
  const label = languageLabel(lang);
  const start = async (decade: string): Promise<void> => {
    if (busy) return;
    // 13.9 — signed out: ask first, before a search is spent; the tap replays after sign-in.
    if (!requireAccount('listen', () => void start(decade))) return;
    setBusy(decade);
    try {
      const songs = await searchSongs(`${decade} ${lang} hits`, 30);
      if (!songs.length) {
        toast(`No ${decade} ${label} hits found — try another decade`);
        return;
      }
      playQueue(songs, 0);
      toast(`Decade radio · ${decade} ${label}`);
    } catch {
      toast('Could not start that radio — check your connection');
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="vx-section" aria-label="Decade radio">
      <SectionHeader title="Decade radio" explanation={`One tap plays the hits of a decade in ${label}`} />
      <div className="bx-tile-rail is-decades !mb-0">
        {DECADES.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => void start(d.id)}
            aria-pressed={busy === d.id}
            aria-busy={busy === d.id}
            disabled={busy !== null && busy !== d.id}
            className={`bx-decade vx-tone-${d.tone}`}
          >
            <strong>{d.id}</strong>
            <span>{busy === d.id ? 'Loading…' : `${label} hits`}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

/** Pick a year: "<year> <language> songs", then play. */
export function YearPicker({ lang }: { lang: string }) {
  const playQueue = usePlayerStore((s) => s.playQueue);
  const thisYear = new Date().getFullYear();
  const years = useMemo(() => yearsBack(thisYear), [thisYear]);
  const [year, setYear] = useState(thisYear);
  const [busy, setBusy] = useState(false);
  const label = languageLabel(lang);
  const play = async (): Promise<void> => {
    if (busy) return;
    if (!requireAccount('listen', () => void play())) return;
    setBusy(true);
    try {
      const songs = await searchSongs(`${year} ${lang} songs`, 30);
      if (!songs.length) {
        toast(`Nothing found for ${year} — try a nearby year`);
        return;
      }
      playQueue(songs, 0);
      toast(`Playing ${year} · ${label}`);
    } catch {
      toast('Could not load that year — check your connection');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="vx-section" aria-label="Pick a year">
      <SectionHeader title="Pick a year" explanation={`${label} songs from any year since ${FIRST_YEAR}`} />
      <div className="bx-year">
        <label className="sr-only" htmlFor="discover-year">Year</label>
        <select id="discover-year" value={year} onChange={(e) => setYear(Number(e.target.value))} className="bx-select">
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

/** Surprise album: a random album from your history and favourites. */
export function SurpriseAlbumButton() {
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
