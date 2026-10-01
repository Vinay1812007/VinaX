import { HeartIcon, MusicIcon, SparkleIcon, SunIcon, WaveIcon, WaveformIcon } from '@/components/Icons';
import { MOOD_HUBS } from '@/constants/hubs';
import { languageLabel } from '@/constants/languages';
import { BrowseTile, TileGlyph } from './BrowseTile';
import '@/styles/pages/browse.css';

/** Each mood hub's tone and icon, shared with Explore's hub list. */
export const HUB_TONE: Record<string, [number, typeof HeartIcon]> = {
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
    <div className="bx-tile-grid">
      {MOOD_HUBS.filter((m) => m.slug !== exclude).map((m) => {
        const [tone, Icon] = HUB_TONE[m.slug] ?? [1, MusicIcon];
        return (
          <BrowseTile
            key={m.slug}
            to={`/${language}-${m.slug}-songs`}
            label={`${label} ${m.label.toLowerCase()} songs`}
            tone={`vx-tone-${tone}`}
            title={m.label}
            meta={`${label} songs`}
            visual={<TileGlyph><Icon /></TileGlyph>}
          />
        );
      })}
    </div>
  );
}
