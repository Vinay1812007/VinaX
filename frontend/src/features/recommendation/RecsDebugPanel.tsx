import { useState } from 'react';
import { useRecsDebugStore, recsDebugEnabled } from '@/store/recsDebugStore';

/**
 * v6.4.0 / v7.0.0 — development-only recommendation debug view: every queue
 * continuation with the final score, each scoring component, the candidate
 * source and whether the AI DJ or the local engine chose the order. Since
 * 7.0 it also shows how the pipeline ran (mode, arc, language policy, this
 * sitting's intent, how many songs survived each stage), the songs that
 * scored but were passed over, and every rejected candidate with the rule
 * that turned it away. Mounted only when recsDebugEnabled() (never in a
 * production build without the `?debug=recs` switch).
 */
const fmtComponents = (components: Array<{ kind: string; detail?: string; weight: number }>): string =>
  components.map((c) => `${c.kind}${c.detail ? `(${c.detail})` : ''} ${c.weight >= 0 ? '+' : ''}${c.weight.toFixed(3)}`).join(' · ') || 'no component detail';
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
          {latest?.trace && (
            <div className="border-t border-white/10 py-1 text-sky-200">
              <div>
                mode <b>{latest.trace.mode}</b> · arc {latest.trace.shape} · language {latest.trace.lock ?? 'any'} ({latest.trace.languagePolicy}) · discovery share {latest.trace.discoveryShare.toFixed(2)}
              </div>
              <div>
                stages: {latest.trace.stages.candidates} gathered → {latest.trace.stages.admitted} admitted → {latest.trace.stages.ranked} ranked → {latest.trace.stages.sequenced} sequenced → {latest.trace.stages.validated} queued
                {latest.trace.repairs > 0 && ` · ${latest.trace.repairs} spacing repair${latest.trace.repairs === 1 ? '' : 's'}`}
                {latest.trace.relaxed.length > 0 && ` · relaxed: ${latest.trace.relaxed.join(', ')}`}
              </div>
              {latest.trace.intent && (
                <div>
                  session: skip streak {latest.trace.intent.skipStreak} · completion streak {latest.trace.intent.completionStreak} · appetite {latest.trace.intent.discoveryAppetite.toFixed(2)} · energy steer {latest.trace.intent.energySteer.toFixed(2)}
                </div>
              )}
            </div>
          )}
          {latest?.rows.map((r) => (
            <div key={`${r.position}-${r.song.id}`} className="border-t border-white/10 py-1">
              <div>
                #{r.position} <b>{r.song.title}</b> · {r.song.subtitle} · <span className={r.picker === 'ai' ? 'text-emerald-300' : 'text-amber-300'}>{r.picker === 'ai' ? 'AI selected' : 'LOCAL FALLBACK'}</span>
                {typeof r.confidence === 'number' && ` · conf ${r.confidence.toFixed(2)}`}
              </div>
              <div>final {r.finalScore.toFixed(3)} · source {r.source}{typeof r.rank === 'number' && ` · ranked #${r.rank}`}</div>
              <div className="text-white/70">{fmtComponents(r.components)}</div>
            </div>
          ))}
          {!!latest?.passedOver.length && (
            <details className="border-t border-white/10 py-1">
              <summary className="cursor-pointer text-amber-200">passed over · {latest.passedOver.length} scored but not queued</summary>
              {latest.passedOver.map((r) => (
                <div key={r.song.id} className="py-0.5">
                  <div>ranked #{r.rank} <b>{r.song.title}</b> · {r.song.subtitle} · {r.finalScore.toFixed(3)} · {r.source}</div>
                  <div className="text-white/60">{fmtComponents(r.components)}</div>
                </div>
              ))}
            </details>
          )}
          {!!latest?.rejected.length && (
            <details className="border-t border-white/10 py-1">
              <summary className="cursor-pointer text-rose-300">rejected · {latest.rejected.length}</summary>
              {latest.rejected.map((r, i) => (
                <div key={`${r.song.id}-${i}`} className="py-0.5">
                  <b>{r.song.title}</b> · {r.song.subtitle} · <span className="text-rose-300">{r.reason}</span> <span className="text-white/50">({r.stage})</span>
                </div>
              ))}
            </details>
          )}
        </div>
      )}
    </div>
  );
}
