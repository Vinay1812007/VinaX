import { useEffect, useId, useState } from 'react';
import type { Song } from '@/types';
import { usePlayerStore } from '@/store/playerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { toast } from '@/store/toastStore';
import { GEN_ERROR_TEXT, generateLike, generationAvailability, isGeneratedSong, useGenerationStore, type Availability, type GenError } from '@/services/ai/songGen';

/**
 * 1.4 — Now Playing's "Generate a song like this". Hidden unless song making is
 * set up and switched on for this listener. The new song is ORIGINAL: it
 * borrows the playing song's feel (mood, energy, tempo, genre, language) and
 * nothing else. Kid mode makes instrumentals only and takes no words.
 */
const LENGTHS = [
  { sec: 60, label: '1 min' },
  { sec: 120, label: '2 min' },
  { sec: 180, label: '3 min' },
] as const;

export function GenerateLikeThis({ song }: { song: Song }) {
  const [avail, setAvail] = useState<Availability | null>(null);
  const [open, setOpen] = useState(false);
  const [words, setWords] = useState('');
  const [instrumental, setInstrumental] = useState(false);
  const [length, setLength] = useState<number>(120);
  const [error, setError] = useState<GenError | null>(null);
  const kid = useSettingsStore((s) => s.kidMode);
  const latest = useGenerationStore((s) => (s.latest ? s.jobs[s.latest] : null));
  const playSong = usePlayerStore((s) => s.playSong);
  const enqueueNext = usePlayerStore((s) => s.enqueueNext);
  const panel = useId();

  useEffect(() => {
    let live = true;
    void generationAvailability().then((a) => live && setAvail(a));
    return () => {
      live = false;
    };
  }, []);

  if (!avail?.available) return null;
  const busy = !!latest && (latest.status === 'starting' || latest.status === 'queued' || latest.status === 'running');
  const done = latest?.status === 'done' ? latest.song : null;

  const start = async (): Promise<void> => {
    setError(null);
    const r = await generateLike(song, { durationSec: length, instrumental: kid || instrumental, promptText: kid ? undefined : words, fromNowPlaying: true });
    if ('error' in r) {
      setError(r.error);
      return;
    }
    toast(`“${r.song.title}” is ready — an AI generated song`, { key: 'generated-ready', action: { label: 'Play', onClick: () => playSong(r.song) } });
    void generationAvailability(true).then(setAvail);
  };

  const save = async (s: Song): Promise<void> => {
    try {
      const { downloadSong } = await import('@/services/downloads');
      toast((await downloadSong(s)) ? 'Saved on this device' : 'Could not save it right now');
    } catch {
      toast('Could not save it right now');
    }
  };

  return (
    <section className="vx-np-gen" aria-label="Generate a song like this">
      {!open && !busy && !done && (
        <button type="button" className="vx-np-pill vx-np-gen-open" aria-expanded={false} aria-controls={panel} onClick={() => setOpen(true)}>
          ✦ Generate a song like this
        </button>
      )}
      {(open || busy || done) && (
        <div id={panel} className="vx-np-gen-panel">
          <p className="vx-np-gen-lede">
            A new, original song in the feel of this one{isGeneratedSong(song) ? '' : ' — its mood, energy, tempo, genre and language'}. It never copies the song, its words or its singers. {avail.remaining} left today.
          </p>
          {!busy && !done && (
            <>
              {!kid && (
                <label className="vx-np-gen-field">
                  <span>Add a few words (optional)</span>
                  <input value={words} maxLength={200} onChange={(e) => setWords(e.target.value)} placeholder="rain on the window, warm flute" />
                </label>
              )}
              <div className="vx-np-gen-row" role="group" aria-label="Length">
                {LENGTHS.map((l) => (
                  <button key={l.sec} type="button" className="vx-np-pill" aria-pressed={length === l.sec} onClick={() => setLength(l.sec)}>
                    {l.label}
                  </button>
                ))}
                {kid ? (
                  <span className="vx-np-gen-note">Instrumental (Kid mode)</span>
                ) : (
                  <label className="vx-np-gen-check">
                    <input type="checkbox" checked={instrumental} onChange={(e) => setInstrumental(e.target.checked)} />
                    <span>Instrumental</span>
                  </label>
                )}
              </div>
              <div className="vx-np-gen-row">
                <button type="button" className="vx-np-pill is-primary" onClick={() => void start()}>Generate</button>
                <button type="button" className="vx-np-pill" onClick={() => { setOpen(false); setError(null); }}>Cancel</button>
              </div>
            </>
          )}
          {busy && (
            <div className="vx-np-gen-progress">
              <div className="vx-np-gen-bar" role="progressbar" aria-label="Making your song" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((latest?.progress ?? 0) * 100)}>
                <span style={{ width: `${Math.max(4, Math.round((latest?.progress ?? 0) * 100))}%` }} />
              </div>
              <p role="status">{latest?.status === 'starting' || latest?.status === 'queued' ? 'Starting your song…' : `Making your song… ${Math.round((latest?.progress ?? 0) * 100)}%`}</p>
            </div>
          )}
          {done && (
            <div className="vx-np-gen-done">
              <p>
                <strong>{done.title}</strong> <span className="vx-ai-badge">AI generated</span>
              </p>
              <div className="vx-np-gen-row">
                <button type="button" className="vx-np-pill is-primary" onClick={() => playSong(done)}>Play now</button>
                <button type="button" className="vx-np-pill" onClick={() => { enqueueNext(done); }}>Play next</button>
                <button type="button" className="vx-np-pill" onClick={() => void save(done)}>Save</button>
                <button type="button" className="vx-np-pill" onClick={() => { useGenerationStore.setState({ latest: null }); setOpen(true); }}>Make another</button>
              </div>
              <p className="vx-np-gen-note">Kept for a day unless you save it, like it or add it to a playlist.</p>
            </div>
          )}
          {error && <p className="vx-np-gen-error" role="alert">{GEN_ERROR_TEXT[error]}</p>}
        </div>
      )}
    </section>
  );
}
