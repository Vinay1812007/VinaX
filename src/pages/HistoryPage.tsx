import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useHistoryStore } from '@/store/historyStore';
import { SongRow } from '@/components/SongRow';
import { EmptyState } from '@/components/States';
import { relativeTime } from '@/utils/format';
import { usePlayerStore } from '@/store/playerStore';
import { PlayIcon } from '@/components/Icons';
import { PageHeader } from '@/components/PageHeader';
import type { HistoryEntry } from '@/types';

function dayLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
}

export default function HistoryPage() {
  usePageTitle('History');
  const entries = useHistoryStore((s) => s.entries);
  const clearHistory = useHistoryStore((s) => s.clearHistory);
  const playQueue = usePlayerStore((s) => s.playQueue);

  const groups = useMemo(() => {
    const out: Array<{ label: string; items: Array<{ entry: HistoryEntry; index: number }> }> = [];
    entries.forEach((entry, index) => {
      const label = dayLabel(entry.ts);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push({ entry, index });
      else out.push({ label, items: [{ entry, index }] });
    });
    return out;
  }, [entries]);

  const allSongs = entries.map((e) => e.song);

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="History"
        subtitle="Stored only on this device"
        actions={entries.length > 0 ? (
          <>
            <button onClick={() => playQueue(allSongs, 0)} className="flex items-center gap-1.5 px-4 min-h-touch rounded-full text-sm btn-primary active:scale-95 transition-transform">
              <PlayIcon className="w-3.5 h-3.5" /> Play all
            </button>
            <button onClick={clearHistory} className="px-4 min-h-touch rounded-full border border-ink-600 text-sm text-ink-200 hover:border-red-400 hover:text-red-300 active:scale-95 transition-transform">
              Clear
            </button>
          </>
        ) : undefined}
      />
      {entries.length === 0 ? (
        <EmptyState
          title="No listening history"
          message="Songs you play appear here and feed your local recommendations."
          action={<Link to="/discover" className="px-5 py-2.5 rounded-full btn-primary">Discover music</Link>}
        />
      ) : (
        groups.map((g) => (
          <section key={g.label} className="mb-6">
            <h2 className="text-xs font-bold uppercase tracking-widest text-ink-400 px-2 mb-1.5">{g.label}</h2>
            {g.items.map(({ entry, index }) => (
              <div key={`${entry.song.id}-${entry.ts}`} className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <SongRow song={entry.song} songs={allSongs} index={index} />
                </div>
                <span className="text-[11px] text-ink-500 w-16 text-right shrink-0">{relativeTime(entry.ts)}</span>
              </div>
            ))}
          </section>
        ))
      )}
    </div>
  );
}
