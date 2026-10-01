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
import { ArtistAvatar, Collage, artistPictures, mostPlayed } from '@/features/stats/artwork';
import { cn } from '@/utils/cn';
import type { HistoryEntry } from '@/types';
import { coverageNote, formatHours, historyCoverage, listeningTotal, HISTORY_CAP } from '@/features/stats/listening';
import { PageHeader } from '@/components/PageHeader';
import { SectionHeader } from '@/components/SectionHeader';
import { SongRow } from '@/components/SongRow';
import { ChevronRightIcon, ShareIcon, WaveIcon } from '@/components/Icons';
import '@/styles/pages/secondary.css';

/** One hue at falling strength: the language split reads as parts of one whole. */
const SHARE_ALPHA = [1, 0.72, 0.5, 0.34, 0.2];
const shareColor = (i: number): string => `rgb(var(--ember-500) / ${SHARE_ALPHA[i % SHARE_ALPHA.length]})`;

/** v5.17.0 — the change against last week, in an arrow and in words. */
function Delta({ value, suffix = '' }: { value: number; suffix?: string }) {
  if (value === 0) return <span className="vx-kpi-delta text-ink-400">No change<span className="vx-delta-ctx"> from last week</span></span>;
  const up = value > 0;
  return (
    <span className="vx-kpi-delta" style={{ color: up ? 'var(--vx-success)' : 'var(--vx-danger)' }}>
      <span aria-hidden>{up ? '▲' : '▼'} </span>
      <span className="sr-only">{up ? 'Up ' : 'Down '}</span>
      {Math.abs(value)}{suffix}<span className="vx-delta-ctx"> vs last week</span>
    </span>
  );
}

