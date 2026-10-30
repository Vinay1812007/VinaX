import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import { PageHeader } from '@/components/PageHeader';
import { RefreshIcon, WaveIcon } from '@/components/Icons';
import { usePlayerStore, useCurrentSong } from '@/store/playerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { isSongBlocked, useLibraryStore } from '@/store/libraryStore';
import { toast } from '@/store/toastStore';
import { searchSongs } from '@/services/api';
import { tuneSearchQuery, type TuneIntent } from '@/services/recommendation/tune';
import { tuneStyle } from '@/services/recommendation/style';
import { loadProfile } from '@/services/personalization/storage';
import { topLanguages } from '@/services/personalization/profile';
import { useContinueListening } from '@/features/home/useHomeShelves';
import { useYourArtists } from '@/features/home/useYourArtists';
import { byArtist, pickRadioSeeds, RADIO_MOODS } from '@/features/radio/radioSeeds';
import { RadioGlyph } from '@/features/radio/RadioGlyph';
import { playFeaturedStation, useRadioStations } from '@/features/radio/stations';
import { languageLabel } from '@/constants/languages';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { letterAvatar } from '@/utils/avatar';
import type { RadioStation } from '@/services/api';
import type { Song } from '@/types';
import '@/styles/pages/radio.css';

const onArtError = (e: React.SyntheticEvent<HTMLImageElement>) => {
  e.currentTarget.src = FALLBACK_ART;
};

/** A different opening each time the same mood or artist is started. */
const rotation = () => Math.floor(Math.random() * 8);

/** The last start that was attempted, so a failure can offer Try again. */
type Attempt =
  | { kind: 'mood'; intent: TuneIntent; label: string }
  | { kind: 'artist'; name: string }
  | { kind: 'station'; station: RadioStation };

/** 1.3 — at most this many featured stations in the row. */
const STATIONS_MAX = 16;

/**
 * 8.2.0 — Radio: endless music from a song, an artist or a mood. The page
 * only finds the first songs; radio mode keeps adding more on the device for
 * as long as the listener listens.
 *
 * 9.0 "Encore" — mood pills, artwork-first song cards; the control that was
 * tapped shows it is starting, the live line says what is on air (Lagoon is
 * for live), and a failure offers Try again.
 *
 * 1.3 — Stations: the catalogue's featured stations in the listener's pinned
 * languages. A station plays its own songs (features/radio/stations); the
 * row is hidden when the catalogue has none.
 */
