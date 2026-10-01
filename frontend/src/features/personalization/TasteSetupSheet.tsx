import { useCallback, useEffect, useRef, useState } from 'react';
import { Sheet } from '@/components/Sheet';
import { Chip } from '@/components/Chip';
import { LANGUAGES } from '@/constants/languages';
import { trendingSeed } from '@/constants/seeds';
import { searchSongs } from '@/services/api';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { toast } from '@/store/toastStore';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { isArtistSoftMuted } from '@/services/personalization/softMutes';
import { declareArtists, leadArtists, type PickedArtist } from './tasteSetup';
import type { Song } from '@/types';

/** How many languages are searched for artists, and how many artists are offered. */
const LANGUAGE_FANOUT = 3;
const MAX_ARTISTS = 18;

/**
 * 7.2 — "Pick languages & artists": the optional setup step, reachable at any
 * time from Settings → Recommendations and from the Taste Profile page, for
 * listeners who do not want to wait for the app to learn.
 *
 * It extends what the welcome flow already does rather than repeating it:
 * the same pinned languages, the same trending seeds and catalogue search,
 * and the same weight a like carries. Languages save as they are tapped;
 * artists are saved together at the end, so nothing is recorded by accident.
 */
export function TasteSetupSheet({ onClose, onSaved }: { onClose: () => void; onSaved?: () => void }) {
  const pinned = useSettingsStore((s) => s.pinnedLanguages);
  const togglePinnedLanguage = useSettingsStore((s) => s.togglePinnedLanguage);
  const hiddenArtists = useLibraryStore((s) => s.hiddenArtists);
  const online = useOnlineStatus();
  const [artists, setArtists] = useState<PickedArtist[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [attempt, setAttempt] = useState(0);
  const languages = pinned.length ? pinned : ['hindi'];
  const languageKey = languages.slice(0, LANGUAGE_FANOUT).join(',');
  const hiddenRef = useRef(hiddenArtists);
  hiddenRef.current = hiddenArtists;

  // One search per language, each independently fault-tolerant: two of three
  // failing still fills the list. No AI is involved, so nothing waits on one.
  useEffect(() => {
    let alive = true;
    setArtists(null);
    setFailed(false);
    const wanted = languageKey.split(',').filter(Boolean);
    void Promise.allSettled(wanted.map((l) => searchSongs(trendingSeed(l), 20))).then((results) => {
      if (!alive) return;
      const songs = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])) as Song[];
      if (!songs.length) {
        setFailed(true);
        setArtists([]);
        return;
      }
      const blocked = new Set(hiddenRef.current.map((a) => a.toLowerCase()));
      setArtists(
        leadArtists(songs, (a) => blocked.has(a.name.toLowerCase()) || isArtistSoftMuted({ artists: [a] })).slice(0, MAX_ARTISTS),
      );
    });
    return () => {
      alive = false;
    };
  }, [languageKey, attempt]);

  const toggle = useCallback((key: string) => {
    setPicked((p) => (p.includes(key) ? p.filter((x) => x !== key) : [...p, key]));
  }, []);

  const save = (): void => {
    const chosen = (artists ?? []).filter((a) => picked.includes(a.id || a.name));
    const n = declareArtists(chosen);
    if (n) toast(`Saved — Home and the DJ will lean toward ${n} ${n === 1 ? 'artist' : 'artists'}`);
    onSaved?.();
    onClose();
  };

  return (
    <Sheet onClose={onClose} labelledBy="vx-taste-setup-title" size="lg" maxHeight="tall">
      <h2 id="vx-taste-setup-title" className="vx-sheet-title !pt-0">Pick languages &amp; artists</h2>
      <p className="mt-1 text-[13px] text-ink-400 leading-relaxed">
        Tell VinaX what you like instead of waiting for it to learn. Everything you pick stays on this device and can be changed
        any time.
      </p>

      <section aria-labelledby="vx-taste-setup-langs" className="mt-5">
        <h3 id="vx-taste-setup-langs" className="text-[15px] font-bold text-ink-100">Languages you listen in</h3>
        <p className="text-[13px] text-ink-400 mt-0.5 mb-3">Saved as you tap. These are the same pinned languages as in Settings.</p>
        <div className="flex flex-wrap gap-2">
          {LANGUAGES.map((l) => (
            <Chip key={l.id} active={pinned.includes(l.id)} onClick={() => togglePinnedLanguage(l.id)}>
              {l.label}
            </Chip>
          ))}
        </div>
      </section>

      <section aria-labelledby="vx-taste-setup-artists" className="mt-5">
        <h3 id="vx-taste-setup-artists" className="text-[15px] font-bold text-ink-100">Artists you love</h3>
        <p className="text-[13px] text-ink-400 mt-0.5 mb-3">
          Popular right now in your languages. Each one you pick counts as much as liking one of their songs.
        </p>
        {!online && artists === null ? (
          <p className="text-[13px] text-ink-400">You’re offline. Languages still save; artists need a connection.</p>
        ) : artists === null ? (
          <div className="flex flex-wrap gap-2" aria-hidden>
            {Array.from({ length: 8 }).map((_, i) => (
              <span key={i} className="h-9 w-28 rounded-full skeleton" />
            ))}
          </div>
        ) : failed || !artists.length ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-[13px] text-ink-400">
              {online ? 'Couldn’t load artists just now.' : 'You’re offline, so artists couldn’t load.'}
            </p>
            <button type="button" onClick={() => setAttempt((a) => a + 1)} className="vx-tap min-h-[36px] px-4 rounded-full vx-chip-idle text-[13px] font-bold text-ink-100">
              Try again
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2" role="group" aria-labelledby="vx-taste-setup-artists">
            {artists.map((a) => {
              const key = a.id || a.name;
              return (
                <Chip key={key} active={picked.includes(key)} onClick={() => toggle(key)}>
                  {a.name}
                </Chip>
              );
            })}
          </div>
        )}
      </section>

      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={onClose} className="btn-secondary min-h-touch px-5 text-sm">
          Cancel
        </button>
        <button type="button" onClick={save} className="btn-primary min-h-touch px-6 text-sm">
          {picked.length ? `Save ${picked.length} ${picked.length === 1 ? 'artist' : 'artists'}` : 'Done'}
        </button>
      </div>
    </Sheet>
  );
}
