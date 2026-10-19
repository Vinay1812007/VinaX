import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { festivalClass, type Festival } from '@/constants/festivals';
import { ambientPlan, festivalVisual, type FestivalSignature } from '@/constants/festivalVisuals';
import { FestivalEmblem } from '@/components/FestivalEmblem';
import { useFestivalNow } from '@/features/festival/festivalPreview';
import { useSettingsStore } from '@/store/settingsStore';
import { getLocal, setLocal } from '@/services/storage/local';
import { STORAGE_PREFIX } from '@/constants/storage-keys';

const SEEN_KEY = `${STORAGE_PREFIX}.festival-splash`;

/** The two national days fly the flag instead of the generic emblem watermark. */
const FLAG_DAYS = new Set(['independence', 'republic']);

/** Festivals with a drawn scene of their own (art fetched only on those days). */
const DussehraScene = lazy(() => import('@/components/DussehraScene').then((m) => ({ default: m.DussehraScene })));
const SCENE_DAYS = new Set(['dussehra']);

/** Pieces in the one-shot burst behind the greeting card's emblem. */
const BURST_PIECES = 14;

/**
 * True when nothing should move: either reduced-motion switch (the app's own
 * setting or the system preference) or data saver. One rule, read in both
 * places that draw motion, so the backdrop and the greeting card can never
 * disagree about whether this device wants animation.
 */
