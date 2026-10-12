import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { festivalVisual } from '@/constants/festivalVisuals';
import { festivalDay } from '@/constants/festivals';
import { festivalShortName } from '@/features/home/festivalLookahead';
import { FestivalEmblem } from '@/components/FestivalEmblem';
import { useFestivalNow } from '@/features/festival/festivalPreview';

/**
 * Home greeting strip: shown at the top of Home while a festival is on.
 * Dismissing it hides it for this visit only (it is small, and the day is short).
 */
export function FestivalBanner() {
  const { festival } = useFestivalNow();
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (!festival || dismissed === festival.id) return null;
  const visual = festivalVisual(festival.id);
  const short = festivalShortName(festival.name);
  // Diwali runs five days, Navratri nine, Ganesh Chaturthi ten. Saying which
  // one today is turns a greeting that repeats into one that moves — and on a
  // phone, where the second line is otherwise hidden to keep the strip to two
  // rows, the marker is what brings that line back (see data-day in the CSS).
  const run = festivalDay(festival);
  return (
    <section
      className="fest-banner"
      aria-label={`${festival.name} greeting`}
      data-festival={festival.id}
      data-day={run ? `${run.day}/${run.days}` : undefined}
    >
      <FestivalEmblem id={visual.emblem} />
      <div className="fest-banner-text">
        <strong>{festival.greeting}</strong>
        <span>{run ? `Day ${run.day} of ${run.days} · ${visual.blurb}` : visual.blurb}</span>
      </div>
      <button type="button" className="fest-banner-play" onClick={() => navigate(`/search/${encodeURIComponent(visual.query)}`)}>
        Play {short} songs
      </button>
      <button type="button" className="fest-banner-x" aria-label="Hide festival greeting" onClick={() => setDismissed(festival.id)}>
        ×
      </button>
    </section>
  );
}

export default FestivalBanner;
