import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react';
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
import { ArtistAvatar, Collage, artistPictures, songIndex } from '@/features/stats/artwork';
import { useHistoryStore } from '@/store/historyStore';
import { useLibraryStore } from '@/store/libraryStore';
import { bestImage } from '@/utils/images';
import type { Song } from '@/types';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { SectionHeader } from '@/components/SectionHeader';
import '@/styles/pages/secondary.css';

const ResetTasteSheet = lazy(() => import('@/features/personalization/ResetTasteSheet').then((m) => ({ default: m.ResetTasteSheet })));

function Bar({ label, value, max, suffix }: { label: string; value: number; max: number; suffix?: string }) {
  const pct = max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 0;
  return (
    <div className="vx-meter">
      <span title={label}>{label}</span>
      <span className="vx-bar" aria-hidden>
        <span style={{ width: `${pct}%` }} />
      </span>
      <span>{suffix ?? value.toFixed(0)}</span>
    </div>
  );
}

/** A titled block of the page: SectionHeader, then its content. */
function Section({ title, children, note }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="vx-sec-block" aria-label={title}>
      <SectionHeader title={title} explanation={note} />
      {children}
    </section>
  );
}

/** Big tabular numbers with their labels; an estimate says so in its label. */
function Numbers({ items, columns }: { items: Array<[string, string]>; columns: 'is-three' | 'is-four' }) {
  return (
    <div className={`vx-kpis ${columns}`}>
      {items.map(([v, l]) => (
        <div key={l} className="vx-kpi">
          <span className="vx-kpi-label">{l}</span>
          <span className="vx-kpi-value">{v}</span>
        </div>
      ))}
    </div>
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
    <Section title="Fine-tune your mix" note="Centre means your listening decides. Saved only on this device.">
      <div className="vx-group">
        {DIALS.map((d) => (
          <div key={d.key} className="vx-row !block !py-4">
            <div className="flex justify-between gap-4 text-[14px] font-semibold text-ink-100 mb-2">
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

const MOOD_LABEL: Record<string, string> = { romantic: 'Romantic', energetic: 'Energetic', chill: 'Chill', melancholy: 'Sad and soulful', devotional: 'Devotional' };
const MODE_LABEL: Record<string, string> = { familiar: 'Familiar', balanced: 'Balanced', discover: 'Discover' };
const pct = (v: number | null): string => (v == null ? '—' : `${Math.round(v * 100)}%`);
const hours = (h: number): string => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;

export default function TasteProfilePage() {
  usePageTitle('Taste Profile');
  const { data, isLoading, isError, refetch } = useTasteInsights();
  const region = useRegion();
  const queryClient = useQueryClient();
  const entries = useHistoryStore((s) => s.entries);
  const favorites = useLibraryStore((s) => s.favorites);
  const [resetOpen, setResetOpen] = useState(false);
  const afterReset = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['taste-insights'] });
  };
  // Covers and pictures come from songs already on this device — nothing is fetched for them.
  const songs = useMemo(() => songIndex(entries, favorites), [entries, favorites]);
  const pictures = useMemo(() => artistPictures(songs.values()), [songs]);

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
  const peakHour = data.hourHistogram.indexOf(Math.max(...data.hourHistogram));
  // The hero's covers: the songs you replay most, then your newest plays.
  const heroSongs: Song[] = [...data.mostReplayed.map((r) => songs.get(r.songId)).filter((s): s is Song => !!s), ...entries.map((e) => e.song)];

  return (
    <div className="vx-sec is-wide">
      <PageHeader title="Your taste profile" subtitle="Computed and stored only on this device. It powers Made for you." />

      {hasSignal && (
        <section aria-label="Profile confidence" className="vx-sec-block vx-hero-row is-inline">
          <Collage songs={heroSongs} />
          <div>
            <p className="vx-hero-figure">{Math.round(data.confidence * 100)}%</p>
            <p className="vx-hero-caption">
              Profile confidence — how much listening signal VinaX has. Recommendations lean on what is popular while this is low.
            </p>
            <span className="vx-bar mt-4 max-w-[360px]" aria-hidden>
              <span style={{ width: `${Math.max(4, Math.round(data.confidence * 100))}%` }} />
            </span>
            <p className="mt-3 text-[13px] font-semibold text-ink-400 tabular-nums">
              {data.totals.plays} {data.totals.plays === 1 ? 'play' : 'plays'} counted
              {data.hourHistogram.some((v) => v > 0) && <> · most often around {hours(peakHour)}</>}
            </p>
          </div>
        </section>
      )}

      {/* 7.2 — the same plain-words preview Settings shows, and the way to add to it. */}
      <Section title="What VinaX thinks you like" note="Read from the profile on this device. Nothing here is uploaded.">
        <PersonalizationPreview showProfileLink={false} />
      </Section>

      <TasteDials />

      {!hasSignal ? (
        <EmptyState
          title="Not enough signal yet"
          message="Play a handful of songs and your taste profile will take shape here — languages, artists, habits, and how your mixes are built."
          action={<Link to="/discover" className="px-5 py-2.5 rounded-full btn-primary">Start listening</Link>}
        />
      ) : (
        <>
          <div className="vx-two vx-sec-block">
            <section aria-label="Top languages">
              <SectionHeader title="Top languages" explanation="Time-decayed affinity from plays, completions, favorites and skips." />
              {data.topLanguages.map((l) => (
                <Bar key={l.id} label={l.label} value={l.score} max={maxLang} suffix={`${l.plays} plays`} />
              ))}
              {data.topLanguages.length === 0 && <p className="text-sm text-ink-400">No language signal yet.</p>}
            </section>

            <section aria-label="Top artists">
              <SectionHeader title="Top artists" explanation="The same signal, per artist." />
              <ol className="vx-group">
                {data.topArtists.map((a) => (
                  <li key={a.name} className="vx-row !min-h-[56px]">
                    <ArtistAvatar name={a.name} image={pictures.get(a.name.trim().toLowerCase())} size={40} />
                    <span className="vx-row-main">
                      <span className="vx-row-label truncate-1">{a.name}</span>
                      <span className="vx-bar mt-2" aria-hidden>
                        <span style={{ width: `${Math.max(4, Math.round((a.score / maxArtist) * 100))}%` }} />
                      </span>
                    </span>
                    <span className="vx-row-value is-plays">{a.plays} plays</span>
                  </li>
                ))}
              </ol>
            </section>
          </div>

          <Section title="Most replayed" note="From the listening log on this device.">
            {data.mostReplayed.length ? (
              <ol className="vx-group">
                {data.mostReplayed.map((s, i) => {
                  const song = songs.get(s.songId);
                  return (
                    <li key={s.songId} className="vx-row">
                      <span className="vx-row-rank">{i + 1}</span>
                      {song ? <img src={bestImage(song.images, 100)} alt="" className="vx-row-art" loading="lazy" /> : <span className="vx-row-art" aria-hidden />}
                      <span className="vx-row-main">
                        <Link to={songPath({ id: s.songId, title: s.title })} className="vx-row-label truncate-1 hover:underline">{s.title}</Link>
                        {song?.subtitle && <span className="vx-row-hint truncate-1">{song.subtitle}</span>}
                      </span>
                      <span className="vx-row-value">{s.count}×</span>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="text-sm text-ink-400">No repeats yet.</p>
            )}
          </Section>

          <div className="vx-two vx-sec-block">
            <section aria-label="Listening clock">
              <SectionHeader title="Listening clock" explanation="Plays by hour of day — feeds time-of-day shelves like Night Vibes." />
              <div className="vx-columns" role="img" aria-label={`Plays by hour of day; the busiest hour is ${hours(peakHour)}`}>
                {data.hourHistogram.map((v, h) => (
                  <div key={h}>
                    <i className={v === 0 ? 'is-quiet' : undefined} style={{ height: `${Math.max(3, (v / maxHour) * 100)}%` }} />
                  </div>
                ))}
              </div>
              <div className="vx-columns-axis" aria-hidden>
                {data.hourHistogram.map((_, h) => (
                  <span key={h}>{h % 6 === 0 ? h : ''}</span>
                ))}
              </div>
            </section>

            <section aria-label="Last 7 days">
              <SectionHeader title="Last 7 days" explanation="Plays per day." />
              <div className="vx-columns">
                {data.recentTrend.map((d) => (
                  <div key={d.day}>
                    <span className="vx-columns-value">{d.plays}</span>
                    <i className={d.plays === 0 ? 'is-quiet' : undefined} style={{ height: `${Math.max(3, (d.plays / maxDay) * 80)}%` }} />
                  </div>
                ))}
              </div>
              <div className="vx-columns-axis">
                {data.recentTrend.map((d) => (
                  <span key={d.day}>{d.day}</span>
                ))}
              </div>
            </section>
          </div>

          <Section title="Completion and skips" note="Low-skip listening strengthens recommendations for that language and artist.">
            <Numbers
              columns="is-four"
              items={[
                [data.listeningMinutes >= 60 ? `≈${Math.floor(data.listeningMinutes / 60)}h ${data.listeningMinutes % 60}m` : `≈${data.listeningMinutes}m`, 'Listened (est.)'],
                [String(data.totals.completes), 'Completed'],
                [String(data.totals.skips), 'Skipped'],
                [data.completionRate != null ? `${Math.round(data.completionRate * 100)}%` : '—', 'Completion rate'],
              ]}
            />
          </Section>

          {/* 8.5.0 — the habits the queue and the mixes adapt to. */}
          <Section title="How you listen" note="Skips lower what the queue offers next; the new-to-you share is how often you play artists you have barely heard.">
            <Numbers
              columns="is-three"
              items={[
                [pct(data.skipRate), 'Skip rate'],
                [pct(data.newToYouShare), 'New to you (30 days)'],
                [MODE_LABEL[data.exploration.mode] ?? 'Balanced', 'Discovery mode'],
              ]}
            />
            {data.topMoods.length > 0 && (
              <div className="mt-6">
                {data.topMoods.map((m) => (
                  <Bar key={m.mood} label={MOOD_LABEL[m.mood] ?? m.mood} value={m.share * 100} max={100} suffix={pct(m.share)} />
                ))}
              </div>
            )}
            {data.topGenres.length > 0 && (
              <p className="mt-4 text-[14px] text-ink-300">
                Often in your listening: <span className="text-ink-100 font-semibold">{data.topGenres.join(', ')}</span>
              </p>
            )}
            {(data.totals.dislikes ?? 0) > 0 && (
              <p className="mt-2 text-[14px] text-ink-400">
                {data.totals.dislikes === 1 ? 'One song' : `${data.totals.dislikes} songs`} marked Not interested. Those artists come up less; the songs never play.
              </p>
            )}
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
        <div className="vx-doc">
          <p>
            Each candidate song is scored by language affinity, artist affinity, popularity, low-skip rate, and source
            (similar-to / trending / rediscovery), with time decay and a repetition guard. Region source:{' '}
            <strong>{region ? `${region.country ?? 'unknown'} (${region.source})` : 'unknown'}</strong>. Adjust discovery, languages and
            the trending dial in <Link to="/settings#recommendations">Settings</Link>.
          </p>
        </div>
      </Section>

      <div className="vx-group">
        <button type="button" onClick={() => setResetOpen(true)} className="vx-row vx-row-danger">
          <span className="vx-row-main">
            <span className="vx-row-label">Reset personalization</span>
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
