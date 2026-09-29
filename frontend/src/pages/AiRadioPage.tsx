import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import { PageHeader } from '@/components/PageHeader';
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
import { byArtist, pickRadioSeeds, RADIO_MOODS, seedsForPrompt } from '@/features/radio/aiRadio';
import { RadioGlyph } from '@/features/radio/RadioGlyph';
import { languageLabel } from '@/constants/languages';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { letterAvatar } from '@/utils/avatar';
import type { Song } from '@/types';
import '@/styles/pages/radio.css';

const onArtError = (e: React.SyntheticEvent<HTMLImageElement>) => {
  e.currentTarget.src = FALLBACK_ART;
};

/** A different opening each time the same mood or artist is started. */
const rotation = () => Math.floor(Math.random() * 8);

/**
 * 8.2.0 — AI Radio: endless music from a song, an artist, a mood or a few
 * words. The page only finds the first songs; radio mode keeps the DJ adding
 * more for as long as the listener listens.
 */
export default function AiRadioPage() {
  usePageTitle('AI Radio');
  const startRadio = usePlayerStore((s) => s.startRadio);
  const current = useCurrentSong();
  const pinned = useSettingsStore((s) => s.pinnedLanguages);
  const muted = useSettingsStore((s) => s.mutedLanguages);
  const aiDj = useSettingsStore((s) => s.aiDj && s.aiAssist);
  const aiAssist = useSettingsStore((s) => s.aiAssist);
  const recent = useContinueListening(8);
  const artists = useYourArtists(8);
  const language = useMemo(() => pinned[0] ?? topLanguages(loadProfile(), 1)[0]?.id ?? null, [pinned]);

  const [text, setText] = useState('');
  /** What is being looked for, and whether VinaX AI was asked (the slower path). */
  const [busy, setBusy] = useState<{ label: string; ai?: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const blocked = (s: Song) => isSongBlocked(s, useLibraryStore.getState());

  const begin = (label: string): AbortSignal => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy({ label });
    setError(null);
    return ctrl.signal;
  };
  const play = (label: string, seeds: Song[], tune: TuneIntent | null = null): void => {
    setBusy(null);
    if (!seeds.length) {
      setError(`Couldn’t find songs for “${label}”. Try fewer words, like “${language ? languageLabel(language) + ' ' : ''}melody”.`);
      return;
    }
    startRadio(seeds[0], { seeds: seeds.slice(1), tune });
    setPlaying(label);
    toast(`AI Radio: ${label}`);
  };
  const failed = (label: string, signal: AbortSignal) => {
    if (signal.aborted) return;
    setBusy(null);
    setError(`Couldn’t start “${label}” right now. Check your connection and try again.`);
  };

  const fromSong = (song: Song) => {
    abortRef.current?.abort();
    setBusy(null);
    setError(null);
    startRadio(song);
    setPlaying(song.title);
    toast(`AI Radio: ${song.title}`);
  };

  const fromArtist = async (name: string) => {
    const signal = begin(name);
    try {
      const songs = byArtist(await searchSongs(name, 25, { signal }), name);
      if (!signal.aborted) play(name, pickRadioSeeds([songs], { blocked, rotate: rotation() }));
    } catch {
      failed(name, signal);
    }
  };

  const fromMood = async (intent: TuneIntent, label: string) => {
    const signal = begin(label);
    const query = tuneSearchQuery(intent, language);
    try {
      const songs = query ? await searchSongs(query, 25, { signal }) : [];
      // 8.3.0 — a DJ remix / Folk / Devotional tile opens on songs in that style.
      if (!signal.aborted) play(label, pickRadioSeeds([songs], { language, blocked, rotate: rotation(), style: tuneStyle(intent) ?? null }), intent);
    } catch {
      failed(label, signal);
    }
  };

  const fromText = async (raw: string) => {
    const label = raw.replace(/\s+/g, ' ').trim();
    if (!label) return;
    const signal = begin(label);
    try {
      const r = await seedsForPrompt(label, language, {
        search: searchSongs,
        blocked,
        signal,
        rotate: rotation(),
        // Settings → AI in recommendations off: the catalogue alone finds the seeds.
        ai: aiAssist
          ? async (prompt, languages, sig) => {
              if (!sig?.aborted) setBusy({ label, ai: true });
              const { generatePlaylist } = await import('@/services/ai/playlist');
              const res = await generatePlaylist(prompt, languages, muted, sig);
              return res.ok ? res.playlist.songs : [];
            }
          : undefined,
      });
      if (!signal.aborted) play(label, r.seeds, r.parsed.intent);
    } catch {
      failed(label, signal);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void fromText(text);
  };

  const lang = language ? languageLabel(language) : null;
  const examples = lang ? [`${lang} 90s melodies`, `${lang} DJ remix`, `${lang} folk songs`] : ['90s melodies', 'Romantic', 'Workout'];

  return (
    <div className="vx-radio">
      <PageHeader title="AI Radio" subtitle="Endless music from a song, a mood or a few words. The DJ keeps it going." />

      <p role="status" aria-live="polite" className="vx-radio-status">
        {busy ? (
          <>
            <span className="vx-radio-spin" aria-hidden /> {busy.ai ? 'Asking VinaX AI for' : 'Finding songs for'} “{busy.label}”…
          </>
        ) : playing ? (
          <>
            Playing AI Radio: {playing}. <Link to="/queue">See what’s next</Link>
          </>
        ) : (
          ''
        )}
      </p>
      {error && (
        <p role="alert" className="vx-radio-error">
          {error}
        </p>
      )}

      <section className="vx-radio-section" aria-labelledby="vx-radio-ask">
        <h2 id="vx-radio-ask" className="vx-radio-title">
          Describe it
        </h2>
        <form className="vx-radio-ask" onSubmit={submit}>
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={80}
            enterKeyHint="go"
            placeholder={examples[0]}
            aria-label="Describe your radio"
          />
          <button type="submit" className="vx-radio-btn is-primary" disabled={!text.trim() || !!busy}>
            Start radio
          </button>
        </form>
        <div className="vx-radio-chips" role="group" aria-label="Examples">
          {examples.map((ex) => (
            <button key={ex} type="button" className="vx-radio-chip" disabled={!!busy} onClick={() => { setText(ex); void fromText(ex); }}>
              {ex}
            </button>
          ))}
        </div>
      </section>

      <section className="vx-radio-section" aria-labelledby="vx-radio-moods">
        <h2 id="vx-radio-moods" className="vx-radio-title">
          Pick a mood
        </h2>
        <div className="vx-radio-moods" role="group" aria-label="Moods">
          {RADIO_MOODS.map((m, i) => (
            <button
              key={m.id}
              type="button"
              disabled={!!busy}
              onClick={() => void fromMood(m.id, m.label)}
              className={`vx-radio-mood tone-${(i % 8) + 1}`}
              aria-label={`Start ${m.label} radio`}
            >
              <span>{m.label}</span>
              <RadioGlyph className="vx-radio-mood-glyph" />
            </button>
          ))}
        </div>
      </section>

      {(current || recent.length > 0 || artists.length > 0) && (
        <section className="vx-radio-section" aria-labelledby="vx-radio-from">
          <h2 id="vx-radio-from" className="vx-radio-title">
            From a song or artist
          </h2>
          <div className="vx-radio-songs">
            {[...(current ? [current] : []), ...recent.filter((s) => s.id !== current?.id)].slice(0, 8).map((song, i) => (
              <button key={song.id} type="button" className="vx-radio-song" onClick={() => fromSong(song)} aria-label={`Start AI Radio from ${song.title}`}>
                <img src={bestImage(song.images, 150)} alt="" width={56} height={56} loading="lazy" decoding="async" onError={onArtError} />
                <span className="min-w-0">
                  <span className="vx-radio-song-title">{song.title}</span>
                  <span className="vx-radio-song-sub">{i === 0 && current ? 'Playing now' : song.subtitle}</span>
                </span>
              </button>
            ))}
          </div>
          {artists.length > 0 && (
            <div className="vx-radio-artists" role="group" aria-label="Your artists">
              {artists.map((a) => (
                <button key={a.id || a.name} type="button" className="vx-radio-artist" disabled={!!busy} onClick={() => void fromArtist(a.name)} aria-label={`Start AI Radio from ${a.name}`}>
                  <img src={a.image ?? letterAvatar(a.name)} alt="" width={72} height={72} loading="lazy" decoding="async" onError={onArtError} />
                  <span>{a.name}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      <p className="vx-radio-note">
        {aiDj ? 'The AI DJ picks what follows, and your skips steer it. ' : 'AI DJ is off, so the picks that follow come from on-device recommendations. '}
        Any song menu also has <span className="font-semibold text-ink-100">Start AI Radio</span>. <Link to="/settings">Settings</Link>
      </p>
    </div>
  );
}
