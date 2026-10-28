import { useEffect, useState } from 'react';
import { usePageTitle } from '@/hooks/usePageTitle';
import { localStorageUsageBytes } from '@/services/storage/local';
import { eventCount, storageEstimate } from '@/services/storage/idb';
import { queryClient } from '@/services/queryClient';
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
        subtitle="What is cached here is metadata and your own preferences."
        actions={
          <>
            <button onClick={() => setTick((t) => t + 1)} className="vx-sec-pill">Refresh stats</button>
            <button onClick={() => { clearCachedMetadata(); setTick((t) => t + 1); }} className="vx-sec-pill">
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

    </div>
  );
}
