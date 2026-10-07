import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { router } from '@/router';
import { useTutorialStore } from '@/store/tutorialStore';
import { usePlayerStore } from '@/store/playerStore';
import { tutorialById } from '@/features/tutorials/tutorials';
import { scrollBehavior } from '@/utils/motion';

/**
 * v5.20.0 — the live tutorial runner. Lazy chunk, mounted at the app root by
 * TutorialHost. Spotlights the real control for each step (a box with a huge
 * box-shadow dims everything else), places the card beside it, and runs the
 * step's action (navigate, start music) before looking the target up.
 * Keyboard: → / Enter next, ← back, Esc leave; Tab stays inside the card.
 *
 * 11.0 rewrite — the target is kept clear of the bottom chrome (the phone tab
 * bar, a flat bar or a floating island depending on the app style, and the
 * mini player), the card is placed from its measured height, a step whose
 * anchor is missing is skipped instead of pointing at nothing, each step is
 * announced through a live region, and focus returns to the opener on close.
 */
interface Rect { top: number; left: number; width: number; height: number }

/** How long a step waits for its anchor before it is skipped. */
const ANCHOR_WAIT_MS = 2500;
/** Bottom chrome that can cover a target: the phone tab bar and the player bar. */
const CHROME = '.vx-dock, [data-tour="player"]';

function findTarget(selector: string | undefined): Element | null {
  if (!selector) return null;
  const els = Array.from(document.querySelectorAll(selector));
  // Prefer a visible match (the player bar has a mobile and a desktop copy).
  return els.find((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
  }) ?? null;
}

/** The y above which a target is clear of the tab bar and mini player. */
function clearBottom(target: Element): number {
  let y = window.innerHeight;
  document.querySelectorAll(CHROME).forEach((el) => {
    if (el.contains(target) || target.contains(el)) return;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && r.top > window.innerHeight / 2) y = Math.min(y, r.top);
  });
  return y;
}

/** Scroll the target's own scroller so it sits above the bottom chrome and below the top bar. */
function keepClear(target: Element): void {
  const r = target.getBoundingClientRect();
  const bar = document.querySelector('.vx-topbar')?.getBoundingClientRect();
  const top = bar && bar.bottom < window.innerHeight / 2 && !document.querySelector('.vx-topbar')?.contains(target) ? bar.bottom : 0;
  const over = r.bottom + 14 - clearBottom(target);
  const under = top + 14 - r.top;
  const by = over > 0 ? over : under > 0 ? -under : 0;
  if (!by) return;
  let el = target.parentElement;
  while (el) {
    const o = getComputedStyle(el).overflowY;
    if ((o === 'auto' || o === 'scroll') && el.scrollHeight > el.clientHeight + 1) break;
    el = el.parentElement;
  }
  (el ?? window).scrollBy({ top: by, behavior: 'auto' });
}

const pause = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

