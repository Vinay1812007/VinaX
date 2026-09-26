import { useToastStore } from '@/store/toastStore';

export function Toasts() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  const pause = useToastStore((s) => s.pause);
  const resume = useToastStore((s) => s.resume);
  // The live region is ALWAYS in the DOM: a region that mounts together with
  // its first message is not announced by most screen readers. One polite
  // region for the stack — no per-toast role, which double-announced.
  // Sits above the mini-player + dock on mobile (the token includes the
  // bottom safe-area inset).
  return (
    <div
      role="status"
      aria-live="polite"
      onPointerEnter={pause}
      onPointerLeave={resume}
      onFocus={pause}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) resume();
      }}
      // 8.0 — compact pills, bottom-centre, just above the phone mini-player +
      // tab bar (the token includes the safe-area inset) or the desktop
      // player bar. Newest at the bottom, nearest the thumb.
      className="fixed bottom-[calc(var(--player-safe-offset)+0.75rem)] md:bottom-[calc(var(--vx-player-h,80px)+1rem)] inset-x-0 z-50 flex flex-col items-center gap-2 pointer-events-none px-4"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className="flex items-center gap-1 max-w-[min(420px,100%)] min-h-[44px] pl-4 pr-1.5 py-1.5 rounded-[22px] bg-ink-100 text-ink-950 text-[14px] font-semibold leading-snug shadow-[0_10px_28px_-8px_rgba(0,0,0,0.5)] animate-fade-up pointer-events-auto"
        >
          <span className={t.action ? 'min-w-0 py-1' : 'min-w-0 py-1 pr-2.5'}>{t.message}</span>
          {t.action && (
            <button
              type="button"
              onClick={() => {
                t.action?.onClick();
                dismiss(t.id);
              }}
              // A quiet tinted text button inside the pill (reads on the inverse
              // surface in both themes); the pad keeps the hit box at 44px.
              className="relative shrink-0 min-h-[32px] px-3 rounded-full text-[13px] font-bold text-ink-950 bg-ink-950/10 hover:bg-ink-950/15 after:absolute after:-inset-y-1.5 after:inset-x-0 after:content-['']"
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
