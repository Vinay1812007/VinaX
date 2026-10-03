import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import { PageHeader } from '@/components/PageHeader';
import { SongRow } from '@/components/SongRow';
import { IconButton } from '@/components/IconButton';
import { ListSkeleton } from '@/components/Skeletons';
import { QueueIcon, SparkleIcon, WaveIcon } from '@/components/Icons';
import { PencilIcon, RefreshIcon } from '@/components/ai/AiExtras';
import { EntityMeta, PlayFab, songsLabel, totalDuration } from '@/components/EntityHeader';
import { CollageCover } from '@/features/library/CollageCover';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import { toast } from '@/store/toastStore';
import { generatePlaylist, playlistErrorCopy, type GeneratedPlaylist, type PlaylistFailure } from '@/services/ai/playlist';
import { songKey } from '@/services/recommendation/songIdentity';
import type { Song } from '@/types';
import { scrollBehavior } from '@/utils/motion';
import '@/styles/pages/radio.css';

/** Why the last build gave no playlist, as the page shows it. */
type Problem = { kind: 'failed'; reason: PlaylistFailure; message: string } | { kind: 'stopped' };

/**
 * AI playlist: a prompt → a playlist of songs you can play now.
 *
 * 9.0 "Encore" — the same language as VinaX AI: the prompt is the chat's
 * composer, the build shows its progress with a Stop, a failure says why and
 * offers the next step (try again, edit the idea, or AI Radio, which plays
 * from the catalogue without the curator), and the result reads like a
 * playlist page: artwork, title, Play, Save as playlist, Add to queue.
 */
