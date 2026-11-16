import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import { usePlayerStore, useCurrentSong } from '@/store/playerStore';
import { audioEngine } from '@/services/audio/engine';
import { useCastStore } from '@/services/cast';
import { bestImage } from '@/utils/images';
import { extractVibrantColor } from '@/utils/color';
import { acquireWakeLock, releaseWakeLock } from '@/utils/wakeLock';
import { reducedMotion } from '@/utils/motion';
import { iosWeb } from '@/utils/platform';
import { ChevronDownIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon, SettingsIcon } from '@/components/Icons';
import { EmptyState } from '@/components/States';
import { Chip } from '@/components/Chip';
import { Sheet, SheetHeader } from '@/components/Sheet';
import { Slider, Switch } from '@/components/ui';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { cn } from '@/utils/cn';
import { BeatDetector, tapTempo, type BeatFrame } from '@/features/disco/beat';
import { DiscoRenderer, MAX_BRIGHTNESS, paletteHues, type LightInput } from '@/features/disco/lights';
import { DISCO_PALETTES, DISCO_STYLES, useDiscoStore } from '@/features/disco/discoStore';
import '@/styles/pages/player.css';

/** Where the beat comes from: the music itself, or a steady rhythm (tap to set it). */
type BeatSource = 'starting' | 'live' | 'rhythm';

/** Playing this long with nothing to read means the music cannot be heard here: fall back to a rhythm. */
const LIVE_WAIT_MS = 3000;
const DEFAULT_BPM = 120;

/**
 * Disco lights: the screen becomes a light show that follows the song's
 * beat. The beat is read from the bass of the music as it plays (the sound
 * chain's analyser, run flat when Sound effects are off); where the music
 * cannot be read (iPhone Safari, casting, a source that does not share its
 * sound) the lights keep a steady rhythm the listener can tap to match.
 * Tap the lights to hide or show the controls; Adjust changes the style,
 * colours, brightness, beat sensitivity, motion and the optional flash.
 */
