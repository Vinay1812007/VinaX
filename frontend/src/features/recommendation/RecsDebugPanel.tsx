import { useState } from 'react';
import { useRecsDebugStore, recsDebugEnabled } from '@/store/recsDebugStore';

/**
 * v6.4.0 — development-only recommendation debug view: every queue
 * continuation with the final score, each scoring component, the candidate
 * source and whether the AI DJ or the local engine chose the order. Mounted
 * only when recsDebugEnabled() (never in a production build without the
 * `?debug=recs` switch).
 */
export function RecsDebugPanel() {
  const batches = useRecsDebugStore((s) => s.batches);
  const clear = useRecsDebugStore((s) => s.clear);
  const [open, setOpen] = useState(false);
  if (!recsDebugEnabled()) return null;
  const latest = batches[0];
  return (
    <div className="fixed left-2 bottom-[calc(6rem+env(safe-area-inset-bottom))] z-40 max-w-[min(92vw,34rem)] text-[11px] font-mono">
      <button type="button" onClick={() => setOpen((v) => !v)} className="rounded-full bg-black/80 text-white px-3 py-1.5 border border-white/20" aria-expanded={open}>
        recs debug · {batches.length} batch{batches.length === 1 ? '' : 'es'}
      </button>
      {open && (
        <div className="mt-1 rounded-xl bg-black/90 text-white border border-white/20 p-2 max-h-[50vh] overflow-auto">
          <div className="flex justify-between items-center mb-1">
            <span>{latest ? new Date(latest.at).toLocaleTimeString() : 'no recommendations yet'}</span>
            <button type="button" onClick={clear} className="underline">clear</button>
          </div>
          {latest?.rows.map((r) => (
            <div key={`${r.position}-${r.song.id}`} className="border-t border-white/10 py-1">
              <div>
                #{r.position} <b>{r.song.title}</b> · {r.song.subtitle} · <span className={r.picker === 'ai' ? 'text-emerald-300' : 'text-amber-300'}>{r.picker === 'ai' ? 'AI selected' : 'LOCAL FALLBACK'}</span>
                {typeof r.confidence === 'number' && ` · conf ${r.confidence.toFixed(2)}`}
              </div>
              <div>final {r.finalScore.toFixed(3)} · source {r.source}</div>
              <div className="text-white/70">
                {r.components.map((c) => `${c.kind}${c.detail ? `(${c.detail})` : ''} ${c.weight >= 0 ? '+' : ''}${c.weight.toFixed(3)}`).join(' · ') || 'no component detail'}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
