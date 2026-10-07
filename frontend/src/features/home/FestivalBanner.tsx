import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { festivalVisual } from '@/constants/festivalVisuals';
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
  return (
    <section className="fest-banner" aria-label={`${festival.name} greeting`} data-festival={festival.id}>
      <FestivalEmblem id={visual.emblem} />
      <div className="fest-banner-text">
        <strong>{festival.greeting}</strong>
        <span>{visual.blurb}</span>
      </div>
      <button type="button" className="fest-banner-play" onClick={() => navigate(`/search/${encodeURIComponent(visual.query)}`)}>
        Play festive songs
      </button>
      <button type="button" className="fest-banner-x" aria-label="Hide festival greeting" onClick={() => setDismissed(festival.id)}>
        ×
      </button>
    </section>
  );
}

export default FestivalBanner;
