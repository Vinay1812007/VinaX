import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import { PageHeader } from '@/components/PageHeader';
import { SparkleIcon, WaveIcon } from '@/components/Icons';
import { RefreshIcon } from '@/components/ai/AiExtras';
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

/** The last start that was attempted, so a failure can offer Try again. */
type Attempt = { kind: 'mood'; intent: TuneIntent; label: string } | { kind: 'artist'; name: string } | { kind: 'text'; label: string };

/**
 * 8.2.0 — AI Radio: endless music from a song, an artist, a mood or a few
 * words. The page only finds the first songs; radio mode keeps the DJ adding
 * more for as long as the listener listens.
 *
 * 9.0 "Encore" — the chat's composer for the words, mood pills, artwork-first
 * song cards; the control that was tapped shows it is starting, the live line
 * says what is on air (Lagoon is for live), and a failure offers Try again.
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
  /** What is being looked for, whether VinaX AI was asked (the slower path),
   *  and which control asked (so that control can show it is starting). */
  const [busy, setBusy] = useState<{ label: string; ai?: boolean; key: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
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
    toast(`AI Radio: ${song.title}`);
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

  const fromText = async (raw: string) => {
    const label = raw.replace(/\s+/g, ' ').trim();
    if (!label) return;
    setAttempt({ kind: 'text', label });
    const signal = begin(label, 'text');
    try {
      const r = await seedsForPrompt(label, language, {
        search: searchSongs,
        blocked,
        signal,
        rotate: rotation(),
        // Settings → AI in recommendations off: the catalogue alone finds the seeds.
        ai: aiAssist
          ? async (prompt, languages, sig) => {
              if (!sig?.aborted) setBusy({ label, ai: true, key: 'text' });
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

  const retry = () => {
    if (!attempt) return;
    if (attempt.kind === 'mood') void fromMood(attempt.intent, attempt.label);
    else if (attempt.kind === 'artist') void fromArtist(attempt.name);
    else void fromText(attempt.label);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void fromText(text);
  };

  const lang = language ? languageLabel(language) : null;
  const examples = lang ? [`${lang} 90s melodies`, `${lang} DJ remix`, `${lang} folk songs`] : ['90s melodies', 'Romantic', 'Workout'];
  const liveState = busy ? 'busy' : playing ? 'on' : 'idle';
  const seeds = [...(current ? [current] : []), ...recent.filter((s) => s.id !== current?.id)].slice(0, 8);

  return (
    <div className="vx-aistudio vx-radio">
      <PageHeader title="AI Radio" subtitle="Endless music from a song, a mood or a few words. The DJ keeps it going." />

      <form className="vx-aiprompt is-inline" onSubmit={submit}>
        <span className="vx-ai-mark" aria-hidden>
          <SparkleIcon filled />
        </span>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={80}
          enterKeyHint="go"
          placeholder={examples[0]}
          aria-label="Describe your radio"
        />
        <button type="submit" className="btn-primary" disabled={!text.trim() || !!busy}>
          Start radio
        </button>
      </form>
      <div className="vx-aistudio-chips" role="group" aria-label="Examples">
        {examples.map((ex) => (
          <button
            key={ex}
            type="button"
            className="vx-aistudio-chip"
            disabled={!!busy}
            onClick={() => {
              setText(ex);
              void fromText(ex);
            }}
          >
            {ex}
          </button>
        ))}
      </div>

      <div className="vx-radio-live" data-state={liveState}>
        {busy ? (
          <span className="vx-ai-mark is-working" aria-hidden>
            <SparkleIcon filled />
          </span>
        ) : playing ? (
          <span className="vx-radio-onair" aria-hidden />
        ) : null}
        <p role="status" aria-live="polite" className="vx-radio-status">
          {busy ? (
            <span className="vx-ai-shimmer">
              {busy.ai ? 'Asking VinaX AI for' : 'Finding songs for'} “{busy.label}”…
            </span>
          ) : playing ? (
            <>
              Playing AI Radio: {playing}. <Link to="/queue">See what’s next</Link>
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
        <div className="vx-ainote">
          <span className="vx-ainote-icon" aria-hidden>
            <WaveIcon />
          </span>
          <div className="vx-ainote-text">
            <p role="alert" className="vx-ainote-msg">
              {error}
            </p>
            {attempt && (
              <div className="vx-ainote-actions">
                <button type="button" onClick={retry} className="btn-primary">
                  <RefreshIcon /> Try again
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <section className="vx-aistudio-section" aria-labelledby="vx-radio-moods">
        <h2 id="vx-radio-moods" className="vx-aistudio-title">
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
                  {starting ? <span className="vx-ai-spin" /> : <RadioGlyph />}
                </span>
                <span>{m.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      {(seeds.length > 0 || artists.length > 0) && (
        <section className="vx-aistudio-section" aria-labelledby="vx-radio-from">
          <h2 id="vx-radio-from" className="vx-aistudio-title">
            From a song or artist
          </h2>
          {seeds.length > 0 && (
            <div className="vx-radio-seeds">
              {seeds.map((song, i) => (
                <button key={song.id} type="button" className="vx-radio-seed" onClick={() => fromSong(song)} aria-label={`Start AI Radio from ${song.title}`}>
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
                    aria-label={`Start AI Radio from ${a.name}`}
                  >
                    <span className="vx-radio-artist-art">
                      <img src={a.image ?? letterAvatar(a.name)} alt="" width={80} height={80} loading="lazy" decoding="async" onError={onArtError} />
                      {starting && <span className="vx-ai-spin" aria-hidden />}
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
        {aiDj ? 'The AI DJ picks what follows, and your skips steer it. ' : 'AI DJ is off, so the picks that follow come from on-device recommendations. '}
        {aiAssist ? '' : 'AI in recommendations is off, so the words you type are matched in the catalogue alone. '}
        Any song menu also has <span className="font-semibold text-ink-100">Start AI Radio</span>. <Link to="/settings">Settings</Link>
      </p>
    </div>
  );
}