export default function DiscoPage() {
  usePageTitle('Disco Lights');
  const song = useCurrentSong();
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const { togglePlay, next, prev } = usePlayerStore.getState();
  const navigate = useNavigate();
  const casting = useCastStore((s) => s.connected);
  const settings = useDiscoStore();
  const calm = useMemo(() => reducedMotion(), []);

  const dialogRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  useFocusTrap(dialogRef, !!song && !adjustOpen, () => navigate(-1));
  const [chrome, setChrome] = useState(true);
  // Hiding the controls also hides the phone's status and navigation bars, so
  // the lights fill the whole screen; showing them (or leaving) gives the bars back.
  const fsRequested = useRef(false);
  const leaveFullscreen = () => {
    if (fsRequested.current && document.fullscreenElement && typeof document.exitFullscreen === 'function') void document.exitFullscreen().catch(() => undefined);
    fsRequested.current = false;
  };
  const toggleChrome = () => {
    const hide = chrome;
    setChrome(!hide);
    const root = document.documentElement;
    if (hide && !document.fullscreenElement && typeof root.requestFullscreen === 'function') {
      fsRequested.current = true;
      root.requestFullscreen().catch(() => {
        fsRequested.current = false;
      });
    } else if (!hide) {
      leaveFullscreen();
    }
  };
  // The system back gesture can leave full screen on its own: bring the controls back with it.
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement && fsRequested.current) {
        fsRequested.current = false;
        setChrome(true);
      }
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      if (fsRequested.current && document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
    };
  }, []);
  const [source, setSource] = useState<BeatSource>('starting');
  const [bpm, setBpm] = useState<number | null>(null);
  const [art, setArt] = useState<string | null>(null);

  // The music can only be read where the sound chain can run on this device.
  const canHear = !iosWeb() && !casting;

  // Ask the engine for the analyser while the lights are open; keep the screen on.
  useEffect(() => {
    audioEngine.setAnalysisEnabled(true);
    void acquireWakeLock();
    return () => {
      audioEngine.setAnalysisEnabled(false);
      releaseWakeLock();
    };
  }, []);

  // Song colours: the cover's main colour.
  const cover = song ? bestImage(song.images, 150) : '';
  useEffect(() => {
    let live = true;
    setArt(null);
    if (cover) void extractVibrantColor(cover).then((c) => live && setArt(c));
    return () => {
      live = false;
    };
  }, [cover]);

  // Everything the animation loop reads lives in refs, so the loop never restarts.
  const live = useRef({ settings, art, isPlaying, canHear, calm, tapBpm: null as number | null, taps: [] as number[] });
  live.current.settings = settings;
  live.current.art = art;
  live.current.isPlaying = isPlaying;
  live.current.canHear = canHear;

  const detector = useRef(new BeatDetector());
  useEffect(() => {
    detector.current.reset();
  }, [song?.id]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let fx: typeof import('@/services/audio/effects') | null = null;
    void import('@/services/audio/effects').then((m) => (fx = m)).catch(() => undefined);

    const renderer = new DiscoRenderer();
    let w = 0;
    let h = 0;
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    let spectrum: Uint8Array<ArrayBuffer> | null = null;
    let raf = 0;
    let last = performance.now();
    let silentFor = 0;
    let mode: BeatSource = 'starting';
    let shownBpm: number | null = null;
    let nextSynth = 0;
    let synthPhase = 0;

    const report = (m: BeatSource, b: number | null) => {
      if (m !== mode) {
        mode = m;
        setSource(m);
      }
      if (b !== shownBpm) {
        shownBpm = b;
        setBpm(b);
      }
    };

    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      const L = live.current;
      const d = detector.current;
      d.sensitivity = L.settings.sensitivity;
      let input: LightInput = { beat: false, strength: 0, level: 0, sparkle: 0 };

      if (L.isPlaying) {
        // 1 — the music itself.
        let frame: BeatFrame | null = null;
        if (!L.canHear) {
          silentFor = LIVE_WAIT_MS;
        } else if (!fx) {
          silentFor += dt; // the chain's module is still loading
        } else {
          if (!spectrum) spectrum = new Uint8Array(fx.SPECTRUM_BINS);
          const binHz = fx.readSpectrum(spectrum);
          let sum = 0;
          if (binHz > 0) for (let i = 0; i < 64; i += 1) sum += spectrum[i];
          if (binHz > 0 && sum > 0) {
            silentFor = 0;
            frame = d.push(spectrum, binHz, now);
          } else {
            silentFor += dt;
          }
        }

        if (frame) {
          input = frame;
          report('live', frame.bpm);
        } else if (silentFor >= LIVE_WAIT_MS || mode === 'rhythm') {
          // 2 — a steady rhythm: the tapped tempo, else the last one heard, else 120.
          const tempo = L.tapBpm ?? d.bpm ?? DEFAULT_BPM;
          const period = 60_000 / tempo;
          synthPhase = (synthPhase + dt / period) % 1;
          const beat = now >= nextSynth;
          if (beat) {
            nextSynth = now + period;
            synthPhase = 0;
          }
          const level = 0.45 + 0.4 * Math.exp(-synthPhase * 4);
          input = { beat, strength: beat ? 1.3 : 0, level, sparkle: 0.3 + 0.3 * Math.sin(now / 180) ** 2 };
          report('rhythm', tempo);
        }
      } else {
        silentFor = 0;
      }

      const s = L.settings;
      renderer.frame(ctx, w, h, dt, input, {
        style: s.style,
        hues: paletteHues(s.palette, L.art),
        brightness: s.brightness * (L.isPlaying ? 1 : 0.45),
        speed: s.speed,
        flash: s.flash,
        calm: L.calm,
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  const tap = () => {
    const L = live.current;
    const now = performance.now();
    L.taps = [...L.taps, now].slice(-8);
    const b = tapTempo(L.taps);
    if (b) L.tapBpm = b;
  };

  if (!song) {
    return <EmptyState title="Nothing playing" message="Start a song, then turn on the disco lights." action={<Link to="/" className="vx-tap px-5 py-2.5 rounded-full btn-primary">Browse</Link>} />;
  }

  const status = !isPlaying
    ? 'Paused'
    : source === 'live'
      ? bpm
        ? `Following the beat · ${bpm} BPM`
        : 'Following the beat'
      : source === 'rhythm'
        ? `${canHear ? 'Can’t hear this song' : casting ? 'Casting' : 'Beat can’t be read here'} · steady ${bpm ?? DEFAULT_BPM} BPM, tap to match`
        : 'Listening for the beat…';

  return createPortal(
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Disco lights" className={cn('vx-disco', !chrome && 'is-bare')}>
      <canvas ref={canvasRef} className="vx-disco-canvas" aria-hidden onClick={toggleChrome} />

      <div className="vx-disco-top">
        <button type="button" onClick={() => navigate(-1)} aria-label="Exit disco lights" className="vx-disco-btn">
          <ChevronDownIcon />
        </button>
        <div className="vx-disco-head">
          <p className="vx-disco-name">Disco lights</p>
          <p className="vx-disco-status" role="status" aria-live="polite">{status}</p>
        </div>
        <button type="button" onClick={() => setAdjustOpen(true)} aria-label="Adjust lights" className="vx-disco-btn">
          <SettingsIcon />
        </button>
      </div>

      <div className="vx-disco-bottom">
        <div className="vx-disco-song">
          <p className="vx-disco-title line-clamp-1">{song.title}</p>
          <p className="vx-disco-artist line-clamp-1">{song.subtitle}</p>
        </div>
        <div className="vx-disco-transport">
          <button type="button" onClick={prev} aria-label="Previous" className="vx-disco-btn">
            <PrevIcon />
          </button>
          <button type="button" onClick={togglePlay} aria-label={isPlaying ? 'Pause' : 'Play'} className="vx-disco-play">
            {isPlaying ? <PauseIcon /> : <PlayIcon className="ml-1" />}
          </button>
          <button type="button" onClick={() => next(true)} aria-label="Next" className="vx-disco-btn">
            <NextIcon />
          </button>
        </div>
        {source === 'rhythm' && (
          <button type="button" onClick={tap} className="vx-disco-tap">
            Tap the beat
          </button>
        )}
      </div>

      <DiscoAdjustSheet open={adjustOpen} onClose={() => setAdjustOpen(false)} calm={calm} />
    </div>,
    document.body,
  );
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const sensitivityLabel = (v: number) => (v < 0.34 ? 'Low' : v < 0.67 ? 'Medium' : 'High');

function DiscoAdjustSheet({ open, onClose, calm }: { open: boolean; onClose: () => void; calm: boolean }) {
  const s = useDiscoStore();
  return (
    <Sheet open={open} onClose={onClose} labelledBy="vx-disco-adjust" size="sm" backdropClassName="bg-black/30">
      <SheetHeader id="vx-disco-adjust" title="Adjust lights" onClose={onClose} />
      <div className="vx-disco-adjust">
        <section>
          <h3 className="vx-disco-label">Style</h3>
          <div className="vx-disco-chips">
            {DISCO_STYLES.map((st) => (
              <Chip key={st.id} active={s.style === st.id} onClick={() => s.set({ style: st.id })}>
                {st.label}
              </Chip>
            ))}
          </div>
          <p className="vx-disco-hint">{DISCO_STYLES.find((st) => st.id === s.style)?.hint}</p>
        </section>
        <section>
          <h3 className="vx-disco-label">Colours</h3>
          <div className="vx-disco-chips">
            {DISCO_PALETTES.map((p) => (
              <Chip key={p.id} active={s.palette === p.id} onClick={() => s.set({ palette: p.id })}>
                {p.label}
              </Chip>
            ))}
          </div>
        </section>
        <Slider label="Brightness" value={s.brightness} min={0.2} max={MAX_BRIGHTNESS} step={0.05} format={pct} onChange={(brightness) => s.set({ brightness })} />
        <Slider label="Beat sensitivity" value={s.sensitivity} min={0} max={1} step={0.05} format={sensitivityLabel} onChange={(sensitivity) => s.set({ sensitivity })} />
        <Slider label="Motion speed" value={s.speed} min={0.25} max={2} step={0.05} format={pct} onChange={(speed) => s.set({ speed })} />
        <Switch
          checked={s.flash && !calm}
          disabled={calm}
          onChange={(flash) => s.set({ flash })}
          label="Flash on strong beats"
          description={
            calm
              ? 'Off while your device asks for reduced motion.'
              : 'Bright white flashes, never more than three a second. Leave this off if flashing light affects you.'
          }
        />
        <button type="button" onClick={s.resetAll} className="vx-disco-reset">
          Reset to default
        </button>
      </div>
    </Sheet>
  );
}
