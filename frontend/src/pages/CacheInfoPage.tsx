import { useEffect, useState } from 'react';
import { usePageTitle } from '@/hooks/usePageTitle';
import { localStorageUsageBytes } from '@/services/storage/local';
import { eventCount, storageEstimate } from '@/services/storage/idb';
import { queryClient } from '@/services/queryClient';
import { healthRegistry } from '@/services/api';
import { clearCachedMetadata } from '@/features/settings/actions';

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

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-display tracking-tight mb-1">Cache & Offline Info</h1>
      <p className="text-sm text-ink-400 mb-6">
        VinaX streams music — it does not persistently download tracks. Cached items below are
        metadata and your local preferences only.
      </p>

      <div className="grid sm:grid-cols-2 gap-4 mb-6">
        <div className="rounded-2xl border border-ink-700 p-5">
          <p className="text-2xl font-bold">{fmtBytes(localBytes)}</p>
          <p className="text-xs text-ink-400 mt-1">Preferences & profile (localStorage)</p>
        </div>
        <div className="rounded-2xl border border-ink-700 p-5">
          <p className="text-2xl font-bold">{events ?? '—'}</p>
          <p className="text-xs text-ink-400 mt-1">Listen events (IndexedDB)</p>
        </div>
        <div className="rounded-2xl border border-ink-700 p-5">
          <p className="text-2xl font-bold">{queries}</p>
          <p className="text-xs text-ink-400 mt-1">Cached metadata queries (memory)</p>
        </div>
        <div className="rounded-2xl border border-ink-700 p-5">
          <p className="text-2xl font-bold">{estimate ? fmtBytes(estimate.usage) : '—'}</p>
          <p className="text-xs text-ink-400 mt-1">
            Total origin storage{estimate ? ` of ${fmtBytes(estimate.quota)} quota` : ''}
          </p>
        </div>
      </div>

      <h2 className="text-title mb-3">Source health (this session)</h2>
      <div className="rounded-2xl border border-ink-700 overflow-hidden mb-6">
        <table className="w-full text-sm">
          <thead className="bg-ink-850 text-ink-300 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-2.5">Source</th>
              <th className="text-right px-4 py-2.5">OK</th>
              <th className="text-right px-4 py-2.5">Fail</th>
              <th className="text-right px-4 py-2.5">Latency</th>
              <th className="text-right px-4 py-2.5">State</th>
            </tr>
          </thead>
          <tbody>
            {health.map((h) => (
              <tr key={h.id} className="border-t border-ink-800">
                <td className="px-4 py-2.5 font-medium">{`Source ${health.indexOf(h) + 1}`}</td>
                <td className="px-4 py-2.5 text-right text-tide-400 tabular-nums">{h.successes}</td>
                <td className="px-4 py-2.5 text-right text-ember-400 tabular-nums">{h.failures}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{Math.round(h.latencyEmaMs)}ms</td>
                <td className="px-4 py-2.5 text-right text-xs">
                  {h.cooldownUntil > Date.now() ? <span className="text-red-300">cooling down</span> : <span className="text-tide-400">active</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex gap-3">
        <button onClick={() => { clearCachedMetadata(); setTick((t) => t + 1); }} className="px-5 py-2.5 rounded-full border border-ink-600 text-sm hover:border-ink-400">
          Clear metadata cache
        </button>
        <button onClick={() => setTick((t) => t + 1)} className="px-5 py-2.5 rounded-full border border-ink-600 text-sm hover:border-ink-400">
          Refresh stats
        </button>
      </div>

      <p className="text-xs text-ink-500 mt-6 leading-relaxed">
        Offline behavior: without a connection, your library, history, queue, taste profile, and
        settings remain available. Streaming and search need a connection and will show retryable
        error states instead of crashing.
      </p>
    </div>
  );
}
