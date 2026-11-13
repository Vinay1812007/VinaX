import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Button, IconButton, Slider } from '@/components/ui';
import { HeartIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon, ChevronDownIcon, ShuffleIcon, RepeatIcon } from '@/components/Icons';
import { animate, stagger, withViewTransition, DURATION, type EasingToken } from '@/utils/motion';
import { Section, Sub } from './Foundations';

const CURVES: { token: EasingToken; css: string; use: string }[] = [
  { token: 'standard', css: '--ease-standard', use: 'Things moving on screen' },
  { token: 'enter', css: '--ease-enter', use: 'Things arriving' },
  { token: 'exit', css: '--ease-exit', use: 'Things leaving' },
  { token: 'spring', css: '--ease-spring', use: 'Sheets, toggles, tabs' },
  { token: 'bounce', css: '--ease-bounce', use: 'Likes and celebrations' },
];

const DURATIONS = Object.entries(DURATION) as [keyof typeof DURATION, number][];

const STAGGER_ITEMS = ['Morning acoustic', 'Telugu hits', 'Lo-fi focus', 'Road trip', 'Late night', 'Devotional'];

export function MotionSection() {
  const [played, setPlayed] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);

  const replayStagger = () => {
    listRef.current?.querySelectorAll('li').forEach((li, i) => {
      animate(li, [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 'slow', easing: 'enter', delay: stagger(i, 40), fill: 'backwards' });
    });
  };

  return (
    <Section id="motion" title="Motion" lead="Five durations by job, five curves by direction. Everything collapses to an instant change under reduced motion, from the OS or from Settings.">
      <Sub title="Curves">
        <div className="vx-ds-curves" data-played={played}>
          {CURVES.map((c) => (
            <div key={c.token} className="vx-ds-curve">
              <div className="vx-ds-curve-meta"><strong>{c.token}</strong><span>{c.use}</span><code>{c.css}</code></div>
              <div className="vx-ds-track"><span style={{ transitionTimingFunction: `var(${c.css})` }} /></div>
            </div>
          ))}
        </div>
        <Button variant="tonal" size="sm" onClick={() => setPlayed((p) => !p)}>{played ? 'Play back' : 'Play curves'}</Button>
      </Sub>
      <Sub title="Durations">
        <div className="vx-ds-durs">
          {DURATIONS.map(([k, ms]) => (
            <div key={k} className="vx-ds-dur"><code>--dur-{k}</code><span>{ms} ms</span></div>
          ))}
        </div>
      </Sub>
      <Sub title="Staggered reveal">
        <ul ref={listRef} className="vx-ds-stagger">
          {STAGGER_ITEMS.map((t, i) => (
            <li key={t}><span className="vx-ds-art" data-art={i % 6} aria-hidden />{t}</li>
          ))}
        </ul>
        <Button variant="tonal" size="sm" onClick={replayStagger}>Replay</Button>
      </Sub>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Mini player → Now Playing: one shared element transition.
// ---------------------------------------------------------------------------

function fmt(s: number) {
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

export function PlayerDemo() {
  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [liked, setLiked] = useState(false);
  const [pos, setPos] = useState(74);
  const heartRef = useRef<HTMLButtonElement>(null);
  const toggle = (next: boolean) => void withViewTransition(() => flushSync(() => setOpen(next)));
  const like = () => {
    setLiked((l) => !l);
    animate(heartRef.current, [{ transform: 'scale(1)' }, { transform: 'scale(1.3)' }, { transform: 'scale(1)' }], { duration: 'slow', easing: 'bounce' });
  };

  return (
    <Section id="player" title="Player" lead="The mini player opens into Now Playing as one continuous move: the artwork and title travel, everything else cross-fades.">
      <div className="vx-ds-stage">
        {!open ? (
          <div className="vx-ds-mini vx-mat-chrome">
            <button type="button" className="vx-ds-mini-open" onClick={() => toggle(true)} aria-label="Open Now Playing">
              <span className="vx-ds-art vx-ds-vt-art" data-art={1} aria-hidden />
              <span className="vx-ds-mini-text">
                <strong className="vx-ds-vt-title">Hridayam</strong>
                <span>Hesham Abdul Wahab</span>
              </span>
            </button>
            <IconButton label={liked ? 'Unlike' : 'Like'} pressed={liked} onClick={like} ref={heartRef} className="vx-ds-like">
              <HeartIcon filled={liked} />
            </IconButton>
            <IconButton label={playing ? 'Pause' : 'Play'} variant="solid" onClick={() => setPlaying((p) => !p)}>
              {playing ? <PauseIcon /> : <PlayIcon />}
            </IconButton>
            <span className="vx-ds-mini-progress" style={{ ['--p' as string]: `${(pos / 222) * 100}%` }} aria-hidden />
          </div>
        ) : (
          <div className="vx-ds-full" role="region" aria-label="Now Playing">
            <div className="vx-ds-full-bg" aria-hidden />
            <div className="vx-ds-full-top">
              <IconButton label="Close Now Playing" variant="tonal" size="sm" onClick={() => toggle(false)}><ChevronDownIcon /></IconButton>
              <span className="vx-ds-overline">Playing from Malayalam Hits</span>
              <span className="w-9" />
            </div>
            <span className="vx-ds-art vx-ds-art--xl vx-ds-vt-art" data-art={1} aria-hidden />
            <div className="vx-ds-full-meta">
              <div className="min-w-0">
                <strong className="vx-ds-vt-title">Hridayam</strong>
                <span>Hesham Abdul Wahab</span>
              </div>
              <IconButton label={liked ? 'Unlike' : 'Like'} pressed={liked} onClick={like} ref={heartRef} className="vx-ds-like">
                <HeartIcon filled={liked} />
              </IconButton>
            </div>
            <div className="vx-ds-seek">
              <Slider label="Position" value={pos} max={222} onChange={setPos} format={fmt} className="vx-ds-seek-slider" />
              <div className="vx-ds-seek-times" aria-hidden><span>{fmt(pos)}</span><span>-{fmt(222 - pos)}</span></div>
            </div>
            <div className="vx-ds-controls">
              <IconButton label="Shuffle"><ShuffleIcon /></IconButton>
              <IconButton label="Previous" size="lg"><PrevIcon /></IconButton>
              <IconButton label={playing ? 'Pause' : 'Play'} variant="solid" size="xl" onClick={() => setPlaying((p) => !p)}>
                {playing ? <PauseIcon /> : <PlayIcon />}
              </IconButton>
              <IconButton label="Next" size="lg"><NextIcon /></IconButton>
              <IconButton label="Repeat"><RepeatIcon /></IconButton>
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}
