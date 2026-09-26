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
import { InlineError } from '@/components/States';
import { useTrendingForLanguage } from '@/features/home/useHomeShelves';
import { usePlayerStore } from '@/store/playerStore';
import { bestImage } from '@/utils/images';
import { languageLabel } from '@/constants/languages';
import { PageHeader } from '@/components/PageHeader';
import '@/styles/pages/browse.css';

function RegionalShelf({ language, regionLabel }: { language: string; regionLabel: string }) {
  const { data, isLoading, isError, refetch } = useTrendingForLanguage(language);
  const playQueue = usePlayerStore((s) => s.playQueue);
  if (isLoading) return <ShelfSkeleton />;
  // A failed shelf used to vanish (`return null`); only an EMPTY one may.
  if (isError && !data?.length) return <InlineError label={`${regionLabel} · ${languageLabel(language)}`} retry={() => void refetch()} />;
  if (!data?.length) return null;
  return (
    <Shelf title={`${regionLabel} · ${languageLabel(language)}`}>
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
    <div className="vx-browse vx-browse-page max-w-screen-2xl mx-auto">
      <PageHeader title="Regions" />

      <section className="vx-control-group" aria-label="Regional charts">
        <div className="vx-chip-row">
          {regionsForCountry(region?.country ?? null).map((r) => (
            <Chip key={r.id} active={selected === r.id} onClick={() => setSelected(r.id)}>
              {r.label}
            </Chip>
          ))}
        </div>
      </section>

      {def.languages.slice(0, 2).map((lang) => (
        <RegionalShelf key={lang} language={lang} regionLabel={def.label} />
      ))}

      <section className="vx-control-group mt-2" aria-label="Country override">
        <h2 className="vx-subhead">Country</h2>
        <div className="vx-chip-row mb-3">
          <Chip active={!manualCountry} onClick={() => setManualCountry(null)}>Auto</Chip>
          {COUNTRIES.map((c) => (
            <Chip key={c.id} active={manualCountry === c.id} onClick={() => setManualCountry(c.id)}>
              {c.label}
            </Chip>
          ))}
        </div>
        <p className="vx-meta-line">
          {region?.country
            ? `Detected: ${region.country}${region.regionLabel ? ` · ${region.regionLabel}` : ''} (${region.source === 'edge' ? 'edge inferred' : region.source === 'manual' ? 'manual override' : 'browser inferred'})`
            : 'Region unknown — set one above.'}{' '}
          Only coarse country/region is ever stored. Never your IP.
        </p>
      </section>
    </div>
  );
}
