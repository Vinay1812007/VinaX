import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { festivalClass, type Festival } from '@/constants/festivals';
import { festivalVisual, particleCount } from '@/constants/festivalVisuals';
import { FestivalEmblem } from '@/components/FestivalEmblem';
import { useFestivalNow } from '@/features/festival/festivalPreview';
import { useSettingsStore } from '@/store/settingsStore';
import { getLocal, setLocal } from '@/services/storage/local';
import { STORAGE_PREFIX } from '@/constants/storage-keys';

const SEEN_KEY = `${STORAGE_PREFIX}.festival-splash`;

/** The two national days fly the flag instead of the generic emblem watermark. */
const FLAG_DAYS = new Set(['independence', 'republic']);

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
 * The ambient layer behind the whole app while a skin is on: glow + motif
 * (CSS), one large emblem watermark and a short particle system. Particles are
 * transform/opacity only, capped (see particleCount), paused while the tab is
 * hidden, and absent under reduced motion (either switch) and data saver.
 */
export function FestBackdrop({ festival }: { festival: Festival }) {
  const reduceMotion = useSettingsStore((s) => s.reduceMotion);
  const dataSaver = useSettingsStore((s) => s.dataSaver);
  const [paused, setPaused] = useState(() => typeof document !== 'undefined' && document.hidden);
  useEffect(() => {
    const sync = () => setPaused(document.hidden);
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);
  const visual = festivalVisual(festival.id);
  const motion = festival.backdrop?.motion ?? 'rise';
  const still = reduceMotion || dataSaver
    || (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const count = still ? 0 : particleCount(festival.backdrop?.density, window.innerWidth);
  const flag = !still && FLAG_DAYS.has(festival.id);
  const balls = festival.id === 'independence' ? Math.min(14, Math.max(8, count)) : 0;
  return (
    <div className={`fest-sky${paused ? ' is-paused' : ''}`} data-festival={festival.id} aria-hidden>
      {flag ? <FlagBackdrop balls={balls} /> : <FestivalEmblem id={visual.emblem} className="fest-wm" />}
      {count > 0 && !(flag && balls > 0) && (
        <div className="fest-particles">
          {Array.from({ length: count }, (_, i) => (
            <span
              key={i}
              className={`fest-p fest-p-${motion} fest-p-${visual.particle}${i % 2 ? ' fest-p-alt' : ''}`}
              style={{
                left: `${(i * 61 + 7) % 94}%`,
                top: motion === 'drift' ? `${8 + ((i * 37) % 58)}%` : undefined,
                fontSize: 9 + ((i * 7) % 9),
                animationDelay: `${-((i * 2.3) % 12)}s`,
                animationDuration: `${motion === 'drift' ? 6 + (i % 5) * 1.5 : 13 + (i % 6) * 2.6}s`,
              }}
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
  const backdrop = theme ? <FestBackdrop festival={theme} /> : null;
  if (!visible || !festival || !visual) return backdrop;
  const short = festival.name.split(' · ')[0].replace(/\s*\(.*\)$/, '');

  return (
    <>
      {backdrop}
      <div className="fest-splash" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
        <div ref={cardRef} className="fest-card vx-mat-thick" role="dialog" aria-modal="true" aria-labelledby="fest-title" aria-describedby="fest-blurb" data-festival={festival.id}>
          <FestivalEmblem id={visual.emblem} />
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
