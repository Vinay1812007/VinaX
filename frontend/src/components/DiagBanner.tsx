import { useDiagStore } from '@/store/diagStore';
import { XIcon } from './Icons';
import { IconButton } from './IconButton';

/** Red strip shown when the native media bridge is provably misbehaving. */
export function DiagBanner() {
  const notice = useDiagStore((s) => s.notice);
  const setNotice = useDiagStore((s) => s.setNotice);
  if (!notice) return null;
  return (
    <div className="mx-4 md:mx-8 mt-2 flex items-start gap-2 rounded-xl bg-ink-850 border-l-2 border-[color:var(--vx-danger)] pl-3 pr-1 py-1">
      <p className="flex-1 py-2 text-[12px] font-mono text-ink-200 break-all leading-relaxed">{notice}</p>
      <IconButton label="Dismiss" size="sm" onClick={() => setNotice(null)}>
        <XIcon className="w-4 h-4" />
      </IconButton>
    </div>
  );
}