export default function RadioPage() {
  usePageTitle('Radio');
  const startRadio = usePlayerStore((s) => s.startRadio);
  const current = useCurrentSong();
  const pinned = useSettingsStore((s) => s.pinnedLanguages);
  const recent = useContinueListening(8);
  const artists = useYourArtists(8);
  const stations = useRadioStations();
  const language = useMemo(() => pinned[0] ?? topLanguages(loadProfile(), 1)[0]?.id ?? null, [pinned]);

  /** What is being looked for, and which control asked (so that control can show it is starting). */
  const [busy, setBusy] = useState<{ label: string; key: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  /** 1.3 — what is on air is a catalogue station, not a song or mood radio. */
  const [onStation, setOnStation] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const blocked = (s: Song) => isSongBlocked(s, useLibraryStore.getState());

  const begin = (label: string, key: string): AbortSignal => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy({ label, key });
    setError(null);
    return ctrl.signal;
  };
  const play = (label: string, seeds: Song[], tune: TuneIntent | null = null): void => {
    setBusy(null);
    if (!seeds.length) {
      setError(`Couldn’t find songs for “${label}”. Try another mood or artist.`);
      return;
    }
    startRadio(seeds[0], { seeds: seeds.slice(1), tune });
    setPlaying(label);
    setOnStation(false);
    toast(`Radio: ${label}`);
  };
  const failed = (label: string, signal: AbortSignal) => {
    if (signal.aborted) return;
    setBusy(null);
    setError(`Couldn’t start “${label}” right now. Check your connection and try again.`);
  };
  /** Stop looking: the search in flight is dropped and nothing starts. */
  const cancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(null);
  };

  const fromSong = (song: Song) => {
    abortRef.current?.abort();
    setAttempt(null);
    setBusy(null);
    setError(null);
    startRadio(song);
    setPlaying(song.title);
    setOnStation(false);
    toast(`Radio: ${song.title}`);
  };

  const fromArtist = async (name: string) => {
    setAttempt({ kind: 'artist', name });
    const signal = begin(name, `artist:${name}`);
    try {
      const songs = byArtist(await searchSongs(name, 25, { signal }), name);
      if (!signal.aborted) play(name, pickRadioSeeds([songs], { blocked, rotate: rotation() }));
    } catch {
      failed(name, signal);
    }
  };

  const fromMood = async (intent: TuneIntent, label: string) => {
    setAttempt({ kind: 'mood', intent, label });
    const signal = begin(label, `mood:${intent}`);
    const query = tuneSearchQuery(intent, language);
    try {
      const songs = query ? await searchSongs(query, 25, { signal }) : [];
      // 8.3.0 — a DJ remix / Folk / Devotional tile opens on songs in that style.
      if (!signal.aborted) play(label, pickRadioSeeds([songs], { language, blocked, rotate: rotation(), style: tuneStyle(intent) ?? null }), intent);
    } catch {
      failed(label, signal);
    }
  };

  const fromStation = async (station: RadioStation) => {
    setAttempt({ kind: 'station', station });
    const signal = begin(station.name, `station:${station.name}`);
    try {
      await playFeaturedStation(station, { signal });
      if (signal.aborted) return;
      setBusy(null);
      setPlaying(station.name);
      setOnStation(true);
      toast(`Radio: ${station.name}`);
    } catch {
      failed(station.name, signal);
    }
  };

  const retry = () => {
    if (!attempt) return;
    if (attempt.kind === 'mood') void fromMood(attempt.intent, attempt.label);
    else if (attempt.kind === 'artist') void fromArtist(attempt.name);
    else void fromStation(attempt.station);
  };

  const liveState = busy ? 'busy' : playing ? 'on' : 'idle';
  const seeds = [...(current ? [current] : []), ...recent.filter((s) => s.id !== current?.id)].slice(0, 8);
  const stationList = stations.data?.slice(0, STATIONS_MAX) ?? [];

  return (
    <div className="vx-studio vx-radio">
      <PageHeader title="Radio" subtitle="Endless music from a song, an artist, a mood or a station." />

      <div className="vx-radio-live" data-state={liveState}>
        {playing && !busy ? <span className="vx-radio-onair" aria-hidden /> : null}
        <p role="status" aria-live="polite" className="vx-radio-status">
          {busy ? (
            <span className="vx-shimmer">
              Finding songs for “{busy.label}”…
            </span>
          ) : playing ? (
            <>
              Playing {onStation ? '' : 'Radio: '}{playing}. <Link to="/queue">See what’s next</Link>
            </>
          ) : (
            ''
          )}
        </p>
        {busy && (
          <button type="button" onClick={cancel} className="btn-secondary">
            Stop
          </button>
        )}
      </div>
      {error && (
        <div className="vx-note">
          <span className="vx-note-icon" aria-hidden>
            <WaveIcon />
          </span>
          <div className="vx-note-text">
            <p role="alert" className="vx-note-msg">
              {error}
            </p>
            {attempt && (
              <div className="vx-note-actions">
                <button type="button" onClick={retry} className="btn-primary">
                  <RefreshIcon /> Try again
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <section className="vx-studio-section" aria-labelledby="vx-radio-moods">
        <h2 id="vx-radio-moods" className="vx-studio-title">
          Pick a mood
        </h2>
        <div className="vx-radio-moods" role="group" aria-label="Moods">
          {RADIO_MOODS.map((m, i) => {
            const starting = busy?.key === `mood:${m.id}`;
            return (
              <button
                key={m.id}
                type="button"
                disabled={!!busy}
                aria-busy={starting || undefined}
                onClick={() => void fromMood(m.id, m.label)}
                className={`vx-radio-mood tone-${(i % 8) + 1}`}
                aria-label={`Start ${m.label} radio`}
              >
                <span className="vx-radio-mood-glyph" aria-hidden>
                  {starting ? <span className="vx-spin" /> : <RadioGlyph />}
                </span>
                <span>{m.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      {stationList.length > 0 && (
        <section className="vx-studio-section" aria-labelledby="vx-radio-stations">
          <h2 id="vx-radio-stations" className="vx-studio-title">
            Stations
          </h2>
          <div className="vx-radio-seeds" role="group" aria-label="Stations">
            {stationList.map((st) => {
              const starting = busy?.key === `station:${st.name}`;
              return (
                <button
                  key={`${st.language}:${st.name}`}
                  type="button"
                  className="vx-radio-seed"
                  disabled={!!busy}
                  aria-busy={starting || undefined}
                  onClick={() => void fromStation(st)}
                  aria-label={`Start ${st.name} station`}
                >
                  <span className="vx-radio-seed-art" style={st.color ? { background: st.color } : undefined}>
                    <img src={bestImage(st.images, 300)} alt="" width={152} height={152} loading="lazy" decoding="async" onError={onArtError} />
                    <span className="vx-radio-seed-badge" aria-hidden>
                      {starting ? <span className="vx-spin" /> : <RadioGlyph />}
                    </span>
                  </span>
                  <span className="vx-radio-seed-title">{st.name}</span>
                  <span className="vx-radio-seed-sub">{st.description ?? languageLabel(st.language)}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {(seeds.length > 0 || artists.length > 0) && (
        <section className="vx-studio-section" aria-labelledby="vx-radio-from">
          <h2 id="vx-radio-from" className="vx-studio-title">
            From a song or artist
          </h2>
          {seeds.length > 0 && (
            <div className="vx-radio-seeds">
              {seeds.map((song, i) => (
                <button key={song.id} type="button" className="vx-radio-seed" onClick={() => fromSong(song)} aria-label={`Start radio from ${song.title}`}>
                  <span className="vx-radio-seed-art">
                    <img src={bestImage(song.images, 300)} alt="" width={152} height={152} loading="lazy" decoding="async" onError={onArtError} />
                    <span className="vx-radio-seed-badge" aria-hidden>
                      <RadioGlyph />
                    </span>
                  </span>
                  <span className="vx-radio-seed-title">{song.title}</span>
                  {i === 0 && current ? (
                    <span className="vx-radio-seed-sub is-now">Playing now</span>
                  ) : (
                    <span className="vx-radio-seed-sub">{song.subtitle}</span>
                  )}
                </button>
              ))}
            </div>
          )}
          {artists.length > 0 && (
            <div className="vx-radio-artists" role="group" aria-label="Your artists">
              {artists.map((a) => {
                const starting = busy?.key === `artist:${a.name}`;
                return (
                  <button
                    key={a.id || a.name}
                    type="button"
                    className="vx-radio-artist"
                    disabled={!!busy}
                    aria-busy={starting || undefined}
                    onClick={() => void fromArtist(a.name)}
                    aria-label={`Start radio from ${a.name}`}
                  >
                    <span className="vx-radio-artist-art">
                      <img src={a.image ?? letterAvatar(a.name)} alt="" width={80} height={80} loading="lazy" decoding="async" onError={onArtError} />
                      {starting && <span className="vx-spin" aria-hidden />}
                    </span>
                    <span>{a.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      )}

      <p className="vx-radio-note">
        What follows is picked on this device, and your skips steer it. Any song menu also has <span className="font-semibold text-ink-100">Start radio</span>.
      </p>
    </div>
  );
}
