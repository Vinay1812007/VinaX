import { useMemo } from 'react';
import { toast } from '@/store/toastStore';
import { XIcon } from '@/components/Icons';
import { Link } from 'react-router-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useHistoryStore } from '@/store/historyStore';
import { SongRow, TrackListHead } from '@/components/SongRow';
import { EntityHeader, EntityMenu, EntityMeta, GlyphCover, PlayFab } from '@/components/EntityHeader';
import { EmptyState } from '@/components/States';
import { Chip } from '@/components/Chip';
import { relativeTime } from '@/utils/format';
import { usePlayerStore } from '@/store/playerStore';
import { ClockIcon, SearchIcon } from '@/components/Icons';
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
  const removeEntry = useHistoryStore((s) => s.removeEntry);
  // Whole-history clear is undoable (snapshot → clear → toast with Undo).
  // Loaded on demand, like the onboarding restore: the settings actions
  // module carries the backup code and has no place in this page's chunk.
  const clearHistoryWithUndo = () => void import('@/features/settings/actions').then((m) => m.clearHistoryWithUndo());
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
    <div className="vx-entity">
      <EntityHeader
        kind="History"
        title="Recently played"
        tone="var(--ink-500)"
        art={<GlyphCover tone="history" icon={<ClockIcon />} />}
        meta={<EntityMeta items={[entries.length ? `${entries.length} play${entries.length === 1 ? '' : 's'}` : null, 'Stored only on this device']} />}
        actions={entries.length > 0 ? (
          <>
            <PlayFab
              label={filtering ? `Play these ${shownSongs.length}` : 'Play all'}
              onClick={() => shownSongs.length && playQueue(shownSongs, 0)}
              disabled={shownSongs.length === 0}
            />
            <EntityMenu items={[{ label: 'Clear all history', onSelect: clearHistoryWithUndo, danger: true }]} />
          </>
        ) : undefined}
      />

      {entries.length > 0 && (
        <div className="mb-6 space-y-3">
          {/* v5.17.0 — search within history + scoped clears */}
          <div className="vx-etools !mb-0">
            <label className="vx-field">
              <span className="sr-only">Search your history</span>
              <SearchIcon />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search title or artist"
                autoComplete="off"
              />
              {query && (
                <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="vx-field-clear">
                  <XIcon className="w-4 h-4" />
                </button>
              )}
            </label>
            <button type="button" onClick={() => clearWindow('the last hour', Date.now() - 3_600_000)} className="vx-quiet-btn is-danger">
              Clear last hour
            </button>
            <button type="button" onClick={() => clearWindow('today', startOfToday())} className="vx-quiet-btn is-danger">
              Clear today
            </button>
          </div>
          <div className="flex gap-2 overflow-x-auto no-scrollbar py-1">
            {RANGES.map((r) => (
              <Chip key={r.id} active={range === r.id} onClick={() => setRange(r.id)}>
                {r.label}
              </Chip>
            ))}
          </div>
          {langs.length >= 2 && (
            <div className="flex gap-2 overflow-x-auto no-scrollbar py-1">
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
        <div className="vx-tracklist">
          <TrackListHead trail={108} />
          {groups.map((g) => (
            <section key={g.label} aria-label={g.label}>
              <h2 className="vx-day-label px-2">{g.label}</h2>
              {g.items.map(({ entry, index }) => (
                <div key={`${entry.song.id}-${entry.ts}`} className="vx-row-with">
                  <div className="vx-row-main">
                    <SongRow song={entry.song} songs={shownSongs} index={index} />
                  </div>
                  <span className="vx-row-when">{relativeTime(entry.ts)}</span>
                  {/* v5.17.0 — remove a single play */}
                  <button
                    type="button"
                    onClick={() => { removeEntry(entry.ts); toast('Removed from history'); }}
                    aria-label={`Remove ${entry.song.title} from history`}
                    title="Remove"
                    className="vx-row-x is-danger"
                  >
                    <XIcon className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
