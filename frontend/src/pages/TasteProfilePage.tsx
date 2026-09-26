import { lazy, Suspense, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { songPath } from '@/utils/slug';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useTasteInsights } from '@/features/taste-profile/useTasteInsights';
import { useRegion } from '@/features/location/useRegion';
import type { SliderKey } from '@/services/personalization/profile';
import { loadProfile, withProfile } from '@/services/personalization/storage';
import { getSliders, DEFAULT_SLIDERS } from '@/services/personalization/dials';
import { PageSkeleton } from '@/components/Skeletons';
import { EmptyState, ErrorState } from '@/components/States';
import { SoftMuteList } from '@/features/personalization/SoftMuteList';
import { PersonalizationPreview } from '@/features/personalization/PersonalizationPreview';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import '@/styles/pages/secondary.css';

const ResetTasteSheet = lazy(() => import('@/features/personalization/ResetTasteSheet').then((m) => ({ default: m.ResetTasteSheet })));

function Bar({ label, value, max, suffix }: { label: string; value: number; max: number; suffix?: string }) {
  const pct = max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 0;
  return (
    <div className="vx-meter">
      <span title={label}>{label}</span>
      <div className="vx-bar" aria-hidden>
        <span style={{ width: `${pct}%` }} />
      </div>
      <span>{suffix ?? value.toFixed(0)}</span>
    </div>
  );
}

function Section({ title, children, note }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="vx-sec-block">
      <h2 className="vx-sec-title">{title}</h2>
      {note && <p className="vx-sec-lede">{note}</p>}
      <div className="vx-group is-padded space-y-1">{children}</div>
    </section>
  );
}

const DIALS: Array<{ key: SliderKey; left: string; right: string; hint: string }> = [
  { key: 'adventurous', left: 'Familiar', right: 'Adventurous', hint: 'How far to roam from your usual favourites.' },
  { key: 'recency', left: 'Classics', right: 'New releases', hint: 'Lean timeless and older, or fresh and current.' },
  { key: 'energy', left: 'Melody', right: 'Beats', hint: 'Mellow and melodic, or high-energy and rhythmic.' },
  { key: 'vocalness', left: 'Instrumental', right: 'Vocal', hint: 'Room for instrumentals, or vocals up front.' },
];

/** Persist one hand-tuned dial (0..1, clamped) into the on-device profile.
 *  Additive: leaves every other dial and the schema version untouched, so a v1
 *  profile that predates C3 upgrades cleanly on the first drag. Colocated with
 *  its sole caller so the dials module stays a pure, eager-graph-neutral leaf. */
function persistDial(key: SliderKey, value: number): void {
  const v = Math.max(0, Math.min(1, value));
  withProfile((profile) => {
    const cur = profile.sliders ?? { ...DEFAULT_SLIDERS };
    cur[key] = v;
    profile.sliders = cur;
    return profile;
  });
}

/** Package C3 — four hand-tuned dials that steer recommendations. Neutral
 *  (centre) defers to your listening; each drag saves instantly, on-device. */
