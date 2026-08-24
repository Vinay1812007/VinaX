import { useState, type ReactNode } from 'react';
import { songPath } from '@/utils/slug';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useTasteInsights } from '@/features/taste-profile/useTasteInsights';
import { useRegion } from '@/features/location/useRegion';
import { clearPersonalization } from '@/features/settings/actions';
import type { SliderKey } from '@/services/personalization/profile';
import { loadProfile, withProfile } from '@/services/personalization/storage';
import { getSliders, DEFAULT_SLIDERS } from '@/services/personalization/dials';
import { PageSkeleton } from '@/components/Skeletons';
import { EmptyState } from '@/components/States';
import { Link } from 'react-router-dom';

function Bar({ label, value, max, suffix }: { label: string; value: number; max: number; suffix?: string }) {
  const pct = max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-28 truncate text-ink-200">{label}</span>
      <div className="flex-1 h-2.5 rounded-full bg-ink-800 overflow-hidden">
        <div className="h-full rounded-full bg-gradient-to-r from-ember-600 to-ember-400" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-14 text-right text-xs text-ink-400 tabular-nums">{suffix ?? value.toFixed(0)}</span>
    </div>
  );
}

function Section({ title, children, note }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-ink-700 bg-ink-850/50 p-5 mb-5">
      <h2 className="text-base font-bold mb-1">{title}</h2>
      {note && <p className="text-xs text-ink-400 mb-3">{note}</p>}
      <div className="space-y-2.5 mt-3">{children}</div>
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
      note="Nudge these to steer your recommendations. Centre means your listening decides. Saved only on this device."
    >
      <div className="space-y-4 mt-1">
        {DIALS.map((d) => (
          <div key={d.key}>
            <div className="flex justify-between text-xs font-semibold text-ink-200 mb-1.5">
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
            <p className="text-[11px] text-ink-500 mt-1">{d.hint}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

export default function TasteProfilePage() {
  usePageTitle('Taste Profile');
  const { data, isLoading } = useTasteInsights();
  const region = useRegion();

  if (isLoading || !data) return <PageSkeleton />;

  const hasSignal = data.totals.plays > 0;
  const maxLang = Math.max(...data.topLanguages.map((l) => l.score), 1);
  const maxArtist = Math.max(...data.topArtists.map((a) => a.score), 1);
  const maxHour = Math.max(...data.hourHistogram, 1);
  const maxDay = Math.max(...data.recentTrend.map((d) => d.plays), 1);

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-display tracking-tight mb-1">Your Taste Profile</h1>
      <p className="text-sm text-ink-400 mb-6">
        Everything below is computed and stored only on this device. It powers Made For You.
      </p>

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

          <Section title="Top Languages" note="Time-decayed affinity from plays, completions, favorites, and skips.">
            {data.topLanguages.map((l) => (
              <Bar key={l.id} label={l.label} value={l.score} max={maxLang} suffix={`${l.plays} plays`} />
            ))}
            {data.topLanguages.length === 0 && <p className="text-sm text-ink-400">No language signal yet.</p>}
          </Section>

          <Section title="Top Artists">
            {data.topArtists.map((a) => (
              <Bar key={a.name} label={a.name} value={a.score} max={maxArtist} suffix={`${a.plays} plays`} />
            ))}
          </Section>

          <Section title="Most Replayed">
            {data.mostReplayed.map((s) => (
              <div key={s.songId} className="flex items-center justify-between text-sm">
                <Link to={songPath({ id: s.songId, title: s.title })} className="truncate hover:text-ember-400">{s.title}</Link>
                <span className="text-xs text-ink-400 shrink-0 ml-3">{s.count}×</span>
              </div>
            ))}
            {data.mostReplayed.length === 0 && <p className="text-sm text-ink-400">No repeats yet.</p>}
          </Section>

          <Section title="Listening Clock" note="Plays by hour of day — feeds time-of-day shelves like Night Vibes.">
            <div className="flex items-end gap-1 h-24">
              {data.hourHistogram.map((v, h) => (
                <div key={h} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full rounded-t bg-tide-500/70" style={{ height: `${Math.max(3, (v / maxHour) * 100)}%` }} />
                  {h % 6 === 0 && <span className="text-[9px] text-ink-500">{h}</span>}
                </div>
              ))}
            </div>
          </Section>

          <Section title="Last 7 Days">
            {data.recentTrend.map((d) => (
              <Bar key={d.day} label={d.day} value={d.plays} max={maxDay} suffix={`${d.plays}`} />
            ))}
          </Section>

          <Section title="Completion vs Skips" note="Low-skip listening strengthens recommendations for that language/artist.">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
              <div className="rounded-xl bg-ink-800 p-3">
                <p className="text-2xl font-bold text-tide-400">{data.listeningMinutes >= 60 ? `${Math.floor(data.listeningMinutes / 60)}h ${data.listeningMinutes % 60}m` : `${data.listeningMinutes}m`}</p>
                <p className="text-xs text-ink-400">listened (≈)</p>
              </div>
              <div className="rounded-xl bg-ink-800 p-3">
                <p className="text-2xl font-bold">{data.totals.completes}</p>
                <p className="text-xs text-ink-400">completed</p>
              </div>
              <div className="rounded-xl bg-ink-800 p-3">
                <p className="text-2xl font-bold text-ember-400">{data.totals.skips}</p>
                <p className="text-xs text-ink-400">skipped</p>
              </div>
              <div className="rounded-xl bg-ink-800 p-3">
                <p className="text-2xl font-bold">{data.completionRate != null ? `${Math.round(data.completionRate * 100)}%` : '—'}</p>
                <p className="text-xs text-ink-400">completion rate</p>
              </div>
            </div>
          </Section>
        </>
      )}

      <Section
        title="How recommendations are formed"
        note="Your taste profile stays on your device."
      >
        <p className="text-sm text-ink-300 leading-relaxed">
          Each candidate song is scored by language affinity, artist affinity, popularity, low-skip
          rate, and source (similar-to / trending / rediscovery), with time decay and a repetition
          guard. Region source:{' '}
          <span className="text-ink-100 font-medium">
            {region ? `${region.country ?? 'unknown'} (${region.source})` : 'unknown'}
          </span>
          . Adjust intensity in <Link to="/settings" className="text-ember-400">Settings</Link>.
        </p>
      </Section>

      <button
        onClick={() => {
          if (window.confirm('Reset all personalization? Your favorites and queue stay; the taste profile and event log are erased.')) {
            void clearPersonalization();
          }
        }}
        className="w-full mt-2 px-5 py-3 rounded-2xl border border-red-500/40 text-red-300 font-semibold hover:bg-red-500/10"
      >
        Reset personalization
      </button>
    </div>
  );
}
