import { useEffect, useMemo, useState } from 'react';
import { useRecsDebugStore, recsDebugEnabled } from '@/store/recsDebugStore';
import { exposureStats } from '@/services/recommendation/exposure';
import { pct, summarise } from './diagnostics';

/**
 * v6.4.0 / v7.0.0 — development-only recommendation debug view: every queue
 * continuation with the final score, each scoring component, the candidate
 * source and whether the AI DJ or the local engine chose the order. Since
 * 7.0 it also shows how the pipeline ran (mode, arc, language policy, this
 * sitting's intent, how many songs survived each stage), the songs that
 * scored but were passed over, and every rejected candidate with the rule
 * that turned it away. Mounted only when recsDebugEnabled() (never in a
 * production build without the `?debug=recs` switch).
 *
 * 9.1.0 — it opens on a DIAGNOSTICS summary across every batch of the session:
 * repeat rates (the headline number the 9.1 work moved), candidate-source
 * counts, fallback reasons, relaxations, hard-filter rejections, latency
 * percentiles, the exposure ledger's size, and the live health of the two
 * evidence services. One view answers "why does this keep repeating?" without
 * reading each batch by hand.
 */

interface ServiceHealth {
  label: string;
  state: string;
  note: string;
}

/**
 * The two evidence services, asked only when the panel is opened. Both are
 * public, read-only and cheap; `wait=0` means /api/discover answers from its
 * cache and never starts a search for this request.
 */
async function readServiceHealth(): Promise<ServiceHealth[]> {
  const out: ServiceHealth[] = [];
  try {
    const res = await fetch('/api/discover?wait=0', { headers: { accept: 'application/json' } });
    const body = (await res.json()) as { state?: string; note?: string; health?: Record<string, unknown> } | null;
    out.push({
      label: 'live web discovery',
      state: String(body?.state ?? 'unknown'),
      note: `${body?.note ?? ''} ${body?.health ? `· quota ${String(body.health.quotaUsed)}/${String(body.health.quotaPerHour)}${body.health.breakerOpen ? ' · breaker OPEN' : ''}` : ''}`.trim(),
    });
  } catch {
    out.push({ label: 'live web discovery', state: 'unreachable', note: 'the endpoint could not be read' });
  }
  try {
    const res = await fetch('/api/trends?limit=1', { headers: { accept: 'application/json' } });
    const body = (await res.json()) as { sources?: Array<{ label?: string; status?: string; lastSuccessAt?: string | null }> } | null;
    for (const src of body?.sources ?? []) {
      out.push({ label: `trends · ${src.label ?? 'source'}`, state: String(src.status ?? 'unknown'), note: src.lastSuccessAt ? `last ok ${src.lastSuccessAt}` : 'never succeeded' });
    }
    if (!body?.sources?.length) out.push({ label: 'trends', state: 'no sources', note: 'nothing configured or nothing returned' });
  } catch {
    out.push({ label: 'trends', state: 'unreachable', note: 'the endpoint could not be read' });
  }
  return out;
}
const fmtComponents = (components: Array<{ kind: string; detail?: string; weight: number }>): string =>
  components.map((c) => `${c.kind}${c.detail ? `(${c.detail})` : ''} ${c.weight >= 0 ? '+' : ''}${c.weight.toFixed(3)}`).join(' · ') || 'no component detail';
export function RecsDebugPanel() {
  const batches = useRecsDebugStore((s) => s.batches);
  const clear = useRecsDebugStore((s) => s.clear);
  const [open, setOpen] = useState(false);
  const [health, setHealth] = useState<ServiceHealth[] | null>(null);
  const diag = useMemo(() => summarise(batches), [batches]);
  // Read the ledger only while the panel is open, and again whenever a new
  // batch lands (queuing songs is what changes it).
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `batches` is the re-read trigger, not an input
  const ledger = useMemo(() => (open ? exposureStats() : null), [open, batches]);
  useEffect(() => {
    if (!open || health) return;
    let live = true;
    void readServiceHealth().then((h) => {
      if (live) setHealth(h);
    });
    return () => {
      live = false;
    };
  }, [open, health]);
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
          {/* 9.1.0 — the session summary, before the per-batch detail. */}
          <details className="border-t border-white/10 py-1" open>
            <summary className="cursor-pointer text-fuchsia-200">diagnostics · {diag.repeats.batches} batch{diag.repeats.batches === 1 ? '' : 'es'}, {diag.repeats.songs} songs</summary>
            <div className="py-0.5">
              repeats: <b>{pct(diag.repeats.batchOverlap)}</b> of a batch was in the one before · {pct(diag.repeats.sessionRepeat)} seen earlier this session
            </div>
            <div className="py-0.5">
              artists: {diag.repeats.artistsPerBatch.toFixed(1)} distinct per batch · worst single artist {pct(diag.repeats.worstArtistShare)} of a batch
            </div>
            <div className="py-0.5">
              latency: p50 {diag.latency.p50} ms · p95 {diag.latency.p95} ms · max {diag.latency.max} ms ({diag.latency.samples} samples)
            </div>
            <div className="py-0.5">picked by: local {diag.pickers.local} · AI {diag.pickers.ai}</div>
            {!!diag.sources.length && (
              <div className="py-0.5 text-white/70">sources: {diag.sources.map((x) => `${x.source} ${x.count}`).join(' · ')}</div>
            )}
            {!!diag.fallbacks.length && (
              <div className="py-0.5 text-amber-200">AI not used: {diag.fallbacks.map((x) => `${x.reason} ×${x.count}`).join(' · ')}</div>
            )}
            {!!diag.relaxed.length && (
              <div className="py-0.5 text-amber-200">relaxed: {diag.relaxed.map((x) => `${x.rule} ×${x.count}`).join(' · ')}</div>
            )}
            {!!diag.rejections.length && (
              <div className="py-0.5 text-rose-300">rejected: {diag.rejections.map((x) => `${x.reason} ×${x.count}`).join(' · ')}</div>
            )}
            {ledger && (
              <div className="py-0.5 text-sky-200">
                exposure ledger: {ledger.rows} songs · {ledger.cooling} cooling · shown {ledger.shown} · queued {ledger.queued} · played {ledger.played} · skipped {ledger.skipped}
              </div>
            )}
            <div className="py-0.5">
              {health === null
                ? 'source health: reading…'
                : health.map((h) => (
                    <div key={h.label} className={h.state === 'ok' ? 'text-emerald-300' : 'text-amber-200'}>
                      {h.label}: <b>{h.state}</b> {h.note && <span className="text-white/60">· {h.note}</span>}
                    </div>
                  ))}
            </div>
          </details>
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
                {typeof r.confidence === 'number' && ` · self-rated fit ${r.confidence.toFixed(2)} (the model's own claim, not a probability)`}
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
