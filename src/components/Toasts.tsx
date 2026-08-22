import { useToastStore } from '@/store/toastStore';

export function Toasts() {
  const toasts = useToastStore((s) => s.toasts);
  if (!toasts.length) return null;
  return (
    <div className="fixed bottom-40 md:bottom-24 inset-x-0 z-50 flex flex-col items-center gap-2 pointer-events-none px-4">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className="px-4 py-2.5 rounded-full glass-modal border border-[color:var(--glass-border)] text-sm text-ink-100 shadow-lg animate-fade-up"
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
