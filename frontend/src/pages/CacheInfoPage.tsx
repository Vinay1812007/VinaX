import { useEffect, useState } from 'react';
import { usePageTitle } from '@/hooks/usePageTitle';
import { localStorageUsageBytes } from '@/services/storage/local';
import { eventCount, storageEstimate } from '@/services/storage/idb';
import { queryClient } from '@/services/queryClient';
import { healthRegistry } from '@/services/api';
import { clearCachedMetadata } from '@/features/settings/actions';
import { PageHeader } from '@/components/PageHeader';
import '@/styles/pages/secondary.css';

function fmtBytes(b: number): string {
  if (b > 1_048_576) return `${(b / 1_048_576).toFixed(1)} MB`;
  if (b > 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${b} B`;
}

export default function CacheInfoPage() {
  usePageTitle('Cache & Offline');
  const [events, setEvents] = useState<number | null>(null);
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    void eventCount().then(setEvents);
    void storageEstimate().then(setEstimate);
  }, [tick]);

  const localBytes = localStorageUsageBytes();
  const queries = queryClient.getQueryCache().getAll().length;
  const health = healthRegistry.snapshot();

  const tiles: Array<[string, string, string?]> = [
    [fmtBytes(localBytes), 'Preferences', 'Settings and profile'],
    [events == null ? '—' : String(events), 'Listen events', 'On this device'],
    [String(queries), 'Cached queries', 'In memory'],
    [estimate ? fmtBytes(estimate.usage) : '—', 'Storage used', estimate ? `of ${fmtBytes(estimate.quota)}` : undefined],
  ];

  return (
    <div className="vx-sec">
      <PageHeader
        title="Cache and offline"
        subtitle="VinaX streams music. What is cached here is metadata and your own preferences."
        actions={
          <>
            <button onClick={() => setTick((t) => t + 1)} className="vx-pill-btn">Refresh stats</button>
            <button onClick={() => { clearCachedMetadata(); setTick((t) => t + 1); }} className="vx-pill-btn">
              Clear metadata cache
            </button>
          </>
        }
      />

      <div className="vx-sec-block vx-kpis is-four">
        {tiles.map(([value, label, note]) => (
          <div key={label} className="vx-kpi">
            <span className="vx-kpi-label">{label}</span>
            <span className="vx-kpi-value">{value}</span>
            {note && <span className="vx-kpi-delta text-ink-400">{note}</span>}
          </div>
        ))}
      </div>

      <section className="vx-sec-block" aria-labelledby="vx-cache-health">
        <h2 id="vx-cache-health" className="vx-sec-title">Source health this session</h2>
        <div className="vx-group overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-ink-400 text-[12px] font-semibold">
              <tr>
                <th className="text-left px-4 h-11 font-semibold">Source</th>
                <th className="text-right px-4 h-11 font-semibold">OK</th>
                <th className="text-right px-4 h-11 font-semibold">Fail</th>
                <th className="text-right px-4 h-11 font-semibold">Latency</th>
                <th className="text-right px-4 h-11 font-semibold">State</th>
              </tr>
            </thead>
            <tbody>
              {health.map((h) => (
                <tr key={h.id} className="border-t border-[color:var(--vx-border)]">
                  <td className="px-4 h-[52px] font-semibold text-ink-100">{`Source ${health.indexOf(h) + 1}`}</td>
                  <td className="px-4 text-right tabular-nums">{h.successes}</td>
                  <td className="px-4 text-right tabular-nums">{h.failures}</td>
                  <td className="px-4 text-right tabular-nums text-ink-300">{Math.round(h.latencyEmaMs)} ms</td>
                  <td className="px-4 text-right text-[13px]">
                    {h.cooldownUntil > Date.now() ? (
                      <span className="text-[color:var(--vx-danger)] font-semibold">Cooling down</span>
                    ) : (
                      <span className="text-ink-300">Active</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="vx-sec-foot">
          Offline, your library, history, queue, taste profile and settings stay available. Streaming and search need a
          connection and show a retry instead of failing.
        </p>
      </section>
    </div>
  );
}