function TasteDials() {
  const [vals, setVals] = useState(() => getSliders(loadProfile()));
  const onChange = (key: SliderKey, v: number) => {
    setVals((p) => ({ ...p, [key]: v }));
    persistDial(key, v);
  };
  return (
    <Section
      title="Fine-tune your mix"
      note="Centre means your listening decides. Saved only on this device."
    >
      <div className="space-y-6">
        {DIALS.map((d) => (
          <div key={d.key}>
            <div className="flex justify-between text-[14px] font-semibold text-ink-100 mb-2">
              <span>{d.left}</span>
              <span>{d.right}</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={vals[d.key]}
              onChange={(e) => onChange(d.key, Number(e.target.value))}
              aria-label={`${d.left} to ${d.right}`}
              aria-valuetext={vals[d.key] <= 0.3 ? d.left : vals[d.key] >= 0.7 ? d.right : 'Balanced'}
              className="w-full accent-ember-500 cursor-pointer"
            />
            <p className="text-[13px] text-ink-400 mt-1.5">{d.hint}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

export default function TasteProfilePage() {
  usePageTitle('Taste Profile');
  const { data, isLoading, isError, refetch } = useTasteInsights();
  const region = useRegion();
  const queryClient = useQueryClient();
  const [resetOpen, setResetOpen] = useState(false);
  const afterReset = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['taste-insights'] });
  };

  // The read is on-device only, but the event log can still fail to open.
  if (isError) {
    return (
      <ErrorState
        title="Couldn’t read your taste profile"
        message="The listening log on this device didn’t open. Nothing is lost — try again."
        retry={() => void refetch()}
      />
    );
  }
  if (isLoading || !data) return <PageSkeleton />;

  const hasSignal = data.totals.plays > 0;
  const maxLang = Math.max(...data.topLanguages.map((l) => l.score), 1);
  const maxArtist = Math.max(...data.topArtists.map((a) => a.score), 1);
  const maxHour = Math.max(...data.hourHistogram, 1);
  const maxDay = Math.max(...data.recentTrend.map((d) => d.plays), 1);

  return (
    <div className="vx-sec">
      <PageHeader title="Your taste profile" subtitle="Computed and stored only on this device. It powers Made for you." />

      {/* 7.2 — the same plain-words preview Settings shows, and the way to add to it. */}
      <div className="vx-sec-block">
        <PersonalizationPreview showProfileLink={false} />
      </div>

      <TasteDials />

      {!hasSignal ? (
        <EmptyState
          title="Not enough signal yet"
          message="Play a handful of songs and your taste profile will take shape here — languages, artists, habits, and how your mixes are built."
          action={<Link to="/discover" className="px-5 py-2.5 rounded-full btn-primary">Start listening</Link>}
        />
      ) : (
        <>
          <Section title="Confidence" note="How much listening signal your profile has — recommendations blend toward popularity when this is low.">
            <Bar label="Profile confidence" value={data.confidence * 100} max={100} suffix={`${Math.round(data.confidence * 100)}%`} />
          </Section>

          <Section title="Top languages" note="Time-decayed affinity from plays, completions, favorites, and skips.">
            {data.topLanguages.map((l) => (
              <Bar key={l.id} label={l.label} value={l.score} max={maxLang} suffix={`${l.plays} plays`} />
            ))}
            {data.topLanguages.length === 0 && <p className="text-sm text-ink-400">No language signal yet.</p>}
          </Section>

          <Section title="Top artists">
            {data.topArtists.map((a) => (
              <Bar key={a.name} label={a.name} value={a.score} max={maxArtist} suffix={`${a.plays} plays`} />
            ))}
          </Section>

          <Section title="Most replayed">
            {data.mostReplayed.map((s) => (
              <div key={s.songId} className="flex items-center justify-between min-h-[36px] text-[14px]">
                <Link to={songPath({ id: s.songId, title: s.title })} className="truncate font-semibold text-ink-100 hover:underline">{s.title}</Link>
                <span className="text-ink-400 shrink-0 ml-3 tabular-nums">{s.count}×</span>
              </div>
            ))}
            {data.mostReplayed.length === 0 && <p className="text-sm text-ink-400">No repeats yet.</p>}
          </Section>

          <Section title="Listening clock" note="Plays by hour of day — feeds time-of-day shelves like Night Vibes.">
            <div className="flex items-end gap-1 h-28 pb-4 relative">
              {data.hourHistogram.map((v, h) => (
                <div key={h} className="flex-1 h-full flex flex-col justify-end items-center relative">
                  <div className="w-full rounded-t-[3px] bg-ember-500/80" style={{ height: `${Math.max(3, (v / maxHour) * 100)}%` }} />
                  {h % 6 === 0 && <span className="absolute -bottom-4 text-[10px] font-semibold text-ink-400 tabular-nums">{h}</span>}
                </div>
              ))}
            </div>
          </Section>

          <Section title="Last 7 days">
            {data.recentTrend.map((d) => (
              <Bar key={d.day} label={d.day} value={d.plays} max={maxDay} suffix={`${d.plays}`} />
            ))}
          </Section>

          <Section title="Completion and skips" note="Low-skip listening strengthens recommendations for that language/artist.">
            <div className="vx-kpis is-four">
              {[
                [data.listeningMinutes >= 60 ? `${Math.floor(data.listeningMinutes / 60)}h ${data.listeningMinutes % 60}m` : `${data.listeningMinutes}m`, 'Listened (≈)'],
                [String(data.totals.completes), 'Completed'],
                [String(data.totals.skips), 'Skipped'],
                [data.completionRate != null ? `${Math.round(data.completionRate * 100)}%` : '—', 'Completion rate'],
              ].map(([v, l]) => (
                <div key={l} className="vx-kpi !p-0 !bg-transparent !shadow-none">
                  <span className="vx-kpi-label">{l}</span>
                  <span className="vx-kpi-value">{v}</span>
                </div>
              ))}
            </div>
          </Section>
        </>
      )}

      <Section
        title="Playing less of"
        note="Artists you asked to hear less of with “Less like this”. Each comes back on its own; Never play, in Settings, is the permanent block."
      >
        <SoftMuteList />
      </Section>

      <Section title="How recommendations are formed">
        <p className="text-[14px] text-ink-300 leading-relaxed">
          Each candidate song is scored by language affinity, artist affinity, popularity, low-skip
          rate, and source (similar-to / trending / rediscovery), with time decay and a repetition
          guard. Region source:{' '}
          <span className="text-ink-100 font-medium">
            {region ? `${region.country ?? 'unknown'} (${region.source})` : 'unknown'}
          </span>
          . Adjust intensity in <Link to="/settings" className="vx-link">Settings</Link>.
        </p>
      </Section>

      <div className="vx-group">
        <button onClick={() => setResetOpen(true)} className="vx-row">
          <span className="vx-row-main">
            <span className="vx-row-label" style={{ color: 'var(--vx-danger)' }}>Reset personalization</span>
            <span className="vx-row-hint">A backup is offered first. Favourites, playlists and history are not touched.</span>
          </span>
        </button>
      </div>
      {resetOpen && (
        <Suspense fallback={null}>
          <ResetTasteSheet onClose={() => setResetOpen(false)} onDone={afterReset} />
        </Suspense>
      )}
    </div>
  );
}
