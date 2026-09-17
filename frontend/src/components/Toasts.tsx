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
      className="fixed bottom-[calc(var(--player-safe-offset)+0.75rem)] sm:bottom-[calc(var(--player-safe-offset)+1.75rem)] md:bottom-24 inset-x-0 z-50 flex flex-col items-center gap-2 pointer-events-none px-4"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className="flex items-center gap-3 px-4 py-2.5 rounded-md bg-ink-100 text-ink-950 text-sm font-semibold shadow-[0_8px_24px_rgba(0,0,0,0.35)] animate-fade-up pointer-events-auto"
        >
          <span>{t.message}</span>
          {t.action && (
            <button
              type="button"
              onClick={() => {
                t.action?.onClick();
                dismiss(t.id);
              }}
              className="shrink-0 px-2.5 py-1 rounded-full bg-ink-950 text-ink-100 text-[12px] font-bold"
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
