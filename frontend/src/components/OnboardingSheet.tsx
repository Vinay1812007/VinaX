import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { LANGUAGES } from '@/constants/languages';
import { KEYS } from '@/constants/storage-keys';
// Dynamic-imported inside finish() so the heavy changelog module doesn't
// land in first-load (WhatsNewSheet.tsx does the same for the same reason).
import { getLocal, setLocal } from '@/services/storage/local';
import { readBrowserSignals } from '@/services/location/browserSignals';
import { useSettingsStore } from '@/store/settingsStore';
import { useUiStore } from '@/store/uiStore';
import { ensureNotificationPermission, isNativePlatform } from '@/services/native';
import { searchSongs } from '@/services/api';
import { trendingSeed } from '@/constants/seeds';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { useLibraryStore } from '@/store/libraryStore';
import type { Song } from '@/types';
import { Chip } from './Chip';
import {
  SparkleIcon,
  HomeIcon,
  PlayIcon,
  SearchIcon,
  UsersIcon,
  HeartIcon,
  ChevronDownIcon,
} from './Icons';
import { useFocusTrap } from '@/hooks/useFocusTrap';

/** Small pill for keyboard shortcut hints ("Space", "⌘K", etc). */
const KEY_CHIP = 'inline-flex items-center px-1.5 py-0.5 rounded-md border border-ink-600/70 bg-ink-900/50 text-[10.5px] font-semibold text-ink-200 font-mono';
function KeyChip({ children }: { children: ReactNode }) {
  return <kbd className={KEY_CHIP}>{children}</kbd>;
}

interface TourSlide {
  icon: ReactNode;
  title: string;
  lines: string[];
  shortcuts?: Array<{ combo: string; label: string }>;
  /** Optional inline visual (e.g., the ⌘K palette mock). */
  visual?: ReactNode;
}

/**
 * The Welcome tour (fully rewritten 4.17.1). Ground rules for editing:
 *  - Every claim must be TRUE today. No version numbers in titles: the tour
 *    is evergreen, What's New handles releases.
 *  - Short lines, one idea each. The user is 10 seconds from music.
 */
