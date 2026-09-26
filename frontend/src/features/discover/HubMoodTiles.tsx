import { Link } from 'react-router-dom';
import { HeartIcon, MusicIcon, SparkleIcon, SunIcon, WaveIcon, WaveformIcon } from '@/components/Icons';
import { MOOD_HUBS } from '@/constants/hubs';
import { languageLabel } from '@/constants/languages';
import '@/styles/pages/browse.css';

const HUB_TONE: Record<string, [number, typeof HeartIcon]> = {
  romantic: [3, HeartIcon],
  sad: [12, WaveIcon],
  party: [9, SparkleIcon],
  devotional: [11, SunIcon],
  melody: [8, MusicIcon],
  workout: [5, WaveformIcon],
};

/** The language × mood hub pages for one language, as category tiles. */
export function HubMoodTiles({ language, exclude }: { language: string; exclude?: string }) {
  const label = languageLabel(language);
  return (
    <div className="vx-browse-tiles vx-hub-tiles">
      {MOOD_HUBS.filter((m) => m.slug !== exclude).map((m) => {
        const [tone, Icon] = HUB_TONE[m.slug] ?? [1, MusicIcon];
        return (
          <Link
            key={m.slug}
            to={`/${language}-${m.slug}-songs`}
            aria-label={`${label} ${m.label.toLowerCase()} songs`}
            className={`vx-browse-tile vx-tone-${tone}`}
          >
            <span className="vx-browse-tile-title">{m.label}</span>
            <span className="vx-browse-tile-meta">{label} songs</span>
            <span className="vx-browse-tile-art" aria-hidden><Icon /></span>
          </Link>
        );
      })}
    </div>
  );
}
