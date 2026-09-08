import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { router } from '@/router';
import { useTutorialStore } from '@/store/tutorialStore';
import { usePlayerStore } from '@/store/playerStore';
import { tutorialById } from '@/features/tutorials/tutorials';
import { cn } from '@/utils/cn';

/**
 * v5.20.0 — the live tutorial runner. Lazy chunk, mounted at the app root by
 * TutorialHost. Spotlights the real control for each step (a box with a huge
 * box-shadow dims everything else), places the card beside it, and runs the
 * step's action (navigate, start music) before looking the target up.
 * Keyboard: → / Enter next, ← back, Esc leave.
 */
interface Rect { top: number; left: number; width: number; height: number }

function findTarget(selector: string | undefined): Element | null {
  if (!selector) return null;
  const els = Array.from(document.querySelectorAll(selector));
  // Prefer a visible match (the player bar has a mobile and a desktop copy).
  return els.find((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
  }) ?? null;
}

export default function TutorialRunner() {
  const activeId = useTutorialStore((s) => s.activeId);
  const step = useTutorialStore((s) => s.step);
  const go = useTutorialStore((s) => s.go);
  const stop = useTutorialStore((s) => s.stop);
  const finish = useTutorialStore((s) => s.finish);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const tutorial = tutorialById(activeId);
  const current = tutorial?.steps[step];
  const [rect, setRect] = useState<Rect | null>(null);
  const [ready, setReady] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const runId = useRef(0);

  // Enter a step: route, action, then look the target up (up to 4 s).
  useEffect(() => {
    if (!tutorial || !current) return;
    const id = ++runId.current;
    setReady(false);
    setRect(null);
    let cancelled = false;
    (async () => {
      if (current.route && window.location.pathname !== current.route) {
        await router.navigate(current.route);
        await new Promise((r) => window.setTimeout(r, 350));
      }
      if (cancelled || id !== runId.current) return;
      try {
        await current.action?.();
      } catch {
        /* a failed action never blocks the walkthrough */
      }
      if (cancelled || id !== runId.current) return;
      const deadline = Date.now() + 4000;
      let el = findTarget(current.target);
      while (!el && current.target && Date.now() < deadline && !cancelled) {
        await new Promise((r) => window.setTimeout(r, 120));
        el = findTarget(current.target);
      }
      if (cancelled || id !== runId.current) return;
      if (el) {
        el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        await new Promise((r) => window.setTimeout(r, 250));
      }
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [tutorial, current, step]);

  // Track the target's box while the step is shown (scroll, resize, layout).
  useLayoutEffect(() => {
    if (!ready || !current?.target) return;
    let raf = 0;
    const tick = () => {
      const el = findTarget(current.target);
      if (el) {
        const r = el.getBoundingClientRect();
        setRect({ top: r.top - 6, left: r.left - 6, width: r.width + 12, height: r.height + 12 });
      } else setRect(null);
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [ready, current]);

  const total = tutorial?.steps.length ?? 0;
  const next = useCallback(() => {
    if (!tutorial) return;
    if (step >= total - 1) finish();
    else go(step + 1);
  }, [tutorial, step, total, finish, go]);
  const back = useCallback(() => go(step - 1), [go, step]);

  useEffect(() => {
    if (!tutorial) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'Escape') { e.preventDefault(); stop(); }
      else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft' && step > 0) { e.preventDefault(); back(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tutorial, step, next, back, stop]);

  useEffect(() => {
    cardRef.current?.focus();
  }, [step, ready]);

  if (!tutorial || !current) return null;

  // Card placement: beside the spotlight when there is one, else centred.
  const cardW = Math.min(380, window.innerWidth - 24);
  let cardStyle: React.CSSProperties = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: cardW };
  if (rect) {
    const below = current.placement !== 'top' && rect.top + rect.height + 220 < window.innerHeight;
    const above = current.placement === 'top' || !below;
    const left = Math.max(12, Math.min(window.innerWidth - cardW - 12, rect.left + rect.width / 2 - cardW / 2));
    cardStyle = above
      ? { left, bottom: Math.max(12, window.innerHeight - rect.top + 12), width: cardW }
      : { left, top: rect.top + rect.height + 12, width: cardW };
  }

  return (
    <div className="fixed inset-0 z-[90]" role="dialog" aria-modal="true" aria-label={`Tutorial: ${tutorial.title}`}>
      {/* Spotlight: the box-shadow dims everything but the target; the target stays clickable. */}
      {rect ? (
        <div
          aria-hidden
          className="fixed rounded-2xl pointer-events-none transition-[top,left,width,height] duration-200"
          style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height, boxShadow: '0 0 0 9999px rgba(0,0,0,0.62), 0 0 0 2px rgb(var(--ember-500)), 0 0 30px rgb(var(--ember-500) / 0.5)' }}
        />
      ) : (
        <div aria-hidden className="fixed inset-0 bg-black/62" onClick={stop} />
      )}
      <div
        ref={cardRef}
        tabIndex={-1}
        className={cn('fixed glass-modal rounded-3xl p-5 shadow-2xl outline-none animate-fade-up', !ready && 'opacity-90')}
        style={cardStyle}
      >
        <div className="flex items-center justify-between gap-3 mb-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-ink-400">
            {tutorial.emoji} {tutorial.title} · {step + 1}/{total}
          </p>
          {tutorial.playsMusic && isPlaying && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-ember-400"><span className="w-1.5 h-1.5 rounded-full bg-ember-400 animate-pulse" /> playing</span>
          )}
        </div>
        <h2 className="text-lg font-extrabold tracking-tight">{current.title}</h2>
        <p className="mt-1.5 text-sm text-ink-200 leading-relaxed">{ready || !current.target ? current.body : 'Getting things ready…'}</p>
        {current.tip && <p className="mt-2 text-[11px] text-ink-400">{current.tip}</p>}
        <div className="mt-3 flex items-center gap-1.5" aria-hidden>
          {tutorial.steps.map((_, i) => (
            <span key={i} className={i === step ? 'w-5 h-1.5 rounded-full bg-ember-500' : 'w-1.5 h-1.5 rounded-full bg-ink-600'} />
          ))}
        </div>
        <div className="mt-4 flex items-center gap-2">
          <button onClick={stop} className="text-xs font-bold text-ink-400 hover:text-ink-100 px-2 py-2">Skip</button>
          <div className="flex-1" />
          {step > 0 && (
            <button onClick={back} className="btn-secondary px-4 py-2 text-sm">Back</button>
          )}
          <button onClick={next} className="btn-primary px-5 py-2 text-sm">{step >= total - 1 ? 'Done' : 'Next'}</button>
        </div>
      </div>
    </div>
  );
}
