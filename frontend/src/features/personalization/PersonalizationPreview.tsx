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

/** One line of the preview: a label and what VinaX believes, between hairlines. */
function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3 py-2.5 border-t border-[color:var(--vx-border)] first:border-t-0 first:pt-0 text-[14px] leading-snug">
      <dt className="text-ink-400 font-medium">{label}</dt>
      <dd className="min-w-0 text-ink-100 font-semibold break-words">{children}</dd>
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
 *
 * 9.0 — a definition list between hairlines rather than a boxed card, so it
 * reads the same inside a Settings row and at the top of the taste page.
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
    <div>
      {cold && (
        <p className="mb-3 max-w-[60ch] text-[14px] text-ink-300 leading-relaxed">
          VinaX hasn’t learned much yet — it needs a few plays. You can also tell it what you like; it takes a minute and stays on
          this device.
        </p>
      )}
      <dl>
        {!cold && (
          <>
            <Line label="Languages">{languages.length ? languages.join(', ') : 'Nothing learned yet'}</Line>
            <Line label="Artists">{artists.length ? artists.join(', ') : 'Nothing learned yet'}</Line>
            <Line label="Discovery">
              {DISCOVERY_WORD[discoveryMode] ?? 'Balanced'}
              <span className="font-medium text-ink-400">
                {' '}
                · <span className="tabular-nums">{Math.round(profileConfidence(profile) * 100)}%</span> of the way to a confident profile
              </span>
            </Line>
            <Line label="Playing less">
              {mutes.length ? `${mutes.map((m) => m.name).join(', ')} — until each one runs out` : 'Nobody'}
            </Line>
            <Line label="Never play">
              {hiddenArtists.length ? `${hiddenArtists.length} blocked ${hiddenArtists.length === 1 ? 'artist' : 'artists'}` : 'Nobody'}
            </Line>
          </>
        )}
        <Line label="Pinned">{pinned.length ? pinned.map((l) => languageLabel(l)).join(', ') : 'No languages pinned'}</Line>
      </dl>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setSetup(true)} className="vx-tap inline-flex items-center min-h-[36px] px-4 rounded-full btn-primary text-[13.5px] font-bold">
          Pick languages &amp; artists
        </button>
        {showProfileLink && (
          <Link to="/taste-profile" className="vx-tap inline-flex items-center min-h-[36px] px-4 rounded-full vx-chip-idle text-[13.5px] font-bold text-ink-100">
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