const TOUR: TourSlide[] = [
  {
    icon: <SparkleIcon className="w-7 h-7" />,
    title: 'Welcome to VinaX',
    lines: [
      'Free forever. No account, no login, no paywall — press play and go.',
      'Telugu, Hindi, Tamil and nine more languages, plus English — tuned to what you actually play.',
      'Your taste lives on this device and never leaves it. That’s the whole design.',
      'No ads anywhere — not on the website, not in the app, and never in Kid mode.',
    ],
  },
  {
    icon: <HomeIcon className="w-7 h-7" />,
    title: 'A Home that learns you',
    lines: [
      'Shelves grow out of your listening — Continue Listening, On Repeat, Because You Listened To, Fresh Finds, Hidden Gems, Decade Rewind.',
      'Six mood boards rotate daily; seasonal shelves appear when the moment fits — festivals, monsoon, weekends.',
      'Make it YOUR home: Settings → Home layout lets you hide or reorder every block.',
      'Pull down anytime for a completely fresh set of picks.',
    ],
  },
  {
    icon: <PlayIcon className="w-7 h-7" />,
    title: 'Play, swipe, sing along',
    lines: [
      'Tap any song — the queue builds itself around it, and drag the ☰ grip to reorder.',
      'Swipe the mini-player to skip, swipe up for the full player with karaoke lyrics that follow the singer line by line.',
      'On Android, tapping the playback notification drops you straight into the full-screen player.',
      'Close the app mid-song, come back tomorrow — you resume exactly where you were.',
    ],
    shortcuts: [
      { combo: 'Space', label: 'play / pause' },
      { combo: 'N', label: 'next' },
      { combo: 'P', label: 'prev' },
      { combo: '← →', label: 'seek 10s' },
      { combo: 'F', label: 'favorite' },
    ],
  },
  {
    icon: <SparkleIcon className="w-7 h-7" />,
    title: 'Meet VinaX AI',
    lines: [
      'Seven engines, each with its own strength: FLASH for everyday chat, 20B for speed, SUPER for deep thinking, INSTANT for music trivia, 120B for creativity (it runs the AI DJ), ULTRA the all-rounder, NANO 3 the song-finder.',
      'Flip on Think for careful reasoning, or Research to pull answers from the live web.',
      'Say “play ⟨song⟩” and the reply becomes a real mini-player, lyrics and all.',
      'Voice chat is fully hands-free — it listens, thinks, and answers out loud.',
    ],
  },
  {
    icon: <SearchIcon className="w-7 h-7" />,
    title: 'Search everything from one box',
    lines: [
      'One input finds songs, artists, albums, pages and player actions — start typing and hit enter.',
      'Right-click (or long-press) any song anywhere: play next, add to queue, favorite, copy link.',
    ],
    shortcuts: [
      { combo: '⌘ K', label: 'palette (mac)' },
      { combo: 'Ctrl K', label: 'palette (win/linux)' },
    ],
    visual: (
      <div className="mt-3 mx-auto max-w-[280px] rounded-xl border border-ink-700/70 bg-ink-950/60 p-2.5">
        <div className="flex items-center gap-2 rounded-lg bg-ink-900/70 px-2.5 py-1.5">
          <SearchIcon className="w-3.5 h-3.5 text-ink-400" />
          <span className="text-[11px] text-ink-400">Search songs, pages, actions…</span>
          <span className="ml-auto inline-flex items-center gap-0.5">
            <KeyChip>⌘</KeyChip>
            <KeyChip>K</KeyChip>
          </span>
        </div>
        <div className="mt-1.5 px-2.5 py-1 text-[10.5px] text-ink-500">Try: play tum hi ho · settings · queue</div>
      </div>
    ),
  },
  {
    icon: <UsersIcon className="w-7 h-7" />,
    title: 'Listen Together',
    lines: [
      'One tap makes a room; share the code and friends are in within seconds.',
      'Everyone hears the same second — synced to about a beat.',
      'Guests request songs straight into your queue; you stay the DJ.',
      'Done? “End for all” closes the room for everyone at once.',
    ],
  },
  {
    icon: <SparkleIcon className="w-7 h-7" />,
    title: 'Make it yours',
    lines: [
      'Two glass dials in Settings — Glass effect (solid → deep glass) and Background blur (sharp → hazy).',
      'Ten accent colours across dark, light and AMOLED — and the app can tint itself from the playing artwork.',
      'Home layout builder: hide the blocks you skip, move your favourites up.',
    ],
    visual: (
      <div className="mt-3 mx-auto max-w-[280px] rounded-xl border border-ink-700/70 bg-ink-950/50 backdrop-blur-md p-3 space-y-2">
        <div className="flex items-center justify-between text-[11px] text-ink-300">
          <span className="font-bold">Glass effect</span>
          <span className="text-ink-500">SOLID · GLASS</span>
        </div>
        <div className="h-1 rounded-full bg-ink-800 relative"><span className="absolute inset-y-0 left-0 w-[40%] rounded-full bg-ember-500" /></div>
        <div className="flex items-center justify-between text-[11px] text-ink-300">
          <span className="font-bold">Background blur</span>
          <span className="text-ink-500">SHARP · HAZY</span>
        </div>
        <div className="h-1 rounded-full bg-ink-800 relative"><span className="absolute inset-y-0 left-0 w-[40%] rounded-full bg-tide-500" /></div>
      </div>
    ),
  },
  {
    icon: <HeartIcon className="w-7 h-7" />,
    title: 'Yours means yours',
    lines: [
      'Favorites, history, downloads, stats and your whole taste profile live on this device. Nothing is uploaded, ever.',
      'Your VinaX shows your listening year — top artists, hours, streaks — computed here, shareable only if YOU choose.',
      'New phone? Settings → Move to a new device beams everything across with one QR — or export/import a file from Your Data.',
      'That’s the tour. Press play — VinaX learns from the very first song.',
    ],
  },
];


/**
 * First-open flow: pick languages (cold-start signal), then an A→Z tour of
 * the app. Shown exactly once; skippable at any point.
 */