function useStillMotion(): boolean {
  const reduceMotion = useSettingsStore((s) => s.reduceMotion);
  const dataSaver = useSettingsStore((s) => s.dataSaver);
  return reduceMotion || dataSaver
    || (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

/** 24-spoke chakra, drawn inline; turns slowly via CSS. */
function Chakra() {
  return (
    <svg className="fest-chakra" viewBox="-50 -50 100 100" aria-hidden>
      <circle r="45" fill="none" stroke="currentColor" strokeWidth="6" />
      <circle r="7" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="2.6">
        {Array.from({ length: 24 }, (_, i) => {
          const a = (i * 15 * Math.PI) / 180;
          return <line key={i} x1={Math.sin(a) * 9} y1={-Math.cos(a) * 9} x2={Math.sin(a) * 41} y2={-Math.cos(a) * 41} />;
        })}
      </g>
    </svg>
  );
}

/**
 * Independence Day living backdrop (owner request, 4.17.4): a waving tricolour
 * in the air (nine cloth strips rippling one after another, the chakra turning
 * slowly) and, on Independence Day only, tricolour balls drifting upward.
 * Transform/opacity only, behind content, pointer-events none. Not rendered
 * under reduced motion (either switch) or data saver.
 */
function FlagBackdrop({ balls }: { balls: number }) {
  return (
    <>
      <div className="fest-flag" data-testid="fest-flag">
        {Array.from({ length: 9 }, (_, i) => (
          <i key={i} style={{ animationDelay: `${i * 0.14}s` }} />
        ))}
        <Chakra />
      </div>
      {balls > 0 && (
        <div className="fest-particles">
          {Array.from({ length: balls }, (_, i) => (
            <b
              key={i}
              className={`fest-ball fb${i % 3}`}
              style={{
                left: `${(i * 73 + 9) % 96}%`,
                width: 14 + ((i * 5) % 18),
                height: 14 + ((i * 5) % 18),
                animationDelay: `${-((i * 1.9) % 11)}s`,
                animationDuration: `${10 + (i % 6) * 2.5}s`,
              }}
            />
          ))}
        </div>
      )}
    </>
  );
}

/**
 * The day's own set piece, drawn on top of the ambient layer: fireworks,
 * lamps lit along the bottom, clouds of colour, a sky of stars, or lanterns
 * strung from above. All of it is drawn in CSS from the skin's three colours
 * (see the `.fest-set` block in the generator) — this only places the pieces
 * and gives each its own phase, so none of them move together.
 *
 * Positions are arithmetic on the index, not random: the same festival draws
 * the same arrangement on every open, and the tests can assert it.
 */
function SetPiece({ signature, count }: { signature: FestivalSignature; count: number }) {
  if (signature === 'none' || count < 1) return null;
  return (
    <div className="fest-set" data-signature={signature} data-testid="fest-set">
      {Array.from({ length: count }, (_, i) => {
        switch (signature) {
          case 'fireworks':
            return <b key={i} className="fest-fw" style={{
              left: `${12 + ((i * 29) % 76)}%`,
              top: `${10 + ((i * 23) % 36)}%`,
              animationDelay: `${-((i * 1.7) % 4.6)}s`,
              animationDuration: `${4 + (i % 4) * 0.7}s`,
            }} />;
          case 'diyas':
            // Evenly spaced along the bottom, each lamp in the middle of its
            // own share of the width, so the row reads as a line of lamps.
            return <b key={i} className="fest-diya" style={{
              left: `${((i + 0.5) * 100) / count}%`,
              animationDelay: `${-((i * 0.37) % 1.9)}s`,
            }} />;
          case 'bloom':
            return <b key={i} className="fest-bloom" style={{
              left: `${14 + ((i * 31) % 72)}%`,
              top: `${16 + ((i * 41) % 60)}%`,
              animationDelay: `${-((i * 1.9) % 7.5)}s`,
            }} />;
          case 'twinkle':
            return <b key={i} className="fest-twinkle" style={{
              left: `${4 + ((i * 37) % 92)}%`,
              top: `${5 + ((i * 53) % 70)}%`,
              animationDelay: `${-((i * 0.73) % 4.2)}s`,
              animationDuration: `${3.4 + (i % 5) * 0.6}s`,
            }} />;
          case 'lanterns':
            return <b key={i} className="fest-lamp" style={{
              left: `${8 + ((i * 100) / count)}%`,
              // The cord length is also the pivot the swing turns about.
              // Step and modulus coprime, or 5 % 15 hands out three lengths
              // and the lanterns hang in tiers instead of at mixed heights.
              ['--fest-drop' as string]: `${6 + ((i * 7) % 17)}vh`,
              animationDelay: `${-((i * 1.3) % 6)}s`,
              animationDuration: `${5.2 + (i % 4) * 0.8}s`,
            } as CSSProperties} />;
          default:
            return null;
        }
      })}
    </div>
  );
}

/**
 * The ambient layer behind the whole app while a skin is on: glow + motif
 * (CSS), one large emblem watermark, a short particle system and the day's set
 * piece. Everything is transform/opacity only, capped together by ambientPlan
 * (the set piece spends part of the same budget, so the particles step back),
 * paused while the tab is hidden, and absent under reduced motion (either
 * switch) and data saver.
 */
export function FestBackdrop({ festival }: { festival: Festival }) {
  const still = useStillMotion();
  const [paused, setPaused] = useState(() => typeof document !== 'undefined' && document.hidden);
  useEffect(() => {
    const sync = () => setPaused(document.hidden);
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);
  const visual = festivalVisual(festival.id);
  const motion = festival.backdrop?.motion ?? 'rise';
  const flag = !still && FLAG_DAYS.has(festival.id);
  // Dussehra's scene (Rama, the arrow, Ravanasura) replaces the watermark,
  // and its falling Jammi leaves replace the generic particles.
  const scene = !still && SCENE_DAYS.has(festival.id);
  // The two national days already fly the flag — that IS their set piece, so
  // they do not take a second one and keep their full share of particles.
  const signature = flag ? 'none' : visual.signature;
  const plan = still
    ? { particles: 0, pieces: 0 }
    : ambientPlan(festival.backdrop?.density, signature, window.innerWidth);
  const count = plan.particles;
  const balls = festival.id === 'independence' ? Math.min(14, Math.max(8, count)) : 0;
  return (
    <div className={`fest-sky${paused ? ' is-paused' : ''}`} data-festival={festival.id} aria-hidden>
      {flag ? <FlagBackdrop balls={balls} /> : scene ? null : <FestivalEmblem id={visual.emblem} className="fest-wm" />}
      <SetPiece signature={signature} count={plan.pieces} />
      {scene && (
        <Suspense fallback={null}>
          <DussehraScene leaves={count} />
        </Suspense>
      )}
      {count > 0 && !(flag && balls > 0) && !scene && (
        <div className="fest-particles">
          {Array.from({ length: count }, (_, i) => (
            <span
              key={i}
              className={`fest-p fest-p-${motion} fest-p-${visual.particle}${i % 2 ? ' fest-p-alt' : ''}`}
              style={{
                left: `${(i * 61 + 7) % 94}%`,
                top: motion === 'drift' ? `${8 + ((i * 37) % 58)}%` : undefined,
                fontSize: 9 + ((i * 7) % 9),
                // How far this one wanders either side of its column on the
                // way past. Varying it is what stops the fall reading as rain,
                // so the step and the modulus are coprime — 13 % 26 would only
                // ever have given two widths, alternating.
                ['--fest-sway' as string]: `${9 + ((i * 7) % 23)}px`,
                animationDelay: `${-((i * 2.3) % 12)}s`,
                animationDuration: `${motion === 'drift' ? 6 + (i % 5) * 1.5 : 13 + (i % 6) * 2.6}s`,
              } as CSSProperties}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** How long the real greeting waits after boot for the other first-open sheets to decide. */
export const SETTLE_MS = 1200;

/**
 * True while a modal dialog other than the greeting card is in the page (the
 * welcome sheet, What's new, any sheet). Watches the DOM, because those
 * surfaces keep their open state to themselves.
 */
function useOtherDialogOpen(watch: boolean): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!watch) { setOpen(false); return; }
    const check = () => setOpen(
      Array.from(document.querySelectorAll('[aria-modal="true"]')).some((el) => !el.closest('.fest-splash')),
    );
    check();
    const mo = new MutationObserver(check);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [watch]);
  return open;
}

export function FestiveSplash() {
  const { festival, theme, preview } = useFestivalNow();
  const navigate = useNavigate();
  // Once per festival per year (a preview always shows, and is never recorded).
  const seenKey = festival ? `${festival.id}-${new Date().getFullYear()}` : '';
  const [openFor, setOpenFor] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  // Only watched while the greeting is still owed, so the observer is gone once it has been seen.
  const owed = !!festival && !preview && getLocal<string>(SEEN_KEY, '') !== seenKey;
  const busy = useOtherDialogOpen(owed);

  // A preview opens at once. The real greeting waits a beat (the first-run
  // welcome and the What's-new sheet decide to open just after boot) and then
  // for as long as any other dialog is up, so two dialogs never stack.
  useEffect(() => {
    if (!festival) { setOpenFor(null); return; }
    if (preview) { setOpenFor(festival.id); return; }
    if (getLocal<string>(SEEN_KEY, '') === seenKey) return;
    const id = festival.id;
    const t = window.setTimeout(() => setOpenFor(id), SETTLE_MS);
    return () => window.clearTimeout(t);
  }, [festival, preview, seenKey]);

  // The skin class: from the day before the festival through its last day.
  useEffect(() => {
    const root = document.documentElement;
    const wanted = theme ? festivalClass(theme.id) : null;
    for (const c of Array.from(root.classList)) if (c.startsWith('fest-') && c !== wanted) root.classList.remove(c);
    if (wanted) root.classList.add(wanted);
    return () => {
      for (const c of Array.from(root.classList)) if (c.startsWith('fest-')) root.classList.remove(c);
    };
  }, [theme]);

  const visible = !!festival && openFor === festival.id && (preview || !busy);
  const close = useCallback(() => {
    if (festival && !preview) setLocal(SEEN_KEY, seenKey);
    setOpenFor(null);
  }, [festival, preview, seenKey]);

  // Focus moves into the card and returns to where it was.
  useEffect(() => {
    if (!visible) return;
    const before = document.activeElement as HTMLElement | null;
    cardRef.current?.querySelector<HTMLElement>('button')?.focus();
    return () => before?.focus?.();
  }, [visible]);

  // Escape and the Tab trap listen on the document (capture), so they work even
  // if another surface underneath is holding focus when the card opens.
  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key !== 'Tab') return;
    const items = Array.from(cardRef.current?.querySelectorAll<HTMLElement>('button') ?? []);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const at = document.activeElement;
    if (e.shiftKey && (at === first || !cardRef.current?.contains(at))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (at === last || !cardRef.current?.contains(at))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [visible, close]);

  const visual = useMemo(() => (festival ? festivalVisual(festival.id) : null), [festival]);
  // The card's halo and burst are decoration on top of an entrance the card
  // plays anyway; on a device that asked for stillness they are not drawn at
  // all rather than drawn and then suppressed in CSS.
  const stillCard = useStillMotion();
  const backdrop = theme ? <FestBackdrop festival={theme} /> : null;
  if (!visible || !festival || !visual) return backdrop;
  const short = festival.name.split(' · ')[0].replace(/\s*\(.*\)$/, '');

  return (
    <>
      {backdrop}
      <div className="fest-splash" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
        <div ref={cardRef} className="fest-card vx-mat-thick" role="dialog" aria-modal="true" aria-labelledby="fest-title" aria-describedby="fest-blurb" data-festival={festival.id}>
          <div className="fest-crest">
            <FestivalEmblem id={visual.emblem} />
            {!stillCard && <span className="fest-halo" />}
            {!stillCard && (
              <span className="fest-burst" data-testid="fest-burst">
                {Array.from({ length: BURST_PIECES }, (_, i) => (
                  <i key={i} style={{
                    // Angle round the emblem, how far it is thrown, and how
                    // much it spins on the way — one set of values per piece.
                    ['--fest-a' as string]: `${(i * 360) / BURST_PIECES}deg`,
                    ['--fest-d' as string]: `${64 + ((i * 17) % 46)}px`,
                    ['--fest-s' as string]: `${(i % 2 ? 1 : -1) * (180 + ((i * 53) % 220))}deg`,
                    animationDelay: `${0.2 + (i % 5) * 0.035}s`,
                  } as CSSProperties} />
                ))}
              </span>
            )}
          </div>
          <h2 id="fest-title">{festival.greeting}</h2>
          <p id="fest-blurb">{visual.blurb}</p>
          <div className="fest-actions">
            <button
              type="button"
              className="fest-btn fest-btn-primary"
              onClick={() => { close(); navigate(`/search/${encodeURIComponent(visual.query)}`); }}
            >
              Play {short} songs
            </button>
            <button type="button" className="fest-btn" onClick={close}>Continue</button>
          </div>
        </div>
      </div>
    </>
  );
}
