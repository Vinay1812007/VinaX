import { lazy, Suspense, useReducer, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { languageLabel } from '@/constants/languages';
import { loadProfile } from '@/services/personalization/storage';
import { profileConfidence, topArtists, topLanguages } from '@/services/personalization/profile';
import { softMutesSnapshot, subscribeSoftMutes } from '@/services/personalization/softMutes';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';

const TasteSetupSheet = lazy(() => import('./TasteSetupSheet').then((m) => ({ default: m.TasteSetupSheet })));

const DISCOVERY_WORD: Record<string, string> = {
  familiar: 'Familiar',
  balanced: 'Balanced',
  discover: 'Discover',
};

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2 text-xs leading-relaxed">
      <span className="w-24 shrink-0 text-ink-400">{label}</span>
      <span className="min-w-0 flex-1 text-ink-200 break-words">{children}</span>
    </div>
  );
}

/**
 * 7.2 — "What VinaX thinks you like": the personalization preview, in plain
 * words, read from the profile on this device. Nothing here is fetched and
 * nothing is uploaded, so there is no loading state to fake — when the
 * profile is cold it says so and offers the setup step instead of showing
 * empty bars.
 *
 * The profile is not a store, so the card re-reads it on every render and
 * renders again when something it shows changes: a soft mute (the mutes
 * snapshot), a setting (the stores), or the listener's own picks (`refresh`).
 */
export function PersonalizationPreview({ showProfileLink = true }: { showProfileLink?: boolean }) {
  const [setup, setSetup] = useState(false);
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const mutes = useSyncExternalStore(subscribeSoftMutes, softMutesSnapshot, softMutesSnapshot);
  const discoveryMode = useSettingsStore((s) => s.discoveryMode);
  const pinned = useSettingsStore((s) => s.pinnedLanguages);
  const hiddenArtists = useLibraryStore((s) => s.hiddenArtists);

  const profile = loadProfile();
  const languages = topLanguages(profile, 3).map((l) => languageLabel(l.id));
  const artists = topArtists(profile, 5)
    .filter(({ affinity }) => affinity.score > 0)
    .map(({ affinity }) => affinity.name);
  const cold = profile.totals.plays < 5 && !artists.length;

  return (
    <div className="rounded-2xl border border-[var(--glass-border)] bg-ink-850/40 p-4">
      {cold ? (
        <p className="text-xs text-ink-300 leading-relaxed">
          VinaX hasn’t learned much yet — it needs a few plays. You can also tell it what you like; it takes a minute and stays on
          this device.
        </p>
      ) : (
        <div className="space-y-1.5">
          <Line label="Languages">{languages.length ? languages.join(', ') : 'Nothing learned yet'}</Line>
          <Line label="Artists">{artists.length ? artists.join(', ') : 'Nothing learned yet'}</Line>
          <Line label="Discovery">
            {DISCOVERY_WORD[discoveryMode] ?? 'Balanced'} · {Math.round(profileConfidence(profile) * 100)}% of the way to a
            confident profile
          </Line>
          <Line label="Playing less">
            {mutes.length ? `${mutes.map((m) => m.name).join(', ')} — until each one runs out` : 'Nobody'}
          </Line>
          <Line label="Never play">
            {hiddenArtists.length ? `${hiddenArtists.length} blocked ${hiddenArtists.length === 1 ? 'artist' : 'artists'}` : 'Nobody'}
          </Line>
        </div>
      )}
      <Line label="Pinned">{pinned.length ? pinned.map((l) => languageLabel(l)).join(', ') : 'No languages pinned'}</Line>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setSetup(true)} className="vx-tap px-3.5 py-2 rounded-full btn-primary text-xs font-bold">
          Pick languages &amp; artists
        </button>
        {showProfileLink && (
          <Link to="/taste-profile" className="vx-tap px-3.5 py-2 inline-flex items-center rounded-full glass-button text-xs font-bold">
            See the full taste profile
          </Link>
        )}
      </div>
      {setup && (
        <Suspense fallback={null}>
          <TasteSetupSheet onClose={() => setSetup(false)} onSaved={refresh} />
        </Suspense>
      )}
    </div>
  );
}
