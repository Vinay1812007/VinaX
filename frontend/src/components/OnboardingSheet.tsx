import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { LANGUAGES } from '@/constants/languages';
import { KEYS } from '@/constants/storage-keys';
// Dynamic-imported inside finish() so the heavy changelog module doesn't
// land in first-load (WhatsNewSheet.tsx does the same for the same reason).
import { getLocal, setLocal } from '@/services/storage/local';
import { initSessionInsights } from '@/services/analytics/sessionInsights';
import { readBrowserSignals } from '@/services/location/browserSignals';
import { useSettingsStore } from '@/store/settingsStore';
import { useUiStore } from '@/store/uiStore';
import { useTutorialStore } from '@/store/tutorialStore';
import { ensureNotificationPermission, isNativePlatform } from '@/services/native';
import { searchSongs } from '@/services/api';
import { trendingSeed } from '@/constants/seeds';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { useLibraryStore } from '@/store/libraryStore';
import { toast } from '@/store/toastStore';
import { claimHandle, pendingClaim, USERNAME_RE } from '@/features/identity/handleClaim';
import type { Song } from '@/types';
import { Chip } from './Chip';
import {
  SparkleIcon,
  HomeIcon,
  PlayIcon,
  HeartIcon,
  CompassIcon,
  QueueIcon,
  SearchIcon,
} from './Icons';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { cn } from '@/utils/cn';
import '@/styles/overlays.css';

/** Small pill for keyboard shortcut hints ("Space", "⌘K", etc). */
const KEY_CHIP = 'inline-flex items-center min-w-[24px] justify-center px-1.5 py-0.5 rounded-md bg-ink-100/10 text-[11px] font-bold text-ink-200';

/** The welcome art: music in the listener's scripts (decorative). */
const SCRIPTS = ['తెలుగు', 'हिन्दी', 'தமிழ்', 'മലയാളം', 'ಕನ್ನಡ', 'ਪੰਜਾਬੀ', 'বাংলা', 'मराठी', 'ગુજરાતી', 'English', 'اردو', 'ଓଡ଼ିଆ'];

/** Languages shown before "More languages" (the rest stay one tap away). */
const FIRST_LANGS = 10;

const INPUT = 'glass-input w-full h-12 px-4 rounded-xl text-[15px]';
const INPUT_BAD = 'ring-1 ring-[color:var(--vx-danger)]';
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
 * The Welcome tour (rewritten for 7.1). Ground rules for editing:
 *  - Every claim must be TRUE today. No version numbers in titles: the tour
 *    is evergreen, What's New handles releases.
 *  - A slide is a title of at most 6 words and at most 22 words of lines in
 *    total. The user is 10 seconds from music.
 */