export default function AIPlaylistPage() {
  usePageTitle('AI playlist');
  const navigate = useNavigate();
  const pinned = useSettingsStore((s) => s.pinnedLanguages);
  const language = pinned[0] ? pinned[0][0].toUpperCase() + pinned[0].slice(1) : 'Hindi';
  const examples = [
    {
      title: 'Deep focus',
      detail: 'A little calm, a lot of flow',
      prompt: `Mellow ${language} songs for a focused afternoon`,
    },
    {
      title: 'After hours',
      detail: 'Slow down and settle in',
      prompt: `Soft ${language} melodies for a late-night wind-down`,
    },
    {
      title: 'Out of office',
      detail: 'Your next road-trip soundtrack',
      prompt: `Feel-good ${language} road trip songs, familiar hits and hidden gems`,
    },
    {
      title: 'Find my energy',
      detail: 'One more song. One more rep.',
      prompt: `High-energy ${language} workout songs with driving beats`,
    },
  ];
  const muted = useSettingsStore((s) => s.mutedLanguages);
  const [prompt, setPrompt] = useState('');
  /** The idea the current result (or the build in flight) was made from. */
  const [asked, setAsked] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GeneratedPlaylist | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  /**
   * 9.1.0 — tracks the listener pinned. A rebuild keeps these, in place, and
   * replaces only the rest. Held by canonical identity so a lock survives the
   * same song arriving under another release id.
   */
  const [lockedKeys, setLockedKeys] = useState<ReadonlySet<string>>(new Set());
  /** 9.1.0 — a refinement of the list on screen ("more upbeat", "fewer film songs"). */
  const [refine, setRefine] = useState('');
  // Leaving the page ends the build in flight.
  useEffect(() => () => abortRef.current?.abort(), []);

  /**
   * `mode` says what kind of build this is:
   *   'new'      a fresh idea — nothing is kept.
   *   'again'    the same idea, next round: the catalogue is read from different
   *              phrasings and pages, and locked tracks stay.
   *   'fewer'    the same, with the strict repetition rule (see the service).
   *   'replace'  swap one track for something else, keeping everything else.
   */
  const run = async (text: string, mode: 'new' | 'again' | 'fewer' | 'replace' | 'refine' = 'new', replacing?: Song) => {
    const q = text.trim();
    if (!q || loading) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setPrompt(q);
    setAsked(q);
    setLoading(true);
    setProblem(null);
    // A rebuild of the same idea keeps the current list on screen until the new
    // one lands; a brand-new idea starts clean.
    if (mode === 'new') {
      setResult(null);
      setLockedKeys(new Set());
    }
    const keep =
      mode === 'new'
        ? []
        : mode === 'replace'
          ? (result?.songs ?? []).filter((x) => x.id !== replacing?.id)
          : (result?.songs ?? []).filter((x) => lockedKeys.has(songKey(x)));
    if (mode === 'new') setRefine('');
    let res;
    try {
      res = await generatePlaylist(q, pinned, muted, {
        signal: ctrl.signal,
        regenerate: mode !== 'new',
        locked: keep,
        ...(mode === 'replace' && replacing ? { exclude: [replacing] } : {}),
        ...(mode === 'fewer' ? { fewerRepeats: true } : {}),
        ...(mode === 'refine' && refine.trim() ? { refine: refine.trim() } : {}),
      });
    } catch {
      if (!ctrl.signal.aborted) {
        setProblem({ kind: 'failed', reason: 'error', message: 'The playlist service could not be reached. Your idea is still in the box — try again.' });
      }
      return;
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
      setLoading(false);
    }
    if (ctrl.signal.aborted) {
      setProblem({ kind: 'stopped' });
      return;
    }
    if (res.ok) {
      setResult(res.playlist);
      // Drop locks for songs the new list no longer holds.
      const present = new Set(res.playlist.songs.map(songKey));
      setLockedKeys((prev) => new Set([...prev].filter((k) => present.has(k))));
      return;
    }
    setProblem({ kind: 'failed', reason: res.reason, message: playlistErrorCopy(res.reason) });
  };

  const stop = () => abortRef.current?.abort();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(prompt);
  };

  const editPrompt = () => {
    const field = fieldRef.current;
    if (!field) return;
    field.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
    field.focus({ preventScroll: true });
    field.setSelectionRange(field.value.length, field.value.length);
  };

  const playAll = () => {
    if (result?.songs.length) usePlayerStore.getState().playQueue(result.songs, 0);
  };

  const queueAll = () => {
    if (!result?.songs.length) return;
    // The store confirms ("Added N songs to queue" / "Already in queue").
    usePlayerStore.getState().enqueueAll(result.songs);
  };

  const save = () => {
    if (!result?.songs.length) return;
    const lib = useLibraryStore.getState();
    const id = lib.createCollection(result.name);
    result.songs.forEach((s) => lib.addToCollection(id, s));
    toast(`Saved “${result.name}”`);
    navigate(`/collection/${id}`);
  };

  // Asking again only helps when the refusal is temporary.
  const canRetry = problem?.kind === 'stopped' || (problem?.kind === 'failed' && problem.reason !== 'disabled' && problem.reason !== 'not_configured');

  return (
    <div className="vx-aistudio vx-aip">
      <PageHeader title="AI playlist" subtitle="Describe a mood, a moment or an artist. You get a playlist of songs you can play right now." />

      <form className="vx-aiprompt" onSubmit={submit}>
        <label htmlFor="playlist-idea" className="vx-aiprompt-label">
          <span className="vx-ai-mark" aria-hidden>
            <SparkleIcon filled />
          </span>
          Describe your perfect mix
        </label>
        <textarea
          ref={fieldRef}
          id="playlist-idea"
          maxLength={600}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void run(prompt);
            }
          }}
          placeholder="e.g. Rainy-day Telugu melodies for a slow evening"
          rows={3}
        />
        <div className="vx-aiprompt-row">
          <p className="vx-aiprompt-hint">Start with a mood, an artist or a moment. Your languages guide the picks.</p>
          {loading ? (
            <button type="button" onClick={stop} className="btn-secondary">
              Stop
            </button>
          ) : (
            <button type="submit" disabled={!prompt.trim()} className="btn-primary">
              <SparkleIcon /> Build my playlist
            </button>
          )}
        </div>
      </form>

      {loading && (
        <>
          <div className="vx-aistate" role="status" aria-live="polite">
            <span className="vx-ai-mark is-working" aria-hidden>
              <SparkleIcon filled />
            </span>
            <div className="vx-aistate-text">
              <p className="vx-aistate-title">
                <span className="vx-ai-shimmer">Building your playlist…</span>
              </p>
              <p className="vx-aistate-sub">Finding fresh songs that fit “{asked}”. This can take up to half a minute.</p>
            </div>
          </div>
          <div className="vx-aistudio-skel" aria-hidden>
            <ListSkeleton rows={5} />
          </div>
        </>
      )}

      {problem && !loading && (
        <div className="vx-ainote">
          <span className="vx-ainote-icon" aria-hidden>
            <WaveIcon />
          </span>
          <div className="vx-ainote-text">
            <p className="vx-ainote-title">{problem.kind === 'stopped' ? 'Stopped' : 'No playlist this time'}</p>
            <p className="vx-ainote-msg" role={problem.kind === 'failed' ? 'alert' : 'status'}>
              {problem.kind === 'stopped' ? 'Your idea is still in the box — change it or build again.' : problem.message}
            </p>
            <div className="vx-ainote-actions">
              {canRetry && (
                <button type="button" onClick={() => void run(asked || prompt)} className="btn-primary">
                  <RefreshIcon /> Try again
                </button>
              )}
              <button type="button" onClick={editPrompt} className="btn-secondary">
                <PencilIcon /> Edit the idea
              </button>
              {!canRetry && (
                <Link to="/radio" className="btn-secondary">
                  Start AI Radio
                </Link>
              )}
            </div>
          </div>
        </div>
      )}

      {result && (
        <section className="vx-aip-result" aria-labelledby="ai-result-title">
          <header className="vx-aip-head">
            <CollageCover songs={result.songs} minPx={300} className="vx-aip-art" />
            <div className="vx-aip-body">
              <p className="vx-aip-kind">
                <SparkleIcon filled />
                {result.source === 'catalogue' ? 'From the catalogue' : 'AI playlist'}
              </p>
              <h2 id="ai-result-title" className="vx-aip-title">
                {result.name}
              </h2>
              {result.description && <p className="vx-aip-desc">{result.description}</p>}
              <EntityMeta items={[songsLabel(result.songs.length), totalDuration(result.songs)]} />
            </div>
          </header>
          <div className="vx-aip-actions">
            <PlayFab label="Play" onClick={playAll} />
            <button type="button" onClick={save} className="btn-secondary">
              Save as playlist
            </button>
            <IconButton size="lg" label="Add to queue" onClick={queueAll}>
              <QueueIcon className="w-6 h-6" />
            </IconButton>
            <IconButton size="lg" label="Build it again" onClick={() => void run(asked, 'again')}>
              <RefreshIcon className="w-6 h-6" />
            </IconButton>
            {/* 9.1.0 — the strict repetition rule for one build: leaves out
                everything this listener has met lately, even at the cost of a
                shorter list. */}
            <button type="button" className="btn-secondary" onClick={() => void run(asked, 'fewer')}>
              Fewer repeats
            </button>
            <IconButton size="lg" label="Edit the idea" onClick={editPrompt}>
              <PencilIcon className="w-6 h-6" />
            </IconButton>
          </div>
          {result.shortfall && (
            <p className="vx-aip-shortfall" role="status">
              {result.shortfall}
            </p>
          )}
          {/* 9.1.0 — refine the list that is on screen, keeping anything kept. */}
          <form
            className="vx-aip-refine"
            onSubmit={(e) => {
              e.preventDefault();
              if (refine.trim()) void run(asked, 'refine');
            }}
          >
            <label htmlFor="playlist-refine" className="sr-only">
              Change something about this playlist
            </label>
            <input
              id="playlist-refine"
              value={refine}
              onChange={(e) => setRefine(e.target.value.slice(0, 200))}
              placeholder="Change something — e.g. more upbeat, fewer film songs"
              disabled={loading}
            />
            <button type="submit" className="btn-secondary" disabled={loading || !refine.trim()}>
              Refine
            </button>
          </form>
          {lockedKeys.size > 0 && (
            <p className="vx-aip-locknote" role="status">
              {lockedKeys.size === 1 ? '1 track kept' : `${lockedKeys.size} tracks kept`} — building again replaces only the rest.
            </p>
          )}
          <div className="vx-tracklist">
            {result.songs.map((song, i) => {
              const key = songKey(song);
              const locked = lockedKeys.has(key);
              return (
                <div key={song.id} className={locked ? 'vx-aip-track is-locked' : 'vx-aip-track'}>
                  <SongRow song={song} songs={result.songs} index={i} />
                  <div className="vx-aip-trackacts">
                    {/* 9.1.0 — keep this one through the next build. */}
                    <button
                      type="button"
                      className="vx-aip-lock"
                      aria-pressed={locked}
                      aria-label={locked ? `Stop keeping ${song.title}` : `Keep ${song.title} when building again`}
                      onClick={() =>
                        setLockedKeys((prev) => {
                          const next = new Set(prev);
                          if (next.has(key)) next.delete(key);
                          else next.add(key);
                          return next;
                        })
                      }
                    >
                      {locked ? 'Kept' : 'Keep'}
                    </button>
                    {/* 9.1.0 — swap just this track; everything else stays. */}
                    <button
                      type="button"
                      className="vx-aip-swap"
                      disabled={loading}
                      aria-label={`Replace ${song.title} with another song`}
                      onClick={() => void run(asked, 'replace', song)}
                    >
                      Replace
                    </button>
                  </div>
                  {/* 8.5.0 — why the curator chose it: about fit only, never facts about the artist. */}
                  {result.reasons?.[song.id] && (
                    <p className="vx-aip-reason">
                      <SparkleIcon filled />
                      <span>{result.reasons[song.id]}</span>
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="vx-aistudio-section" aria-labelledby="vx-aip-ideas">
        <h2 id="vx-aip-ideas" className="vx-aistudio-title">
          {result ? 'Try another idea' : 'Start from an idea'}
        </h2>
        <div className="vx-aip-ideas" role="group" aria-label="Ideas">
          {examples.map((example) => (
            <button key={example.title} type="button" className="vx-aip-idea" disabled={loading} onClick={() => void run(example.prompt)}>
              <SparkleIcon />
              <strong>{example.title}</strong>
              <span>{example.detail}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