export function OnboardingSheet() {
  const tourOpen = useUiStore((s) => s.tourOpen);
  const closeTour = useUiStore((s) => s.closeTour);
  const location = useLocation();
  const navigate = useNavigate();
  const [firstRun, setFirstRun] = useState(() => !getLocal<boolean>(KEYS.onboarded, false));
  // Existing listeners from before usernames existed: reopen ONLY the welcome
  // step once so they claim a handle, then close without re-running the tour.
  const [handleOnly, setHandleOnly] = useState(
    () => getLocal<boolean>(KEYS.onboarded, false) && !getLocal<string>(KEYS.userHandle, ''),
  );
  // The sheet steps aside on /handoff so a first-run device can complete the
  // QR "Move to a new device" import (which reloads with the old device's
  // profile, onboarded flag included). Leaving /handoff without importing
  // brings the sheet straight back.
  const open = (firstRun || handleOnly || tourOpen) && location.pathname !== '/handoff';
  const [step, setStep] = useState(-1); // -1 = language pick, 0..n = tour
  const detected = readBrowserSignals().languages;
  const [picked, setPicked] = useState<string[]>(detected.length ? detected : ['hindi', 'english']);
  const [name, setName] = useState<string>(() => getLocal<string>(KEYS.userName, ''));
  const [consent, setConsent] = useState<boolean>(true);
  const [nameErr, setNameErr] = useState(false);
  // Unique handle — mandatory, because display names collide across listeners.
  const [handle, setHandle] = useState<string>(() => getLocal<string>(KEYS.userHandle, ''));
  const [handleEdited, setHandleEdited] = useState(false);
  const [handleErr, setHandleErr] = useState<string | null>(null);
  const [handleSuggestions, setHandleSuggestions] = useState<string[]>([]);
  const [claiming, setClaiming] = useState(false);
  // Live availability, checked while the listener types (debounced).
  const [handleAvail, setHandleAvail] = useState<'checking' | 'free' | 'taken' | null>(null);
  const [importErr, setImportErr] = useState(false);
  // Package A7/D1 — the 10-song taste-seed step. Sits between the language
  // picker and the tour. Liking a handful jumps the cold profile's confidence
  // from ~0 to ~0.5, so Home has something to work with on the very first open.
  const [seedOpen, setSeedOpen] = useState(false);
  const [seedSongs, setSeedSongs] = useState<Song[]>([]);
  const [seedLiked, setSeedLiked] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  // Returning user restoring an exported profile — importProfileJson validates
  // the file and reloads on success, so we only handle the failure path here.
  const onImportFile = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const f = e.target.files?.[0];
    if (!f) return;
    setImportErr(false);
    try {
      const text = await f.text();
      const { importProfileJson } = await import('@/features/settings/actions');
      if (!importProfileJson(text)) setImportErr(true);
    } catch {
      setImportErr(true);
    }
  };

  useEffect(() => {
    if (tourOpen) setStep(0);
  }, [tourOpen]);

  // Preselect the regional language from the visitor's coarse IP region —
  // country + state only, from the edge; the IP itself never reaches us.
  useEffect(() => {
    if (!open || picked.length) return;
    let aliveG = true;
    const base = isNativePlatform() ? 'https://www.sirimillavinay.online' : '';
    fetch(`${base}/api/geo`)
      .then((r) => (r.ok ? (r.json() as Promise<{ country?: string | null; region?: string | null }>) : null))
      .then((g) => {
        if (!aliveG || !g) return;
        const region = (g.region || '').toLowerCase();
        const MAP: Array<[RegExp, string]> = [
          [/telangana|andhra/, 'telugu'],
          [/tamil|puducherry/, 'tamil'],
          [/karnataka/, 'kannada'],
          [/kerala/, 'malayalam'],
          [/maharashtra|goa/, 'marathi'],
          [/bengal|tripura/, 'bengali'],
          [/gujarat/, 'gujarati'],
          [/punjab|chandigarh/, 'punjabi'],
          [/bihar|jharkhand/, 'bhojpuri'],
          [/kashmir|jammu/, 'urdu'],
        ];
        const hit = MAP.find(([re]) => re.test(region));
        const langs = g.country === 'IN' ? [...new Set([...(hit ? [hit[1]] : []), 'hindi', 'english'])] : ['english'];
        setPicked((p) => (p.length ? p : langs));
      })
      .catch(() => undefined);
    return () => {
      aliveG = false;
    };
    // Runs once per open; picked is intentionally not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Focus management hooks: must be declared BEFORE any early return so React's
  // hook order is stable across renders (audit finding M5). We route `finish`
  // through a ref so the keydown effect doesn't need to re-attach every time
  // a state hook downstream changes finish's identity.
  const dialogRef = useRef<HTMLDivElement>(null);
  const escapeRef = useRef<() => void>(() => undefined);
  // The full trap (opener restore, initial focus, Tab cycle, Escape) now
  // lives in useFocusTrap — extracted FROM this component (audit P1-9) so the
  // other overlays share the reference implementation instead of having none.
  useFocusTrap(dialogRef, open, () => escapeRef.current());

  // Debounced live "already exists?" probe — the error shows while typing,
  // not only after Continue. The POST claim remains the authority.
  useEffect(() => {
    const u = handle.trim().toLowerCase();
    if (!open || !/^[a-z0-9_]{3,20}$/.test(u)) {
      setHandleAvail(null);
      return;
    }
    if (u === getLocal<string>(KEYS.userHandle, '')) {
      setHandleAvail('free'); // our own saved handle is always ok
      return;
    }
    setHandleAvail('checking');
    const base = isNativePlatform() ? 'https://www.sirimillavinay.online/api/username' : '/api/username';
    const t = window.setTimeout(() => {
      fetch(`${base}?u=${encodeURIComponent(u)}`)
        .then((r) => r.json())
        .then((j: { available?: boolean }) => {
          setHandleAvail(j?.available === false ? 'taken' : 'free');
        })
        .catch(() => setHandleAvail(null)); // network hiccup: stay quiet, claim decides
    }, 450);
    return () => window.clearTimeout(t);
  }, [handle, open]);

  if (!open) return null;

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const finish = () => {
    // A fresh install has no "previous version" — stamp the current content
    // fingerprint (not the version string) so What's New doesn't fire on
    // the very first launch. FIRST RUN ONLY: a returning user replaying the
    // tour (Help → Replay welcome tour) must NOT consume a pending What's
    // New — this stamp used to run unconditionally and silently ate the
    // update card for anyone who touched the tour.
    if (firstRun) {
      void import('@/constants/changelog').then((m) => {
        setLocal(KEYS.lastSeenVersion, m.latestNotesFingerprint());
      });
    }
    setLocal(KEYS.onboarded, true);
    setFirstRun(false);
    closeTour();
    // Ask for the notification permission lock-screen lyrics + media controls need.
    if (isNativePlatform()) void ensureNotificationPermission();
  };
  // Route the ref to the current finish so the keydown effect stays stable.
  escapeRef.current = finish;

  /** vinay mac → vinay_mac_k4x — editable suggestion, never empty. */
  const genHandle = (from: string): string => {
    const stem = from
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 14);
    const salt = Math.random().toString(36).replace(/[^a-z0-9]/g, '').slice(0, 3) || '777';
    return `${stem || 'listener'}_${salt}`.slice(0, 20);
  };

  const onNameChange = (v: string) => {
    setName(v);
    // Keep the suggested handle tracking the name until the listener edits it.
    if (!handleEdited) setHandle(v.trim().length >= 2 ? genHandle(v) : '');
  };

  /** Claim the unique handle server-side. Returns the saved handle or null. */
  const claimHandle = async (username: string, displayName: string): Promise<string | null> => {
    try {
      const base = isNativePlatform() ? 'https://www.sirimillavinay.online/api/username' : '/api/username';
      const res = await fetch(base, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username,
          name: displayName,
          signed_device_id: getLocal<string>(KEYS.signedDeviceId, '') || undefined,
        }),
      });
      if (res.status === 409) {
        const j = (await res.json().catch(() => null)) as { suggestions?: string[] } | null;
        setHandleErr(`@${username} already exists — pick another username.`);
        setHandleSuggestions(j?.suggestions ?? []);
        return null;
      }
      const j = (await res.json().catch(() => null)) as
        | { ok?: boolean; username?: string; signed_device_id_next?: string }
        | null;
      if (j?.signed_device_id_next) setLocal(KEYS.signedDeviceId, j.signed_device_id_next);
      // Network/server hiccup: don't block onboarding forever — accept locally,
      // the handle re-claims on the next app open (handleOnly reopens if unsaved).
      return j?.ok ? (j.username ?? username) : username;
    } catch {
      return username;
    }
  };

  const continueFromWelcome = async () => {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setNameErr(true);
      return;
    }
    setNameErr(false);
    const username = handle.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(username)) {
      setHandleErr('Username is mandatory — 3–20 letters, numbers or _ only.');
      return;
    }
    if (handleAvail === 'taken') {
      setHandleErr(`@${username} already exists — pick another username.`);
      return;
    }
    setHandleErr(null);
    setClaiming(true);
    const saved = await claimHandle(username, trimmed);
    setClaiming(false);
    if (!saved) return; // taken — error + suggestions are on screen
    setLocal(KEYS.userHandle, saved);
    setLocal(KEYS.userName, trimmed);
    if (handleOnly) {
      // Pre-username listener: handle claimed, nothing else to redo.
      setHandleOnly(false);
      return;
    }
    setLocal(KEYS.analyticsConsent, consent);
    if (picked.length) useSettingsStore.getState().setPinnedLanguages(picked);
    // Register this (anonymous) device + name with the backend, if consented.
    void import('@/services/analytics/telemetry').then((m) => m.registerUser());
    // Open the taste-seed step and fetch a dozen trending songs in the top
    // picked language. If the catalog is unreachable or returns too few, we
    // silently skip straight to the tour — the seed step never blocks setup.
    const top = picked[0] ?? 'hindi';
    setSeedOpen(true);
    void searchSongs(trendingSeed(top), 14)
      .then((songs) => {
        const clean = songs.filter((s) => s.images && s.images.length).slice(0, 12);
        if (clean.length >= 6) setSeedSongs(clean);
        else {
          setSeedOpen(false);
          setStep(0);
        }
      })
      .catch(() => {
        setSeedOpen(false);
        setStep(0);
      });
  };

  const toggleSeed = (id: string) =>
    setSeedLiked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  /** Leave the seed step. When `keep` is true, the liked songs are written to
   *  Favorites (which records them into the on-device taste profile). */
  const finishSeed = (keep: boolean) => {
    if (keep && seedLiked.length) {
      const store = useLibraryStore.getState();
      for (const s of seedSongs) if (seedLiked.includes(s.id)) store.toggleFavorite(s);
    }
    setSeedOpen(false);
    setStep(0);
  };

  const slide = step >= 0 ? TOUR[step] : null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-ink-950/80 backdrop-blur-sm p-0 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vx-onboarding-title"
    >
      <div ref={dialogRef} className="w-full sm:max-w-md glass-modal rounded-t-3xl sm:rounded-3xl p-6 animate-fade-up">
        {seedOpen ? (
          <>
            <div className="flex items-center justify-between mb-1">
              <h2 id="vx-onboarding-title" className="text-xl font-bold">Tap a few you love</h2>
              <button
                onClick={() => finishSeed(false)}
                className="text-[11px] font-semibold uppercase tracking-wider text-ink-500 hover:text-ink-300 transition"
              >
                Skip
              </button>
            </div>
            <p className="text-xs text-ink-400 mb-4">
              This teaches Home your taste instantly — everything stays on your device.
            </p>
            {seedSongs.length === 0 ? (
              <div className="grid grid-cols-3 gap-2.5" aria-hidden>
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="aspect-square rounded-xl skeleton" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2.5">
                {seedSongs.map((s) => {
                  const liked = seedLiked.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      onClick={() => toggleSeed(s.id)}
                      aria-pressed={liked}
                      aria-label={`${liked ? 'Unlike' : 'Like'} ${s.title}`}
                      className="group relative aspect-square rounded-xl overflow-hidden ring-1 ring-white/5 active:scale-95 transition"
                    >
                      <img
                        src={bestImage(s.images, 150)}
                        onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)}
                        alt=""
                        loading="lazy"
                        className={liked ? 'w-full h-full object-cover brightness-[0.55]' : 'w-full h-full object-cover'}
                      />
                      <span
                        className={
                          liked
                            ? 'absolute inset-0 flex items-center justify-center'
                            : 'absolute bottom-1 right-1 flex items-center justify-center w-6 h-6 rounded-full bg-black/45 opacity-0 group-hover:opacity-100 transition'
                        }
                      >
                        <HeartIcon className={liked ? 'w-7 h-7 text-ember-400' : 'w-3.5 h-3.5 text-white/90'} />
                      </span>
                      <span className="absolute inset-x-0 bottom-0 px-1.5 py-1 bg-gradient-to-t from-black/75 to-transparent text-[10px] font-semibold text-white text-left leading-tight line-clamp-1">
                        {s.title}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            <div className="mt-5 flex items-center gap-2.5">
              <button
                onClick={() => finishSeed(true)}
                disabled={seedSongs.length === 0}
                className="flex-1 py-3 rounded-full btn-premium font-bold disabled:opacity-50"
              >
                {seedLiked.length ? `Continue with ${seedLiked.length} liked` : 'Continue'}
              </button>
            </div>
            <p className="mt-3 text-center text-[11px] font-semibold text-ink-400">
              You can heart or unheart anything later, anytime.
            </p>
          </>
        ) : step === -1 ? (
          <>
            <div className="flex items-center gap-3 mb-2">
              <img src="/icons/icon.svg" alt="" className="w-10 h-10 rounded-xl" />
              <div>
                <h2 id="vx-onboarding-title" className="text-[26px] leading-tight font-extrabold tracking-tight text-gradient">Music tuned to you</h2>
                <p className="text-xs text-ink-400">Free, no login, private by design. Your taste never leaves this device.</p>
              </div>
            </div>
            <label className="block mt-4 mb-1 text-sm text-ink-300" htmlFor="vx-name">
              What should we call you?
            </label>
            <input
              id="vx-name"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="Your name"
              maxLength={40}
              aria-invalid={nameErr}
              className={
                nameErr
                  ? 'glass-input w-full px-4 py-2.5 rounded-xl text-sm ring-1 ring-red-400/70'
                  : 'glass-input w-full px-4 py-2.5 rounded-xl text-sm'
              }
            />
            {nameErr && <p className="mt-1.5 text-xs text-red-300">Name is mandatory — tell us what to call you.</p>}
            <label className="block mt-3 mb-1 text-sm text-ink-300" htmlFor="vx-username">
              Pick a username <span className="text-ink-400 font-normal">(unique — auto-suggested, edit if you like)</span>
            </label>
            <div className="relative">
              <span aria-hidden="true" className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-ink-400">@</span>
              <input
                id="vx-username"
                value={handle}
                onChange={(e) => {
                  setHandleEdited(true);
                  setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20));
                  setHandleErr(null);
                  setHandleSuggestions([]);
                }}
                placeholder="username"
                maxLength={20}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                aria-invalid={handleErr != null}
                className={
                  handleErr
                    ? 'glass-input w-full pl-9 pr-4 py-2.5 rounded-xl text-sm ring-1 ring-red-400/70'
                    : 'glass-input w-full pl-9 pr-4 py-2.5 rounded-xl text-sm'
                }
              />
            </div>
            {handleErr ? (
              <p className="mt-1.5 text-xs text-red-300">{handleErr}</p>
            ) : handleAvail === 'taken' ? (
              <p className="mt-1.5 text-xs text-red-300">@{handle} already exists — pick another username.</p>
            ) : handleAvail === 'free' ? (
              <p className="mt-1.5 text-xs text-emerald-300">@{handle} is available.</p>
            ) : handleAvail === 'checking' ? (
              <p className="mt-1.5 text-xs text-ink-400">Checking availability…</p>
            ) : null}
            {handleSuggestions.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-semibold text-ink-400">Available:</span>
                {handleSuggestions.map((s) => (
                  <button
                    key={s}
                    onClick={() => {
                      setHandleEdited(true);
                      setHandle(s);
                      setHandleErr(null);
                      setHandleSuggestions([]);
                    }}
                    className="px-2.5 py-1 rounded-full text-xs font-semibold bg-white/10 hover:bg-white/20 text-ink-200"
                  >
                    @{s}
                  </button>
                ))}
              </div>
            )}
            {!handleOnly && (
              <>
                <div className="flex items-center justify-between gap-3 mt-4 mb-3">
                  <p className="text-sm font-bold text-ink-200">Which languages do you listen in?</p>
                  <button
                    onClick={() => setPicked(picked.length === LANGUAGES.length ? [] : LANGUAGES.map((l) => l.id))}
                    className="shrink-0 text-xs font-semibold text-ember-400 hover:text-ember-300"
                  >
                    {picked.length === LANGUAGES.length ? 'Clear' : 'All languages'}
                  </button>
                </div>
                <div className="flex flex-wrap gap-2 mb-6">
                  {LANGUAGES.map((l) => (
                    <Chip key={l.id} active={picked.includes(l.id)} onClick={() => toggle(l.id)}>
                      {l.label}
                    </Chip>
                  ))}
                </div>
                <p className="-mt-4 mb-5 text-[11px] font-semibold text-ink-400">Pick at least one — you can change these anytime.</p>
                <label className="flex items-start gap-2.5 mb-4 text-xs text-ink-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                    className="mt-0.5 accent-ember-500"
                  />
                  <span>Share anonymous usage (city-level location, no account) to help improve VinaX. You can change this anytime.</span>
                </label>
              </>
            )}
            <div className={handleOnly ? 'flex gap-3 mt-5' : 'flex gap-3'}>
              <button
                onClick={() => void continueFromWelcome()}
                disabled={claiming}
                className="flex-1 py-3 rounded-full btn-premium font-bold disabled:opacity-60"
              >
                {claiming ? 'Checking username…' : 'Continue'}
              </button>
            </div>
            <p className="mt-3 text-center text-xs font-semibold text-ink-400">No account. No login. Private by design.</p>
            <p className="mt-4 text-center text-xs text-ink-400">Already using VinaX on another device?</p>
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => navigate('/handoff?mode=receive')}
                className="flex-1 py-2.5 rounded-full border border-ink-600 text-xs font-semibold text-ink-200 hover:bg-ink-800/40 transition"
              >
                Move from old device
              </button>
              <button
                onClick={() => fileRef.current?.click()}
                className="flex-1 py-2.5 rounded-full border border-ink-600 text-xs font-semibold text-ink-200 hover:bg-ink-800/40 transition"
              >
                Import a file
              </button>
            </div>
            <p className="mt-2 text-center text-[11px] text-ink-500">
              Move: on your old device open Settings → <b>Move to a new device</b>, then scan its QR with this
              device&rsquo;s camera — or tap Move above and type the code.
            </p>
            <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={onImportFile} />
            {importErr && (
              <p className="mt-2 text-xs text-red-300 text-center">
                Couldn’t read that file — export it from another device via Settings → Your Data → Export, then import the .json here.
              </p>
            )}
          </>
        ) : slide ? (
          <>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                {step + 1} / {TOUR.length}
              </span>
              <button
                onClick={finish}
                className="text-[11px] font-semibold uppercase tracking-wider text-ink-500 hover:text-ink-300 transition"
              >
                Skip
              </button>
            </div>
            <div className="text-center mb-4">
              <div
                className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-3 bg-ember-500/15 text-ember-300"
                aria-hidden
              >
                {slide.icon}
              </div>
              <h2 id="vx-onboarding-title" className="text-xl font-bold">{slide.title}</h2>
            </div>
            <ul className="space-y-2.5 mb-4">
              {slide.lines.map((line) => (
                <li key={line} className="flex items-start gap-2 text-sm text-ink-200">
                  <ChevronDownIcon className="w-3.5 h-3.5 mt-1 -rotate-90 text-ember-400 shrink-0" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
            {slide.visual}
            {slide.shortcuts && (
              <div className="mt-4 flex flex-wrap gap-1.5 justify-center">
                {slide.shortcuts.map((s) => (
                  <span key={s.combo} className="inline-flex items-center gap-1 text-[11px] text-ink-400">
                    <KeyChip>{s.combo}</KeyChip>
                    <span>{s.label}</span>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-center justify-center gap-1.5 mt-5 mb-4" aria-hidden>
              {TOUR.map((_, i) => (
                <span key={i} className={i === step ? 'w-6 h-1.5 rounded-full bg-ember-500' : 'w-1.5 h-1.5 rounded-full bg-ink-600'} />
              ))}
            </div>
            <div className="flex gap-2.5">
              {step > 0 && (
                <button
                  onClick={() => setStep(step - 1)}
                  className="px-5 py-3 rounded-full border border-ink-600 text-sm text-ink-200 hover:bg-ink-800/40 transition"
                >
                  Back
                </button>
              )}
              <button
                onClick={() => (step < TOUR.length - 1 ? setStep(step + 1) : finish())}
                className="flex-1 py-3.5 rounded-full btn-primary text-[15px] font-semibold"
              >
                {step < TOUR.length - 1 ? 'Next' : 'Start listening'}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
