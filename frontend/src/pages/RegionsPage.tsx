import { useState } from 'react';
import { songPath } from '@/utils/slug';
import { usePageTitle } from '@/hooks/usePageTitle';
import { COUNTRIES, REGIONS, regionsForCountry } from '@/constants/regions';
import { useRegion } from '@/features/location/useRegion';
import { useSettingsStore } from '@/store/settingsStore';
import { Chip } from '@/components/Chip';
import { Shelf } from '@/components/Shelf';
import { MediaCard } from '@/components/MediaCard';
import { ShelfSkeleton } from '@/components/Skeletons';
import { useTrendingForLanguage } from '@/features/home/useHomeShelves';
import { usePlayerStore } from '@/store/playerStore';
import { bestImage } from '@/utils/images';
import { languageLabel } from '@/constants/languages';

function RegionalShelf({ language, regionLabel }: { language: string; regionLabel: string }) {
  const { data, isLoading } = useTrendingForLanguage(language);
  const playQueue = usePlayerStore((s) => s.playQueue);
  if (isLoading) return <ShelfSkeleton />;
  if (!data?.length) return null;
  return (
    <Shelf title={`${regionLabel} · ${languageLabel(language)}`} explanation="Popular in this region">
      {data.map((song, i) => (
        <MediaCard key={song.id} to={songPath(song)} image={bestImage(song.images)} images={song.images} title={song.title} subtitle={song.subtitle} onPlay={() => playQueue(data, i)} />
      ))}
    </Shelf>
  );
}

export default function RegionsPage() {
  usePageTitle('Regions');
  const region = useRegion();
  const inferredDefault = region?.country === 'IN' ? 'in-north' : 'global';
  const [selected, setSelected] = useState<string>(inferredDefault);
  const setManualCountry = useSettingsStore((s) => s.setManualCountry);
  const manualCountry = useSettingsStore((s) => s.manualCountry);
  const def = REGIONS.find((r) => r.id === selected) ?? REGIONS[0];

  return (
    <div className="max-w-screen-2xl mx-auto">
      <h1 className="text-display tracking-tight mb-1">Regions</h1>
      <p className="text-sm text-ink-400 mb-6">
        {region?.country
          ? `Detected: ${region.country}${region.regionLabel ? ` · ${region.regionLabel}` : ''} (${region.source === 'edge' ? 'edge inferred' : region.source === 'manual' ? 'manual override' : 'browser inferred'})`
          : 'Region unknown — set one below.'}{' '}
        Only coarse country/region is ever stored. Never your IP.
      </p>

      <div className="mb-3 text-sm font-semibold text-ink-300">Country override</div>
      <div className="flex flex-wrap gap-2 mb-8">
        <Chip active={!manualCountry} onClick={() => setManualCountry(null)}>Auto</Chip>
        {COUNTRIES.map((c) => (
          <Chip key={c.id} active={manualCountry === c.id} onClick={() => setManualCountry(c.id)}>
            {c.label}
          </Chip>
        ))}
      </div>

      <div className="mb-3 text-sm font-semibold text-ink-300">Browse regional charts</div>
      <div className="flex flex-wrap gap-2 mb-8">
        {regionsForCountry(region?.country ?? null).map((r) => (
          <Chip key={r.id} active={selected === r.id} onClick={() => setSelected(r.id)}>
            {r.label}
          </Chip>
        ))}
      </div>

      {def.languages.slice(0, 2).map((lang) => (
        <RegionalShelf key={lang} language={lang} regionLabel={def.label} />
      ))}
    </div>
  );
}
