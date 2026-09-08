import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useHistoryStore } from '@/store/historyStore';
import { useLibraryStore } from '@/store/libraryStore';
import { getStreak, getBestStreak } from '@/utils/streak';
import { GoalRing } from '@/components/GoalRing';
import { toast } from '@/store/toastStore';
import { weeklyReport } from '@/features/stats/weeklyReport';
import { calendarCells } from '@/features/stats/calendar';
import type { CalendarCell } from '@/features/stats/calendar';
import { cn } from '@/utils/cn';
import type { HistoryEntry } from '@/types';

const BAR_COLORS = ['#22d3ee', '#60a5fa', '#a78bfa', '#67e8f9', '#c4b5fd'];

function fmtHours(totalSec: number): string {
  const h = totalSec / 3600;
  return h >= 10 ? String(Math.round(h)) : h.toFixed(1);
}

/** v5.17.0 — up/down delta pill for the weekly report card. */
function Delta({ value, suffix = '' }: { value: number; suffix?: string }) {
  if (value === 0) return <span className="text-[11px] font-bold text-ink-500">— same</span>;
  const up = value > 0;
  return (
    <span className={cn('text-[11px] font-bold', up ? 'text-emerald-400' : 'text-red-300')}>
      {up ? '▲' : '▼'} {Math.abs(value)}{suffix} vs last week
    </span>
  );
}

/** v5.17.0 — Weekly report card: this week against the seven days before. */
function WeeklyReportCard({ entries }: { entries: HistoryEntry[] }) {
  const report = useMemo(() => weeklyReport(entries), [entries]);
  const { thisWeek, lastWeek, delta } = report;
  if (thisWeek.songs === 0 && lastWeek.songs === 0) return null;
  const tiles: Array<{ label: string; value: string; delta: number; suffix?: string }> = [
    { label: 'MINUTES', value: String(thisWeek.minutes), delta: delta.minutes, suffix: ' min' },
    { label: 'SONGS', value: String(thisWeek.songs), delta: delta.songs },
    { label: 'NEW ARTISTS', value: String(thisWeek.newArtists), delta: delta.newArtists },
  ];
  return (
    <section
      aria-label="Weekly report"
      className="rounded-2xl border border-ember-400/20 p-4"
      style={{ background: 'linear-gradient(120deg, rgb(var(--ember-500) / 0.14), rgb(var(--ember-500) / 0.04))' }}
    >
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="text-[15px] font-extrabold">This week's report</h2>
        <span className="text-[11px] font-semibold text-ink-400">Last 7 days · vs the 7 before</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl bg-[var(--tile)] border border-[var(--glass-border)] px-3 py-2.5 min-w-0">
            <p className="text-[22px] font-extrabold leading-tight">{t.value}</p>
            <p className="text-[10px] font-bold tracking-widest text-ink-400">{t.label}</p>
            <p className="mt-1 truncate"><Delta value={t.delta} suffix={t.suffix} /></p>
          </div>
        ))}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
        <div className="min-w-0">
          <dt className="text-[10px] font-bold tracking-widest text-ink-400">TOP ARTIST</dt>
          <dd className="font-bold truncate">{thisWeek.topArtist ?? '—'}</dd>
          {lastWeek.topArtist && lastWeek.topArtist !== thisWeek.topArtist && (
            <dd className="text-[11px] text-ink-500 truncate">was {lastWeek.topArtist}</dd>
          )}
        </div>
        <div className="min-w-0">
          <dt className="text-[10px] font-bold tracking-widest text-ink-400">TOP LANGUAGE</dt>
          <dd className="font-bold truncate">{thisWeek.topLanguage ?? '—'}</dd>
          {lastWeek.topLanguage && lastWeek.topLanguage !== thisWeek.topLanguage && (
            <dd className="text-[11px] text-ink-500 truncate">was {lastWeek.topLanguage}</dd>
          )}
        </div>
      </dl>
    </section>
  );
}

const LEVEL_ALPHA = [0, 0.25, 0.45, 0.7, 1] as const;
const DOW = ['Mon', '', 'Wed', '', 'Fri', '', 'Sun'];

function cellTitle(c: CalendarCell): string {
  const date = new Date(c.ts).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  if (c.future) return date;
  return `${date} · ${c.minutes ? `${c.minutes} min` : 'no listening'}`;
}

