import { useMemo } from 'react';
import { toast } from '@/store/toastStore';
import { XIcon } from '@/components/Icons';
import { Link } from 'react-router-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useHistoryStore } from '@/store/historyStore';
import { SongRow } from '@/components/SongRow';
import { EmptyState } from '@/components/States';
import { Chip } from '@/components/Chip';
import { relativeTime } from '@/utils/format';
import { usePlayerStore } from '@/store/playerStore';
import { PlayIcon, ClockIcon } from '@/components/Icons';
import { PageHeader } from '@/components/PageHeader';
import { languageLabel } from '@/constants/languages';
import type { HistoryEntry } from '@/types';
import { useSessionState } from '@/hooks/useSessionState';

function dayLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
}

// Package D6 — date-range filter. Cutoffs are computed at render, so "Today"
// and "Yesterday" mean calendar days, and week/month are rolling windows.
// v5.17.0 — day chips: Today · Yesterday · This week · All (+ 30 days).
const RANGES = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'Last 30 days' },
  { id: 'all', label: 'All' },
] as const;
type RangeId = (typeof RANGES)[number]['id'];

function inRange(ts: number, range: RangeId): boolean {
  if (range === 'all') return true;
  if (range === 'today') return new Date(ts).toDateString() === new Date().toDateString();
  if (range === 'yesterday') return new Date(ts).toDateString() === new Date(Date.now() - 86_400_000).toDateString();
  const days = range === 'week' ? 7 : 30;
  return Date.now() - ts <= days * 86_400_000;
}

/** v5.17.0 — search within history: title, subtitle or any credited artist. */
function matchesQuery(e: HistoryEntry, q: string): boolean {
  if (!q) return true;
  const s = e.song;
  if (s.title.toLowerCase().includes(q)) return true;
  if (s.subtitle?.toLowerCase().includes(q)) return true;
  return (s.artists ?? []).some((a) => a.name.toLowerCase().includes(q));
}