export default function TutorialRunner() {
  const activeId = useTutorialStore((s) => s.activeId);
  const step = useTutorialStore((s) => s.step);
  const go = useTutorialStore((s) => s.go);
  const stop = useTutorialStore((s) => s.stop);
  const finish = useTutorialStore((s) => s.finish);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const tutorial = tutorialById(activeId);
  const current = tutorial?.steps[step];
  const total = tutorial?.steps.length ?? 0;
  const [rect, setRect] = useState<Rect | null>(null);
  const [ready, setReady] = useState(false);
  const [cardH, setCardH] = useState(240);
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  const cardRef = useRef<HTMLDivElement>(null);
  const runId = useRef(0);
  /** Direction of travel, so a missing anchor is skipped the way the listener was going. */
  const dir = useRef<1 | -1>(1);

  // Focus returns to whatever opened the tour (the Help tile, the welcome sheet's button).
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    return () => {
      if (opener?.isConnected) opener.focus?.({ preventScroll: true });
    };
  }, []);

  // Enter a step: route, action, then wait for the anchor.
  useEffect(() => {
    if (!tutorial || !current) return;
    const id = ++runId.current;
    setReady(false);
    setRect(null);
    let cancelled = false;
    const live = () => !cancelled && id === runId.current;
    (async () => {
      if (current.route && window.location.pathname !== current.route) {
        await router.navigate(current.route);
        await pause(350);
      }
      if (!live()) return;
      try {
        await current.action?.();
      } catch {
        /* a failed action never blocks the walkthrough */
      }
      if (!live()) return;
      if (current.target) {
        const deadline = Date.now() + ANCHOR_WAIT_MS;
        let el = findTarget(current.target);
        while (!el && Date.now() < deadline && live()) {
          await pause(120);
          el = findTarget(current.target);
        }
        if (!live()) return;
        if (!el) {
          // The anchor is not on this screen (a control that is hidden for this
          // listener, a layout that dropped it). Move on in the direction of
          // travel; at either end the card is shown centred, with no spotlight.
          const to = step + dir.current;
          if (to >= 0 && to < total) {
            go(to);
            return;
          }
        } else {
          el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: scrollBehavior() });
          await pause(250);
          if (!live()) return;
          keepClear(el);
        }
      }
      setReady(true);
    })();
    return () => {
      cancelled = true;
      try {
        current.leave?.();
      } catch {
        /* leaving a step never throws into React */
      }
    };
  }, [tutorial, current, step, total, go]);

  // Follow the target's box while the step is shown (scroll, resize, layout shifts).
  useLayoutEffect(() => {
    if (!ready || !current?.target) return;
    let raf = 0;
    let last = '';
    const tick = () => {
      const el = findTarget(current.target);
      const r = el?.getBoundingClientRect();
      const next = r ? { top: r.top - 6, left: r.left - 6, width: r.width + 12, height: r.height + 12 } : null;
      const key = next ? `${next.top}|${next.left}|${next.width}|${next.height}` : '';
      if (key !== last) {
        last = key;
        setRect(next);
      }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [ready, current]);

  // The card is placed from the real viewport and its own measured height.
  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.visualViewport?.height ?? window.innerHeight });
    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
    };
  }, []);
  useLayoutEffect(() => {
    const h = cardRef.current?.offsetHeight;
    if (h && Math.abs(h - cardH) > 1) setCardH(h);
  }, [step, ready, rect, vp, cardH]);

  const next = useCallback(() => {
    if (!tutorial) return;
    dir.current = 1;
    if (step >= total - 1) finish();
    else go(step + 1);
  }, [tutorial, step, total, finish, go]);
  const back = useCallback(() => {
    if (step <= 0) return;
    dir.current = -1;
    go(step - 1);
  }, [go, step]);

  useEffect(() => {
    if (!tutorial) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); stop(); return; }
      if (e.key === 'Tab') {
        // Keep Tab inside the card: the page behind is dimmed, not operable by keyboard.
        const stops = Array.from(cardRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? []);
        if (!stops.length) return;
        const at = stops.indexOf(document.activeElement as HTMLElement);
        e.preventDefault();
        stops[(at + (e.shiftKey ? -1 : 1) + stops.length) % stops.length].focus();
        return;
      }
      if (typing) return;
      // Enter on a focused button is that button's own click.
      if (e.key === 'Enter' && t?.closest('button, a')) return;
      if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); back(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [tutorial, next, back, stop]);

  // Focus enters the card once per step, unless it is already on one of its buttons.
  useEffect(() => {
    if (!cardRef.current?.contains(document.activeElement)) cardRef.current?.focus({ preventScroll: true });
  }, [step, ready]);

  if (!tutorial || !current) return null;

  const cardW = Math.min(380, vp.w - 24);
  // Without a spotlight the card is centred with `inset-0 m-auto h-fit`, NOT a
  // translate: the enter animation animates `transform` and would override it.
  let cardStyle: React.CSSProperties = { width: cardW };
  if (rect) {
    const gap = 12;
    const roomBelow = vp.h - (rect.top + rect.height) - gap * 2;
    const roomAbove = rect.top - gap * 2;
    const below = current.placement === 'top'
      ? roomAbove < cardH && roomBelow > roomAbove
      : roomBelow >= cardH || roomBelow >= roomAbove;
    const top = below ? rect.top + rect.height + gap : rect.top - gap - cardH;
    cardStyle = {
      width: cardW,
      left: Math.max(12, Math.min(vp.w - cardW - 12, rect.left + rect.width / 2 - cardW / 2)),
      top: Math.max(12, Math.min(vp.h - cardH - 12, top)),
    };
  }
  const titleId = `vx-tut-title-${step}`;
  const showBody = ready || !current.target;

  return (
    <div
      className="vx-tut fixed inset-0 z-[90]"
      role="dialog"
      aria-modal="true"
      aria-label={`Tutorial: ${tutorial.title}`}
      data-step={step}
      data-ready={ready ? 'true' : 'false'}
      data-anchor={!current.target ? 'none' : rect ? 'found' : 'pending'}
    >
      {/* Spotlight: the box-shadow dims everything but the target; the target stays clickable. */}
      {rect ? (
        <div
          aria-hidden
          className="vx-tut-spot fixed pointer-events-none"
          style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
        />
      ) : (
        <div aria-hidden className="fixed inset-0 bg-black/62" onClick={stop} />
      )}
      <p className="sr-only" role="status" aria-live="polite">
        {showBody ? `Step ${step + 1} of ${total}. ${current.title}. ${current.body}` : ''}
      </p>
      <div
        ref={cardRef}
        tabIndex={-1}
        aria-labelledby={titleId}
        className={`vx-tut-card vx-mat-thick fixed outline-none animate-fade-up${rect ? '' : ' inset-0 m-auto h-fit max-w-[calc(100vw-24px)]'}`}
        style={cardStyle}
      >
        <div className="flex items-center justify-between gap-3 mb-2">
          <p className="text-[12px] font-bold text-ink-400">
            {tutorial.title} <span className="tabular-nums">· {step + 1} of {total}</span>
          </p>
          {tutorial.playsMusic && isPlaying && (
            <span className="inline-flex items-center gap-1.5 text-[12px] font-bold text-ink-300"><span className="w-1.5 h-1.5 rounded-full bg-ember-500" /> Playing</span>
          )}
        </div>
        <h2 id={titleId} className="text-[18px] font-[750] tracking-[-0.015em]">{current.title}</h2>
        <p className="mt-1.5 text-[14px] text-ink-200 leading-relaxed">{showBody ? current.body : 'Getting things ready…'}</p>
        {current.tip && showBody && <p className="mt-2 text-[13px] text-ink-400">{current.tip}</p>}
        <div className="mt-3 flex items-center gap-1.5" aria-hidden>
          {tutorial.steps.map((_, i) => (
            <span key={i} className={i === step ? 'w-4 h-1 rounded-full bg-ember-500' : 'w-1 h-1 rounded-full bg-ink-100/25'} />
          ))}
        </div>
        <div className="mt-4 flex items-center gap-2">
          <button type="button" onClick={stop} className="-ml-2 min-h-[44px] px-2 text-[13px] font-bold text-ink-400 hover:text-ink-100">Close</button>
          <div className="flex-1" />
          {step > 0 && (
            <button type="button" onClick={back} className="btn-secondary px-4 min-h-[44px] text-[14px]">Back</button>
          )}
          <button type="button" onClick={next} className="btn-primary px-5 min-h-[44px] text-[14px]">{step >= total - 1 ? 'Done' : 'Next'}</button>
        </div>
      </div>
    </div>
  );
}