/** v5.17.0 — 12-week listening calendar (Monday-first heatmap). */
function ListeningCalendar({ entries }: { entries: HistoryEntry[] }) {
  const cal = useMemo(() => calendarCells(entries), [entries]);
  const monthLabels = useMemo(() => {
    // Label a column when it starts a new month.
    const out: Array<string | null> = [];
    let last = -1;
    for (let w = 0; w < cal.weeks; w++) {
      const m = new Date(cal.cells[w * 7].ts).getMonth();
      out.push(m !== last ? new Date(cal.cells[w * 7].ts).toLocaleDateString(undefined, { month: 'short' }) : null);
      last = m;
    }
    return out;
  }, [cal]);
  return (
    <section aria-label="Listening calendar">
      <div className="flex items-baseline justify-between gap-3 mb-2.5">
        <h2 className="text-base font-extrabold">Listening calendar</h2>
        <span className="text-[11px] font-semibold text-ink-400">{cal.activeDays} active days · 12 weeks</span>
      </div>
      <div className="rounded-2xl bg-[var(--tile)] border border-[var(--glass-border)] p-3 overflow-x-auto">
        <div className="flex gap-1.5 min-w-max">
          <div className="grid grid-rows-7 gap-[3px] pt-[14px]">
            {DOW.map((d, i) => (
              <span key={i} className="h-3 text-[9px] leading-3 font-bold text-ink-500 w-6">{d}</span>
            ))}
          </div>
          <div>
            <div className="grid grid-flow-col gap-[3px] mb-[2px]" style={{ gridTemplateColumns: `repeat(${cal.weeks}, 0.75rem)` }}>
              {monthLabels.map((m, i) => (
                <span key={i} className="h-3 text-[9px] leading-3 font-bold text-ink-500 whitespace-nowrap">{m ?? ''}</span>
              ))}
            </div>
            <div className="grid grid-flow-col grid-rows-7 gap-[3px]" role="img" aria-label={`Minutes listened per day over the last ${cal.weeks} weeks`}>
              {cal.cells.map((c) => (
                <span
                  key={c.key}
                  title={cellTitle(c)}
                  tabIndex={c.future ? -1 : 0}
                  aria-label={cellTitle(c)}
                  className={cn(
                    'block w-3 h-3 rounded-[3px] outline-none focus-visible:ring-2 focus-visible:ring-ember-400',
                    c.future ? 'opacity-0' : 'bg-[var(--track)]',
                    c.today && 'ring-1 ring-ink-300',
                  )}
                  style={c.level > 0 ? { background: `rgb(var(--ember-500) / ${LEVEL_ALPHA[c.level]})` } : undefined}
                />
              ))}
            </div>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-[11px] font-semibold text-ink-300">
            Current streak <span className="text-ink-100 font-extrabold">{cal.currentStreak}</span> day{cal.currentStreak === 1 ? '' : 's'}
            <span className="text-ink-500"> · </span>
            Longest <span className="text-ink-100 font-extrabold">{cal.longestStreak}</span> day{cal.longestStreak === 1 ? '' : 's'}
          </p>
          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-ink-500">
            Less
            {LEVEL_ALPHA.map((a, i) => (
              <span
                key={i}
                className={cn('w-2.5 h-2.5 rounded-[2px]', i === 0 && 'bg-[var(--track)]')}
                style={i > 0 ? { background: `rgb(var(--ember-500) / ${a})` } : undefined}
              />
            ))}
            More
          </span>
        </div>
      </div>
    </section>
  );
}