const TOUR: TourSlide[] = [
  {
    icon: <CompassIcon className="w-7 h-7" />,
    title: 'Five places to go',
    lines: [
      'Home, Discover, Search, Library and VinaX AI are always one tap away.',
      'The top bar shows where you are and your actions.',
    ],
  },
  {
    icon: <HomeIcon className="w-7 h-7" />,
    title: 'Home learns your taste',
    lines: [
      'The Aura Mix on Home plays a mix built from your languages and listening.',
      'Trending for you puts today’s popular songs in your order.',
    ],
  },
  {
    icon: <PlayIcon className="w-7 h-7" />,
    title: 'Tap one song',
    lines: [
      'Tap any song. The DJ lines up five more, led by its language, familiar first.',
      'Songs you queue yourself go first.',
    ],
    shortcuts: [{ combo: 'Space', label: 'play / pause' }, { combo: 'N', label: 'next song' }, { combo: 'F', label: 'favourite' }],
  },
  {
    icon: <QueueIcon className="w-7 h-7" />,
    title: 'Steer what plays next',
    lines: [
      'In the player, Pin a mood or Tune this queue. Up Next rebuilds at once.',
      'Settings offers Familiar, Balanced or Discover.',
    ],
  },
  {
    icon: <SearchIcon className="w-7 h-7" />,
    title: 'Find something new',
    lines: [
      'Discover has shortcuts to charts, languages, moods, films, videos, mixes and Ads.',
      'Search takes songs, artists, films or a lyric line.',
    ],
  },
  {
    icon: <SparkleIcon className="w-7 h-7" />,
    title: 'Ask VinaX AI',
    lines: [
      'Chat about anything, choose a model, play songs from a reply.',
      'Messages go to the AI service; your library stays here.',
    ],
  },
  {
    icon: <HeartIcon className="w-7 h-7" />,
    title: 'Yours to keep',
    lines: [
      'Library keeps favourites and playlists on this device.',
      'Back up from Settings → Your data; a restore can be undone.',
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
  // Existing listeners from before usernames existed — and listeners whose
  // chosen handle the service REFUSED — reopen ONLY the welcome step so they
  // claim a handle, then close without re-running the tour. A claim that is
  // merely waiting for the network does not reopen anything: it retries on
  // its own (features/identity/handleClaim).
  const [handleOnly, setHandleOnly] = useState(
    () =>
      getLocal<boolean>(KEYS.onboarded, false) &&
      !getLocal<string>(KEYS.userHandle, '') &&
      pendingClaim()?.status !== 'pending',
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
  // v7.1.0 — unticked by default: the privacy page promises usage sharing "only if you opt in",
  // and a pre-ticked box is not an opt-in. It can be changed later in Settings → Region & Privacy.
  const [consent, setConsent] = useState<boolean>(false);
  const [nameErr, setNameErr] = useState(false);
  // Unique handle — mandatory, because display names collide across listeners.
  const [handle, setHandle] = useState<string>(
    () => getLocal<string>(KEYS.userHandle, '') || pendingClaim()?.username || '',
  );
  const [handleEdited, setHandleEdited] = useState(false);
  const [handleErr, setHandleErr] = useState<string | null>(() => {
    const p = pendingClaim();
    return p?.status === 'taken' ? `@${p.username} already exists — pick another username.` : null;
  });
  const [handleSuggestions, setHandleSuggestions] = useState<string[]>(() => pendingClaim()?.suggestions ?? []);
  const [claiming, setClaiming] = useState(false);
  // Live availability, checked while the listener types (debounced).
  const [handleAvail, setHandleAvail] = useState<'checking' | 'free' | 'taken' | null>(null);
  const [importErr, setImportErr] = useState(false);
  const [moreLangs, setMoreLangs] = useState(false);
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
      const { importProfileJson, readBackupFile } = await import('@/features/settings/actions');
      // Size is checked before the file is read into memory.
      const read = await readBackupFile(f);
      if (!read.ok) {
        setImportErr(true);
        toast(read.error, { duration: 6000 });
        return;
      }
      const out = importProfileJson(read.text);
      if (!out.ok) {
        setImportErr(true);
        toast(out.error, { duration: 6000 });
      }
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

  const continueFromWelcome = async () => {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setNameErr(true);
      return;
    }
    setNameErr(false);
    const username = handle.trim().toLowerCase();
    if (!USERNAME_RE.test(username)) {
      setHandleErr('Username is mandatory — 3–20 letters, numbers or _ only.');
      return;
    }
    if (handleAvail === 'taken') {
      setHandleErr(`@${username} already exists — pick another username.`);
      return;
    }
    setHandleErr(null);
    setClaiming(true);
    const outcome = await claimHandle(username, trimmed);
    setClaiming(false);
    if (outcome.status === 'taken') {
      setHandleErr(`@${username} already exists — pick another username.`);
      setHandleSuggestions(outcome.suggestions);
      return;
    }
    // 'confirmed' stored the handle; 'pending' parked it for retry. Either
    // way onboarding continues — a flaky network must not block the tour,
    // but it must not pretend the name is confirmed either.
    if (outcome.status === 'pending') {
      toast(
        outcome.reason === 'offline'
          ? `You're offline — @${username} will be confirmed when you reconnect.`
          : `Couldn't confirm @${username} yet — VinaX will keep trying.`,
        { duration: 5000 },
      );
    }
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
    // AppLayout's idle init ran before consent existed — start insights now so
    // a fresh opt-in is covered from this session, not the next reload.
    initSessionInsights();
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

  const shownLangs = moreLangs ? LANGUAGES : LANGUAGES.filter((l, i) => i < FIRST_LANGS || picked.includes(l.id));

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/70 p-0 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vx-onboarding-title"
    >
      <div ref={dialogRef} className="vx-sheet vx-welcome w-full sm:max-w-[440px] max-h-[94dvh] overflow-y-auto overscroll-contain">
        <span aria-hidden className="vx-sheet-grab" />
        {seedOpen ? (
          <div className="vx-welcome-body">
            <div className="flex items-start justify-between gap-3 mb-1">
              <h2 id="vx-onboarding-title" className="text-[22px] leading-tight font-extrabold tracking-[-0.02em]">Tap a few you love</h2>
              <button onClick={() => finishSeed(false)} className="vx-welcome-skip">
                Skip
              </button>
            </div>
            <p className="text-[14px] text-ink-400 mb-5">Home learns from these. They stay on this device.</p>
            {seedSongs.length === 0 ? (
              <div className="grid grid-cols-3 gap-3" aria-hidden>
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="aspect-square rounded-lg skeleton" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                {seedSongs.map((s) => {
                  const liked = seedLiked.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      onClick={() => toggleSeed(s.id)}
                      aria-pressed={liked}
                      aria-label={`${liked ? 'Unlike' : 'Like'} ${s.title}`}
                      className={cn('vx-seed', liked && 'is-liked')}
                    >
                      <img
                        src={bestImage(s.images, 150)}
                        onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)}
                        alt=""
                        loading="lazy"
                      />
                      <span className="vx-seed-heart" aria-hidden>
                        <HeartIcon filled={liked} className="w-4 h-4" />
                      </span>
                      <span className="vx-seed-title">{s.title}</span>
                    </button>
                  );
                })}
              </div>
            )}
            <button
              onClick={() => finishSeed(true)}
              disabled={seedSongs.length === 0}
              className="mt-6 w-full h-12 rounded-full btn-primary text-[15px] font-bold disabled:opacity-50"
            >
              {seedLiked.length ? `Continue with ${seedLiked.length} liked` : 'Continue'}
            </button>
          </div>
        ) : step === -1 ? (
          <>
            <div className="vx-welcome-art" aria-hidden>
              <div className="vx-welcome-scripts">
                {[0, 1, 2].map((row) => (
                  <p key={row}>
                    {SCRIPTS.slice(row * 4, row * 4 + 4).concat(SCRIPTS.slice(row * 4, row * 4 + 4)).map((w, i) => (
                      <span key={i}>{w}</span>
                    ))}
                  </p>
                ))}
              </div>
              <img src="/icons/icon.svg" alt="" className="vx-welcome-logo" />
            </div>
            <div className="vx-welcome-body">
              <h2 id="vx-onboarding-title" className="text-[26px] leading-[1.15] font-extrabold tracking-[-0.025em]">Music tuned to you</h2>
              <p className="mt-1.5 text-[14px] text-ink-400">No account, no login. Everything stays on this device.</p>

              <label className="vx-welcome-label mt-6" htmlFor="vx-name">
                What should we call you?
              </label>
              <input
                id="vx-name"
                value={name}
                onChange={(e) => onNameChange(e.target.value)}
                placeholder="Your name"
                maxLength={40}
                autoComplete="given-name"
                aria-invalid={nameErr}
                className={cn(INPUT, nameErr && INPUT_BAD)}
              />
              {nameErr && <p className="vx-welcome-msg is-bad">Enter a name for your listening profile.</p>}
              <label className="vx-welcome-label mt-4" htmlFor="vx-username">
                Username
              </label>
              <div className="relative">
                <span aria-hidden="true" className="absolute left-4 top-1/2 -translate-y-1/2 text-[15px] text-ink-400">@</span>
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
                  className={cn(INPUT, 'pl-9', handleErr && INPUT_BAD)}
                />
              </div>
              {handleErr ? (
                <p className="vx-welcome-msg is-bad">{handleErr}</p>
              ) : handleAvail === 'taken' ? (
                <p className="vx-welcome-msg is-bad">@{handle} already exists — pick another username.</p>
              ) : handleAvail === 'free' ? (
                <p className="vx-welcome-msg is-good">@{handle} is available.</p>
              ) : handleAvail === 'checking' ? (
                <p className="vx-welcome-msg">Checking availability…</p>
              ) : null}
              {handleSuggestions.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-[12px] font-semibold text-ink-400">Available:</span>
                  {handleSuggestions.map((s) => (
                    <Chip
                      key={s}
                      onClick={() => {
                        setHandleEdited(true);
                        setHandle(s);
                        setHandleErr(null);
                        setHandleSuggestions([]);
                      }}
                    >
                      @{s}
                    </Chip>
                  ))}
                </div>
              )}
              {!handleOnly && (
                <>
                  <div className="flex items-center justify-between gap-3 mt-6 mb-2.5">
                    <p className="vx-welcome-label !mb-0">Your languages</p>
                    <button
                      onClick={() => setPicked(picked.length === LANGUAGES.length ? [] : LANGUAGES.map((l) => l.id))}
                      className="vx-welcome-skip"
                    >
                      {picked.length === LANGUAGES.length ? 'Clear' : 'All languages'}
                    </button>
                  </div>
                  <div className="vx-welcome-langs">
                    {shownLangs.map((l) => (
                      <Chip key={l.id} active={picked.includes(l.id)} onClick={() => toggle(l.id)}>
                        {l.label}
                      </Chip>
                    ))}
                    {!moreLangs && shownLangs.length < LANGUAGES.length && (
                      <button type="button" onClick={() => setMoreLangs(true)} className="vx-welcome-more">
                        More languages
                      </button>
                    )}
                  </div>
                  <label className="vx-welcome-consent">
                    <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                    <span>Share anonymous usage (city-level location, no account) and session insights with on-screen text masked, to help improve VinaX. Change it anytime in Settings.</span>
                  </label>
                </>
              )}
              <div className="vx-welcome-cta">
                <button
                  onClick={() => void continueFromWelcome()}
                  disabled={claiming}
                  className="w-full h-12 rounded-full btn-primary text-[15px] font-bold disabled:opacity-60"
                >
                  {claiming ? 'Checking username…' : 'Continue'}
                </button>
              </div>
              <div className="mt-2 pt-4 border-t border-[color:var(--vx-border)] flex items-center justify-center gap-1 flex-wrap text-[13px] text-ink-400">
                <span>On VinaX elsewhere?</span>
                <button onClick={() => navigate('/handoff?mode=receive')} className="vx-welcome-link">
                  Move from old device
                </button>
                <span aria-hidden>·</span>
                <button onClick={() => fileRef.current?.click()} className="vx-welcome-link">
                  Import a file
                </button>
              </div>
              <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={onImportFile} />
              {importErr && (
                <p className="vx-welcome-msg is-bad text-center">
                  Couldn’t read that file. Export it from Settings → Your data on the other device, then import the .json here.
                </p>
              )}
            </div>
          </>
        ) : slide ? (
          <div className="vx-welcome-body">
            <div className="flex items-center justify-between mb-6">
              <span className="text-[13px] font-semibold text-ink-400 tabular-nums">
                {step + 1} of {TOUR.length}
              </span>
              <button onClick={finish} className="vx-welcome-skip">
                Skip
              </button>
            </div>
            <div className="vx-tour-art" aria-hidden>{slide.icon}</div>
            <h2 id="vx-onboarding-title" className="mt-5 text-[22px] leading-tight font-extrabold tracking-[-0.02em]">{slide.title}</h2>
            <div className="mt-2 space-y-1.5">
              {slide.lines.map((line) => (
                <p key={line} className="text-[15px] leading-relaxed text-ink-300">{line}</p>
              ))}
            </div>
            {slide.visual}
            {slide.shortcuts && (
              <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
                {slide.shortcuts.map((s) => (
                  <span key={s.combo} className="inline-flex items-center gap-1.5 text-[13px] text-ink-400">
                    <KeyChip>{s.combo}</KeyChip>
                    <span>{s.label}</span>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-center gap-1.5 mt-7 mb-5" aria-hidden>
              {TOUR.map((_, i) => (
                <span key={i} className={cn('h-1.5 rounded-full transition-all', i === step ? 'w-5 bg-ink-100' : 'w-1.5 bg-ink-100/25')} />
              ))}
            </div>
            <div className="flex gap-2">
              {step > 0 && (
                <button onClick={() => setStep(step - 1)} className="h-12 px-5 rounded-full btn-secondary text-[15px]">
                  Back
                </button>
              )}
              {step === TOUR.length - 1 && (
                <button
                  onClick={() => { finish(); useTutorialStore.getState().start('first-song'); }}
                  className="flex-1 h-12 rounded-full btn-secondary text-[15px]"
                >
                  Live walkthrough
                </button>
              )}
              <button
                onClick={() => (step < TOUR.length - 1 ? setStep(step + 1) : finish())}
                className="flex-1 h-12 rounded-full btn-primary text-[15px] font-bold"
              >
                {step < TOUR.length - 1 ? 'Next' : 'Start listening'}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
