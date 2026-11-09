import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import { PageHeader } from '@/components/PageHeader';
import { SectionHeader } from '@/components/SectionHeader';
import { FestivalEmblem } from '@/components/FestivalEmblem';
import { Toggle } from '@/features/settings/SettingsControls';
import { FESTIVALS, festivalDay, type Festival } from '@/constants/festivals';
import { FESTIVAL_THEMES } from '@/constants/festivalThemes';
import { festivalVisual } from '@/constants/festivalVisuals';
import { useFestivalNow, useFestivalPreview } from '@/features/festival/festivalPreview';
import { countdownTo, currentOccurrence, festivalsByNextStart, rangeLabel, shortName, upcomingFestivals, windowAround } from '@/features/festival/calendar';
import { fxLine } from '@/features/festival/fx/festivalFx';
import { celebrate } from '@/features/festival/fx/celebrate';
import { useSettingsStore } from '@/store/settingsStore';
import { useClientConfig } from '@/features/home/useAppConfig';
import { toast } from '@/store/toastStore';
import '@/styles/pages/festivals.css';

/**
 * 1.12 — /festivals: the app's festival calendar, live. Today's festival
 * (day x of y) or the next one with a countdown that ticks every second, the
 * next eight with their dates, greetings to share, the switches for themes,
 * animations and sounds, a pinned or automatic look, and every one of the
 * 43 festival looks as an animated card you can preview or play.
 */
const colorsOf = (f: Festival): CSSProperties => ({
  ['--vxf-a' as string]: FESTIVAL_THEMES[f.id]?.accent ?? f.colors[0],
  ['--vxf-b' as string]: f.colors[1] ?? f.colors[0],
  ['--fest-c1' as string]: f.colors[0], ['--fest-c2' as string]: f.colors[1] ?? f.colors[0], ['--fest-c3' as string]: f.colors[2] ?? f.colors[0],
});

function useNow(everyMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), everyMs);
    return () => window.clearInterval(t);
  }, [everyMs]);
  return now;
}

const pad = (n: number) => String(n).padStart(2, '0');

function Clock({ to, now, label }: { to: Date; now: Date; label: string }) {
  const c = countdownTo(to, now);
  return (
    <div className="vxf-clock" role="timer" aria-label={`${label}: ${c.days} days ${c.hours} hours ${c.minutes} minutes ${c.seconds} seconds`}>
      <div><b>{c.days}</b><small>days</small></div>
      <div><b>{pad(c.hours)}</b><small>hours</small></div>
      <div><b>{pad(c.minutes)}</b><small>min</small></div>
      <div><b>{pad(c.seconds)}</b><small>sec</small></div>
    </div>
  );
}