/** Canvas 4a — Your VinaX: on-device analytics, never uploaded. */
export default function StatsPage() {
  usePageTitle('Your VinaX');
  const entries = useHistoryStore((s) => s.entries);
  const favorites = useLibraryStore((s) => s.favorites);

  const stats = useMemo(() => {
    const artistCount = new Map<string, number>();
    const langCount = new Map<string, number>();
    let seconds = 0;
    for (const e of entries) {
      const s = e.song;
      seconds += s.duration ?? 0;
      const artist = s.artists?.[0]?.name ?? s.subtitle?.split(',')[0]?.trim() ?? 'Unknown';
      artistCount.set(artist, (artistCount.get(artist) ?? 0) + 1);
      const lang = s.language ? s.language[0].toUpperCase() + s.language.slice(1) : 'Other';
      langCount.set(lang, (langCount.get(lang) ?? 0) + 1);
    }
    const topArtists = [...artistCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const langs = [...langCount.entries()].sort((a, b) => b[1] - a[1]);
    const top4 = langs.slice(0, 4);
    const rest = langs.slice(4).reduce((n, [, c]) => n + c, 0);
    const langRows = rest > 0 ? [...top4, ['Other', rest] as [string, number]] : top4;
    const totalLang = langRows.reduce((n, [, c]) => n + c, 0) || 1;
    return {
      plays: entries.length,
      hours: fmtHours(seconds),
      artists: artistCount.size,
      topArtists,
      maxArtist: topArtists[0]?.[1] ?? 1,
      langs: langRows.map(([name, c]) => ({ name, pct: Math.round((c / totalLang) * 100) })),
    };
  }, [entries]);

  const streak = getStreak();
  const best = getBestStreak();

  const share = (): void => {
    const text = `My VinaX: ${stats.plays} plays · ${stats.hours}h listened · ${streak}-day streak 🎵 sirimillavinay.online`;
    if (navigator.share) {
      void navigator.share({ text }).catch(() => undefined);
    } else {
      void navigator.clipboard?.writeText(text).then(() => toast('Copied — paste it anywhere'));
    }
  };

  if (!entries.length) {
    return (
      <div className="glass-card rounded-3xl max-w-md mx-auto my-24 px-10 py-14 text-center flex flex-col items-center gap-4">
        <p className="text-2xl font-extrabold">Your VinaX</p>
        <p className="text-sm text-ink-300">Play a few songs and your on-device stats bloom here — never uploaded, always yours.</p>
        <Link to="/" className="px-5 py-2.5 rounded-full btn-primary text-sm font-bold">Start listening</Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto pb-8 space-y-5">
      {/* header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-extrabold tracking-tight">Your VinaX</h1>
          <p className="text-xs font-semibold text-ink-400">Computed on this device · never uploaded</p>
        </div>
        <button
          onClick={share}
          className="h-[38px] px-4 rounded-full bg-[var(--tile-2)] border border-[var(--glass-border)] text-xs font-bold text-ink-200 hover:bg-[var(--tile-hover)] transition active:scale-95 shrink-0"
        >
          ↑ Share
        </button>
      </div>

      {/* v5.17.0 — weekly report card */}
      <WeeklyReportCard entries={entries} />

      {/* stat grid */}
      <div className="grid grid-cols-2 gap-2">
        {[
          [String(stats.plays), 'PLAYS'],
          [`${stats.hours}h`, 'LISTENED'],
          [String(favorites.length), 'FAVORITES'],
          [String(stats.artists), 'ARTISTS'],
        ].map(([n, l]) => (
          <div key={l} className="rounded-[18px] bg-[var(--tile)] border border-[var(--glass-border)] p-4">
            <p className="text-[26px] font-extrabold leading-tight">{n}</p>
            <p className="text-[11px] font-bold tracking-widest text-ink-400">{l}</p>
          </div>
        ))}
      </div>

      {/* streak */}
      <div
        className="rounded-2xl border border-ember-400/20 p-4 flex items-center gap-3.5"
        style={{ background: 'linear-gradient(120deg, rgba(34,211,238,0.16), rgba(96,165,250,0.08))' }}
      >
        <span className="text-[28px]" aria-hidden>🔥</span>
        <span>
          <span className="block text-[15px] font-extrabold">
            {streak > 0 ? `${streak}-day streak` : 'Start a streak tonight'}
          </span>
          <span className="block text-[11px] font-semibold text-ink-300">
            Best: {Math.max(best, streak)} days · keep the music alive
          </span>
        </span>
      </div>

      {/* v5.12.0 — daily listening goal (set in Settings → Playback) */}
      <GoalRing />

      {/* v5.17.0 — 12-week listening calendar */}
      <ListeningCalendar entries={entries} />

      {/* Year in Music recap */}
      <Link
        to="/recap"
        className="block rounded-2xl border border-ember-400/25 p-4 transition hover:opacity-90"
        style={{ background: 'linear-gradient(120deg, rgba(99,102,241,0.20), rgba(45,212,191,0.09))' }}
      >
        <span className="flex items-center justify-between gap-3">
          <span>
            <span className="block text-[15px] font-extrabold">Your Year in Music ✨</span>
            <span className="block text-[11px] font-semibold text-ink-300">
              Your persona, top artists and a share-anywhere card — built on this device
            </span>
          </span>
          <span className="text-ink-300 font-extrabold" aria-hidden>›</span>
        </span>
      </Link>

      {/* top artists */}
      <section>
        <h2 className="text-base font-extrabold mb-2.5">Top artists</h2>
        <ul className="space-y-2">
          {stats.topArtists.map(([name, count], i) => (
            <li key={name} className="flex items-center gap-3">
              <span className="w-5 text-[13px] font-extrabold text-ink-500">{i + 1}</span>
              <span
                className="w-[38px] h-[38px] rounded-full flex items-center justify-center text-sm font-extrabold text-white shrink-0"
                style={{ background: `linear-gradient(135deg, ${BAR_COLORS[i % BAR_COLORS.length]}55, #164e63)` }}
              >
                {name[0]?.toUpperCase()}
              </span>
              <span className="flex-1 min-w-0 text-[13px] font-bold truncate">{name}</span>
              <span className="w-[110px] h-1.5 rounded-full bg-[var(--track)] overflow-hidden shrink-0">
                <span
                  className="block h-full rounded-full"
                  style={{ width: `${Math.max(8, (count / stats.maxArtist) * 100)}%`, background: 'linear-gradient(90deg, #22d3ee, #a78bfa)' }}
                />
              </span>
              <span className="w-8 text-right text-[11px] font-bold text-ink-400 shrink-0">{count}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* languages */}
      <section>
        <h2 className="text-base font-extrabold mb-2.5">Languages</h2>
        <div className="h-3.5 rounded-full overflow-hidden flex border border-[var(--glass-border)]">
          {stats.langs.map((l, i) => (
            <span key={l.name} style={{ width: `${l.pct}%`, background: BAR_COLORS[i % BAR_COLORS.length] }} />
          ))}
        </div>
        <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
          {stats.langs.map((l, i) => (
            <span key={l.name} className="inline-flex items-center gap-1.5 text-[11px] font-bold text-ink-300">
              <span className="w-[9px] h-[9px] rounded-[3px]" style={{ background: BAR_COLORS[i % BAR_COLORS.length] }} />
              {l.name} {l.pct}%
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}