function startOfToday(): number {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export default function HistoryPage() {
  usePageTitle('History');
  const entries = useHistoryStore((s) => s.entries);
  const clearHistory = useHistoryStore((s) => s.clearHistory);
  const removeEntry = useHistoryStore((s) => s.removeEntry);
  const clearSince = useHistoryStore((s) => s.clearSince);
  const playQueue = usePlayerStore((s) => s.playQueue);
  // Package D6 — language + date filters, and Play all acts on what you see.
  const [lang, setLang] = useSessionState<string | null>('vinax.history.lang.v1', null);
  const [range, setRange] = useSessionState<RangeId>('vinax.history.range.v1', 'all');
  // v5.17.0 — free-text search within history.
  const [query, setQuery] = useSessionState<string>('vinax.history.query.v1', '');
  const q = query.trim().toLowerCase();

  // v5.17.0 — scoped clears (confirmed, like the other destructive actions).
  const clearWindow = (label: string, since: number): void => {
    const n = entries.filter((e) => e.ts >= since).length;
    if (!n) {
      toast(`Nothing played ${label}`);
      return;
    }
    if (!window.confirm(`Remove ${n} play${n === 1 ? '' : 's'} from ${label}?`)) return;
    clearSince(since);
    toast(`Cleared ${n} play${n === 1 ? '' : 's'}`);
  };

  const langs = useMemo(
    () => [...new Set(entries.map((e) => e.song.language).filter((l): l is string => !!l && l !== 'unknown'))],
    [entries],
  );

  const filtered = useMemo(
    () => entries.filter((e) => inRange(e.ts, range) && (!lang || e.song.language === lang) && matchesQuery(e, q)),
    [entries, lang, range, q],
  );

  const groups = useMemo(() => {
    const out: Array<{ label: string; items: Array<{ entry: HistoryEntry; index: number }> }> = [];
    filtered.forEach((entry, index) => {
      const label = dayLabel(entry.ts);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push({ entry, index });
      else out.push({ label, items: [{ entry, index }] });
    });
    return out;
  }, [filtered]);

  const shownSongs = filtered.map((e) => e.song);
  const filtering = lang != null || range !== 'all' || q.length > 0;

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="History"
        subtitle="Stored only on this device"
        actions={entries.length > 0 ? (
          <>
            <button
              onClick={() => shownSongs.length && playQueue(shownSongs, 0)}
              className="flex items-center gap-1.5 px-4 min-h-touch rounded-full text-sm btn-primary active:scale-95 transition-transform disabled:opacity-50"
              disabled={shownSongs.length === 0}
            >
              <PlayIcon className="w-3.5 h-3.5" /> {filtering ? `Play these ${shownSongs.length}` : 'Play all'}
            </button>
            <button onClick={clearHistory} className="px-4 min-h-touch rounded-full border border-ink-600 text-sm text-ink-200 hover:border-red-400 hover:text-red-300 active:scale-95 transition-transform">
              Clear
            </button>
          </>
        ) : undefined}
      />

      {entries.length > 0 && (
        <div className="mb-4 space-y-2">
          {/* v5.17.0 — search within history + scoped clears */}
          <div className="flex items-center gap-2">
            <label className="relative flex-1 min-w-0">
              <span className="sr-only">Search your history</span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search title or artist…"
                autoComplete="off"
                className="w-full h-10 rounded-full bg-ink-800 border border-transparent focus:border-ink-600 px-4 pr-9 text-sm text-ink-100 placeholder:text-ink-500 outline-none"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full grid place-items-center text-ink-400 hover:text-ink-100 hover:bg-ink-700"
                >
                  <XIcon className="w-3.5 h-3.5" />
                </button>
              )}
            </label>
            <button
              type="button"
              onClick={() => clearWindow('the last hour', Date.now() - 3_600_000)}
              className="px-3 h-10 rounded-full border border-ink-600 text-xs font-semibold text-ink-200 hover:border-red-400 hover:text-red-300 active:scale-95 transition-transform whitespace-nowrap"
            >
              Clear last hour
            </button>
            <button
              type="button"
              onClick={() => clearWindow('today', startOfToday())}
              className="px-3 h-10 rounded-full border border-ink-600 text-xs font-semibold text-ink-200 hover:border-red-400 hover:text-red-300 active:scale-95 transition-transform whitespace-nowrap"
            >
              Clear today
            </button>
          </div>
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            {RANGES.map((r) => (
              <Chip key={r.id} active={range === r.id} onClick={() => setRange(r.id)}>
                {r.label}
              </Chip>
            ))}
          </div>
          {langs.length >= 2 && (
            <div className="flex gap-2 overflow-x-auto no-scrollbar">
              <Chip active={lang == null} onClick={() => setLang(null)}>All languages</Chip>
              {langs.map((l) => (
                <Chip key={l} active={lang === l} onClick={() => setLang(lang === l ? null : l)}>
                  {languageLabel(l)}
                </Chip>
              ))}
            </div>
          )}
        </div>
      )}

      {entries.length === 0 ? (
        <EmptyState
          icon={<ClockIcon className="w-8 h-8" />}
          title="No listening history"
          message="Songs you play appear here and feed your local recommendations."
          action={<Link to="/discover" className="px-5 py-2.5 rounded-full btn-primary">Discover music</Link>}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<ClockIcon className="w-8 h-8" />}
          title="Nothing in this view"
          message={q ? `Nothing in your history matches “${query.trim()}”.` : 'No plays match those filters — widen the range or switch language.'}
          action={
            <button onClick={() => { setLang(null); setRange('all'); setQuery(''); }} className="px-5 py-2.5 rounded-full btn-primary">
              Show everything
            </button>
          }
        />
      ) : (
        groups.map((g) => (
          <section key={g.label} className="mb-6">
            <h2 className="text-xs font-bold uppercase tracking-widest text-ink-400 px-2 mb-1.5">{g.label}</h2>
            {g.items.map(({ entry, index }) => (
              <div key={`${entry.song.id}-${entry.ts}`} className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <SongRow song={entry.song} songs={shownSongs} index={index} />
                </div>
                <span className="text-[11px] text-ink-500 w-16 text-right shrink-0">{relativeTime(entry.ts)}</span>
                {/* v5.17.0 — remove a single play */}
                <button
                  type="button"
                  onClick={() => { removeEntry(entry.ts); toast('Removed from history'); }}
                  aria-label={`Remove ${entry.song.title} from history`}
                  title="Remove"
                  className="w-8 h-8 shrink-0 rounded-full grid place-items-center text-ink-500 hover:text-red-300 hover:bg-ink-800 active:scale-95 transition-transform"
                >
                  <XIcon className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </section>
        ))
      )}
    </div>
  );
}
