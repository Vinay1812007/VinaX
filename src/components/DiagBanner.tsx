import { useDiagStore } from '@/store/diagStore';
import { XIcon } from './Icons';

/** Red strip shown when the native media bridge is provably misbehaving. */
export function DiagBanner() {
  const notice = useDiagStore((s) => s.notice);
  const setNotice = useDiagStore((s) => s.setNotice);
  if (!notice) return null;
  return (
    <div className="mx-4 md:mx-8 mt-2 rounded-xl border border-red-500/50 bg-red-500/10 px-3 py-2 flex items-start gap-2">
      <p className="text-[11px] font-mono text-red-200 flex-1 break-all leading-relaxed">{notice}</p>
      <button aria-label="Dismiss" onClick={() => setNotice(null)} className="p-1 text-red-300 shrink-0">
        <XIcon className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
