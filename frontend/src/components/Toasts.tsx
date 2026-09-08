import { useToastStore } from '@/store/toastStore';

export function Toasts() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  if (!toasts.length) return null;
  return (
    <div className="fixed bottom-40 md:bottom-24 inset-x-0 z-50 flex flex-col items-center gap-2 pointer-events-none px-4">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className="flex items-center gap-3 px-4 py-2.5 rounded-md bg-ink-100 text-ink-950 text-sm font-semibold shadow-[0_8px_24px_rgba(0,0,0,0.35)] animate-fade-up pointer-events-auto"
        >
          <span>{t.message}</span>
          {t.action && (
            <button
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