export default function FestivalsPage() {
  usePageTitle('Festivals');
  const navigate = useNavigate();
  const now = useNow();
  const { festival: live, preview, pinned } = useFestivalNow();
  const previewId = useFestivalPreview((s) => s.id);
  const setPreviewId = useFestivalPreview((s) => s.setId);
  const s = useSettingsStore();
  const clientCfg = useClientConfig();

  // The calendar only moves at midnight: these three are keyed on the date, not the second.
  const dayKey = now.toDateString();
  const today = useMemo(() => currentOccurrence(new Date(dayKey)), [dayKey]);
  const upcoming = useMemo(() => upcomingFestivals(new Date(dayKey), 8), [dayKey]);
  const all = useMemo(() => festivalsByNextStart(new Date(dayKey)), [dayKey]);
  const next = upcoming[0] ?? null;
  const hero = live ?? today?.festival ?? next?.festival ?? FESTIVALS[0]!;
  const heroLive = !!live && (preview || pinned || !!today);
  const heroWindow = today?.festival.id === hero.id ? today : null;
  const run = heroWindow ? festivalDay(hero, now) : null;
  const visual = festivalVisual(hero.id);

  const playSongs = (f: Festival, at?: { x: number; y: number }) => {
    celebrate('confetti', { at, palette: f.colors });
    navigate(`/search/${encodeURIComponent(festivalVisual(f.id).query)}`);
  };
  const share = async () => {
    const text = `${hero.greeting}! 🎉 Listening to ${shortName(hero.name)} songs on VinaX — free music in 12 Indian languages.`;
    const url = 'https://www.vinaxmusic.online/festivals';
    try {
      if (navigator.share) { await navigator.share({ title: hero.greeting, text, url }); return; }
      await navigator.clipboard.writeText(`${text} ${url}`);
      toast('Wishes copied — paste them anywhere');
    } catch { /* cancelled */ }
  };

  return (
    <div className="vx-sec vxf">
      <PageHeader title="Festivals" subtitle="Today's celebration, the next ones, and every look the app can wear." />

      <section className="vxf-live" style={colorsOf(hero)} aria-labelledby="vxf-live-title" data-festival={hero.id}>
        <FestivalEmblem id={visual.emblem} />
        <div>
          {heroLive ? (
            <span className="vxf-pill is-live"><i aria-hidden /> {preview ? 'Preview' : pinned ? 'Pinned look' : run ? `Live · Day ${run.day} of ${run.days}` : 'Live now'}</span>
          ) : (
            <span className="vxf-pill">Next up{next ? ` · ${rangeLabel(next.start, next.end)}` : ''}</span>
          )}
          <h2 id="vxf-live-title">{heroLive ? hero.greeting : `${shortName(hero.name)} in ${next?.inDays ?? 0} day${next?.inDays === 1 ? '' : 's'}`}</h2>
          <p>{visual.blurb} {heroLive ? `The whole app wears ${shortName(hero.name)} today, with ${fxLine(hero.id)}.` : `The app dresses up the day before, with ${fxLine(hero.id)}.`}</p>
          {heroLive && heroWindow ? (
            <>
              <Clock to={heroWindow.end} now={now} label={`${shortName(hero.name)} ends in`} />
              {next && <p style={{ marginTop: 10, fontSize: 13 }}>Then {shortName(next.festival.name)} on {rangeLabel(next.start, next.end)} · in {next.inDays} day{next.inDays === 1 ? '' : 's'}.</p>}
            </>
          ) : next ? (
            <Clock to={next.start} now={now} label={`${shortName(next.festival.name)} starts in`} />
          ) : null}
          <div className="vxf-actions">
            <button type="button" className="vxf-btn is-primary" onClick={(e) => playSongs(hero, { x: e.clientX, y: e.clientY })}>▶ Play {shortName(hero.name)} songs</button>
            <button type="button" className="vxf-btn" onClick={(e) => celebrate('fireworks', { at: { x: e.clientX, y: e.clientY }, palette: hero.colors })}>🎆 Light up the sky</button>
            <button type="button" className="vxf-btn" onClick={() => celebrate('confetti', { palette: hero.colors })}>🎉 Confetti</button>
            {!heroLive && <button type="button" className="vxf-btn" onClick={() => setPreviewId(hero.id)}>Preview the look</button>}
            {preview && <button type="button" className="vxf-btn" onClick={() => setPreviewId(null)}>Stop preview</button>}
          </div>
        </div>
      </section>

      <section className="vxf-wish" style={colorsOf(hero)} aria-label="Festival wishes">
        <p>{hero.greeting} <small>{heroLive ? 'Send today’s wishes to someone.' : 'Wishes for the next celebration, ready to share.'}</small></p>
        <button type="button" className="vxf-btn" onClick={() => void share()}>Share wishes</button>
      </section>

      {clientCfg?.broadcast?.text && (
        <section className="vxf-note" aria-label="Announcement">
          <strong>From VinaX: </strong>{clientCfg.broadcast.text}{clientCfg.broadcast.link && <> · <Link to={clientCfg.broadcast.link}>Open</Link></>}
        </section>
      )}

      <section aria-labelledby="vxf-upcoming">
        <SectionHeader title="Coming up" />
        <div className="vxf-grid" id="vxf-upcoming">
          {upcoming.map((o) => (
            <article key={o.festival.id} className="vxf-card" style={colorsOf(o.festival)}>
              <FestivalEmblem id={festivalVisual(o.festival.id).emblem} />
              <div>
                <span className="vxf-card-name">{shortName(o.festival.name)}</span>
                <span className="vxf-card-when">{rangeLabel(o.start, o.end)} <span className="vxf-card-days">{o.inDays === 1 ? 'tomorrow' : `in ${o.inDays} days`}</span></span>
                <span className="vxf-card-fx">{fxLine(o.festival.id)}</span>
              </div>
              <div className="vxf-card-tools">
                <button type="button" className={previewId === o.festival.id ? 'is-on' : undefined} onClick={() => setPreviewId(previewId === o.festival.id ? null : o.festival.id)}>{previewId === o.festival.id ? 'Stop preview' : 'Preview'}</button>
                <button type="button" onClick={(e) => playSongs(o.festival, { x: e.clientX, y: e.clientY })}>Songs</button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="vxf-switches">
        <SectionHeader title="Your festival settings" />
        <div className="vxf-settings" id="vxf-switches">
          <label className="vxf-setting"><span><strong>Festival themes</strong><small>Colours, backdrop and greeting on festival days</small></span><Toggle on={s.festivalSkins} onChange={s.setFestivalSkins} label="Festival themes" /></label>
          <label className="vxf-setting"><span><strong>Live animations</strong><small>Fireworks, confetti, petals, kites and more</small></span><Toggle on={s.festivalFx} onChange={s.setFestivalFx} label="Festival animations" disabled={!s.festivalSkins} /></label>
          <label className="vxf-setting"><span><strong>Festive sounds</strong><small>Pops and fireworks with the celebrations</small></span><Toggle on={s.festivalSound} onChange={s.setFestivalSound} label="Festival sounds" disabled={!s.festivalSkins} /></label>
          <div className="vxf-setting">
            <span><strong>Festival look</strong><small>Automatic follows the calendar; pin one to keep it</small></span>
            <select className="vx-set-select" aria-label="Festival look" value={s.festivalPin ?? ''} onChange={(e) => s.setFestivalPin(e.target.value || null)} disabled={!s.festivalSkins}>
              <option value="">Automatic</option>
              {FESTIVALS.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
        </div>
      </section>

      <section aria-labelledby="vxf-all">
        <SectionHeader title="Every festival look" />
        <div className="vxf-grid" id="vxf-all">
          {all.map(({ festival: f, start }) => {
            const w = start ? windowAround(f, start) : null;
            return (
              <article key={f.id} className="vxf-card" style={colorsOf(f)} data-festival={f.id}>
                <FestivalEmblem id={festivalVisual(f.id).emblem} />
                <div>
                  <span className="vxf-card-name">{f.name}</span>
                  <span className="vxf-card-when">{w ? rangeLabel(w.start, w.end) : 'When VinaX switches it on'}</span>
                  <span className="vxf-card-fx">{f.fx}</span>
                </div>
                <div className="vxf-card-tools">
                  <button type="button" className={previewId === f.id ? 'is-on' : undefined} onClick={() => setPreviewId(previewId === f.id ? null : f.id)}>{previewId === f.id ? 'Stop preview' : 'Preview'}</button>
                  <button type="button" className={s.festivalPin === f.id ? 'is-on' : undefined} onClick={() => s.setFestivalPin(s.festivalPin === f.id ? null : f.id)}>{s.festivalPin === f.id ? 'Pinned' : 'Pin'}</button>
                  <button type="button" onClick={(e) => playSongs(f, { x: e.clientX, y: e.clientY })}>Songs</button>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