/** v5.17.0 — Weekly report: this week against the seven days before. */
function WeeklyReportCard({ entries }: { entries: HistoryEntry[] }) {
  const report = useMemo(() => weeklyReport(entries), [entries]);
  const { thisWeek, lastWeek, delta, coverage } = report;
  if (thisWeek.songs === 0 && lastWeek.songs === 0) return null;
  const note = coverageNote(coverage, 'the comparison');
  const tiles: Array<{ label: string; value: string; delta: number; suffix?: string }> = [
    { label: thisWeek.estimated ? 'Minutes (est.)' : 'Minutes', value: `${thisWeek.estimated ? '≈' : ''}${thisWeek.minutes}`, delta: delta.minutes, suffix: ' min' },
    { label: 'Songs', value: String(thisWeek.songs), delta: delta.songs },
    { label: 'New artists', value: String(thisWeek.newArtists), delta: delta.newArtists },
  ];
  return (
    <section aria-label="Weekly report" className="vx-sec-block">
      <SectionHeader title="This week’s report" explanation="The last 7 days against the 7 before." />
      <div className="vx-kpis is-three-always">
        {tiles.map((t) => (
          <div key={t.label} className="vx-kpi">
            <span className="vx-kpi-label">{t.label}</span>
            <span className="vx-kpi-value">{t.value}</span>
            <Delta value={t.delta} suffix={t.suffix} />
          </div>
        ))}
      </div>
      <dl className="vx-group mt-6">
        {([
          ['Top artist', thisWeek.topArtist, lastWeek.topArtist],
          ['Top language', thisWeek.topLanguage, lastWeek.topLanguage],
        ] as const).map(([label, now, before]) => (
          <div key={label} className="vx-row">
            <dt className="vx-row-main vx-row-label">{label}</dt>
            <dd className="min-w-0 text-right">
              <span className="block text-[15px] font-semibold text-ink-100 break-words">{now ?? '—'}</span>
              {before && before !== now && <span className="block text-[12.5px] text-ink-400">was {before}</span>}
            </dd>
          </div>
        ))}
      </dl>
      {(thisWeek.estimated || note) && (
        <p className="vx-sec-foot">
          {thisWeek.estimated && 'Minutes marked ≈ are estimated from track lengths for plays recorded before VinaX measured playback. '}
          {note}
        </p>
      )}
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
  const coverage = coverageNote(cal.coverage, 'this calendar');
  return (
    <section aria-label="Listening calendar" className="vx-sec-block">
      <SectionHeader
        title="Listening calendar"
        explanation={`${cal.activeDays} active ${cal.activeDays === 1 ? 'day' : 'days'} in the last 12 weeks${cal.estimated ? ' · minutes ≈ estimated' : ''}`}
      />
      {coverage && <p className="vx-sec-lede">{coverage}</p>}
      <div className="overflow-x-auto pb-1">
        <div className="flex gap-1.5 min-w-max">
          <div className="grid grid-rows-7 gap-[3px] pt-[16px]">
            {DOW.map((d, i) => (
              <span key={i} className="h-3.5 text-[10.5px] leading-[14px] font-semibold text-ink-400 w-8">{d}</span>
            ))}
          </div>
          <div>
            <div className="grid grid-flow-col gap-[3px] mb-[2px]" style={{ gridTemplateColumns: `repeat(${cal.weeks}, 0.875rem)` }}>
              {monthLabels.map((m, i) => (
                <span key={i} className="h-3.5 text-[10.5px] leading-[14px] font-semibold text-ink-400 whitespace-nowrap">{m ?? ''}</span>
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
                    'block w-3.5 h-3.5 rounded-[4px] outline-none focus-visible:ring-2 focus-visible:ring-ember-400',
                    c.future ? 'opacity-0' : 'bg-[var(--track)]',
                    c.today && 'ring-1 ring-ink-300',
                  )}
                  style={c.level > 0 ? { background: `rgb(var(--ember-500) / ${LEVEL_ALPHA[c.level]})` } : undefined}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="mt-5 flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[14px] font-medium text-ink-400">
          Current streak <span className="text-ink-100 font-bold tabular-nums">{cal.currentStreak}</span> day{cal.currentStreak === 1 ? '' : 's'}
          <span aria-hidden> · </span>
          Longest <span className="text-ink-100 font-bold tabular-nums">{cal.longestStreak}</span> day{cal.longestStreak === 1 ? '' : 's'}
        </p>
        <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-ink-400" aria-hidden>
          Less
          {LEVEL_ALPHA.map((a, i) => (
            <span
              key={i}
              className={cn('w-3 h-3 rounded-[3px]', i === 0 && 'bg-[var(--track)]')}
              style={i > 0 ? { background: `rgb(var(--ember-500) / ${a})` } : undefined}
            />
          ))}
          More
        </span>
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
    // One shared rule for listening time (features/stats/listening.ts).
    const total = listeningTotal(entries);
    for (const e of entries) {
      const s = e.song;
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
      hours: formatHours(total),
      estimated: total.estimated,
      capped: historyCoverage(entries, -Infinity).capped,
      artists: artistCount.size,
      topArtists,
      maxArtist: topArtists[0]?.[1] ?? 1,
      langs: langRows.map(([name, c]) => ({ name, pct: Math.round((c / totalLang) * 100) })),
    };
  }, [entries]);
  const top = useMemo(() => mostPlayed(entries, 5), [entries]);
  const pictures = useMemo(() => artistPictures([...entries.map((e) => e.song), ...favorites]), [entries, favorites]);

  const streak = getStreak();
  const best = getBestStreak();

  const share = (): void => {
    const text = `My VinaX: ${stats.plays} plays · ${stats.hours} listened · ${streak}-day streak 🎵 sirimillavinay.online`;
    if (navigator.share) {
      void navigator.share({ text }).catch(() => undefined);
    } else {
      void navigator.clipboard?.writeText(text).then(() => toast('Copied — paste it anywhere'));
    }
  };

  if (!entries.length) {
    return (
      <div className="vx-empty-page">
        <span className="vx-empty-icon" aria-hidden>
          <WaveIcon className="w-9 h-9" />
        </span>
        <h1>Your VinaX</h1>
        <p>Play a few songs and your stats appear here — computed on this device, never uploaded.</p>
        <Link to="/" className="px-6 py-3 rounded-full btn-primary">Start listening</Link>
      </div>
    );
  }

  const kpis: Array<[string, string]> = [
    [String(stats.plays), stats.capped ? `Last ${HISTORY_CAP} plays` : 'Plays'],
    [stats.hours, stats.estimated ? 'Listened (est.)' : 'Listened'],
    [String(favorites.length), 'Favorites'],
    [String(stats.artists), 'Artists'],
  ];

  return (
    <div className="vx-sec is-wide">
      <PageHeader
        title="Your VinaX"
        subtitle={`Computed on this device · never uploaded${stats.capped ? ` · history keeps your last ${HISTORY_CAP} plays` : ''}`}
        actions={
          <button type="button" onClick={share} className="vx-sec-pill">
            <ShareIcon className="w-4 h-4" /> Share
          </button>
        }
      />

      {/* Artwork first: the covers of what you played most, then the four numbers. */}
      <section aria-label="Your listening at a glance" className="vx-sec-block vx-hero-row is-inline">
        <Collage songs={top.map((t) => t.song)} />
        <div className="vx-kpis is-four w-full">
          {kpis.map(([n, l]) => (
            <div key={l} className="vx-kpi">
              <span className="vx-kpi-label">{l}</span>
              <span className="vx-kpi-value">{n}</span>
            </div>
          ))}
        </div>
      </section>

      {top.length > 0 && (
        <section aria-label="Most played lately" className="vx-sec-block">
          <SectionHeader title="Most played lately" explanation={`From your last ${stats.plays} ${stats.plays === 1 ? 'play' : 'plays'}, most played first.`} />
          <div>
            {top.map((t, i) => (
              <SongRow key={t.song.id} song={t.song} songs={top.map((x) => x.song)} index={i} />
            ))}
          </div>
        </section>
      )}

      {/* v5.17.0 — weekly report */}
      <WeeklyReportCard entries={entries} />

      {/* Streak, daily goal (set in Settings) and the year recap. */}
      <section aria-label="Streak and goal" className="vx-sec-block">
        <SectionHeader title="Keep it going" />
        <div className="vx-group">
          <div className="vx-row">
            <span className="vx-row-main">
              <span className="vx-row-label">{streak > 0 ? `${streak}-day streak` : 'No streak yet'}</span>
              <span className="vx-row-hint">{streak > 0 ? 'Listen today to keep it going' : 'Play a song today to start one'}</span>
            </span>
            <span className="vx-row-value">Best {Math.max(best, streak)} day{Math.max(best, streak) === 1 ? '' : 's'}</span>
          </div>
          <Link to="/recap" className="vx-row is-link">
            <span className="vx-row-main">
              <span className="vx-row-label">Your year in music</span>
              <span className="vx-row-hint">Your persona, top artists and a share card</span>
            </span>
            <ChevronRightIcon className="vx-row-chev" />
          </Link>
        </div>
        <div className="vx-stats-goal mt-2">
          <GoalRing />
        </div>
      </section>

      {/* v5.17.0 — 12-week listening calendar */}
      <ListeningCalendar entries={entries} />

      <div className="vx-two">
        <section aria-label="Top artists">
          <SectionHeader title="Top artists" explanation="Plays in your history." />
          <ol className="vx-group">
            {stats.topArtists.map(([name, count], i) => (
              <li key={name} className="vx-row">
                <span className="vx-row-rank">{i + 1}</span>
                <ArtistAvatar name={name} image={pictures.get(name.trim().toLowerCase())} size={44} />
                <span className="vx-row-main">
                  <span className="vx-row-label truncate-1">{name}</span>
                  <span className="vx-bar mt-2" aria-hidden>
                    <span style={{ width: `${Math.max(6, (count / stats.maxArtist) * 100)}%` }} />
                  </span>
                </span>
                <span className="vx-row-value w-10">{count}</span>
              </li>
            ))}
          </ol>
        </section>

        <section aria-label="Languages">
          <SectionHeader title="Languages" explanation="Share of your plays." />
          <div className="h-3 rounded-full overflow-hidden flex gap-[2px]" aria-hidden>
            {stats.langs.map((l, i) => (
              <span key={l.name} style={{ width: `${l.pct}%`, background: shareColor(i) }} />
            ))}
          </div>
          <ul className="vx-group mt-3">
            {stats.langs.map((l, i) => (
              <li key={l.name} className="vx-row !min-h-[48px]">
                <span className="w-3 h-3 rounded-[4px] shrink-0" style={{ background: shareColor(i) }} aria-hidden />
                <span className="vx-row-main vx-row-label truncate-1">{l.name}</span>
                <span className="vx-row-value">{l.pct}%</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
