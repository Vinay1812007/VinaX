import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { TemplatePicker } from '@/features/settings/TemplatePicker';
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
import { mountHumanCheck, type HumanCheck } from '@/services/turnstile';
import type { Song } from '@/types';
import { Chip } from './Chip';
import { SparkleIcon, PlayIcon, HeartIcon, CompassIcon } from './Icons';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { cn } from '@/utils/cn';
import '@/styles/overlays.css';
// The app-style picker's miniatures are styled in the Settings sheet (this chunk is lazy).
import '@/styles/pages/settings.css';

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
 * The closing slides (11.0: four, down from eight — the guided tours in Help
 * carry the detail). Ground rules: every claim is true today, no version
 * numbers, a title of at most 5 words and one or two plain sentences.
 */
const TOUR: TourSlide[] = [
  {
    icon: <CompassIcon className="w-7 h-7" />,
    title: 'Five places to go',
    lines: [
      'Home, Discover, Search, Library and VinaX AI are always one tap away.',
      'The top bar shows where you are and holds that page’s actions.',
    ],
  },
  {
    icon: <PlayIcon className="w-7 h-7" />,
    title: 'Tap one song',
    lines: [
      'Tap any song and VinaX lines up five more, led by its language, familiar first.',
      'Songs you queue yourself play before those.',
    ],
    shortcuts: [{ combo: 'Space', label: 'play / pause' }, { combo: 'N', label: 'next song' }, { combo: 'F', label: 'favourite' }],
  },
  {
    icon: <SparkleIcon className="w-7 h-7" />,
    title: 'Change it any time',
    lines: [
      'Settings → Appearance holds the app style, theme, accent colour and festival themes.',
      'In VinaX AI, the chat takes the style of the model you pick.',
    ],
  },
  {
    icon: <HeartIcon className="w-7 h-7" />,
    title: 'Yours to keep',
    lines: [
      'Favourites and playlists stay on this device.',
      'Back up from Settings → Your data. A restore can be undone.',
    ],
  },
];

/** 11.0 — the welcome is one linear sequence of stages. `t0…` are TOUR slides. */
type Stage = 'you' | 'langs' | 'look' | 'songs' | `t${number}`;
const TOUR_STAGES: Stage[] = TOUR.map((_, i) => `t${i}` as Stage);

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
  const [stage, setStage] = useState<Stage>('you');
  const template = useSettingsStore((st) => st.template);
  const setTemplate = useSettingsStore((st) => st.setTemplate);
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
    return p?.status === 'taken' ? `@${p.username} is taken. Pick another username.` : null;
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
  // 'none' = the catalogue could not supply songs, so the step is left out.
  const [seed, setSeed] = useState<'idle' | 'loading' | 'ready' | 'none'>('idle');
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

  // Help → "Replay the welcome tour": the look step, then the slides.
  useEffect(() => {
    if (tourOpen) setStage('look');
  }, [tourOpen]);

  // 11.0 — keep the sheet above the on-screen keyboard. Browsers that overlay
  // the keyboard shrink only the VISUAL viewport, so the overlay is sized to it.
  const [vv, setVv] = useState<{ h: number; top: number; kb: boolean } | null>(null);
  useEffect(() => {
    const v = window.visualViewport;
    if (!open || !v) return;
    const update = () => {
      const gap = window.innerHeight - v.height;
      setVv(gap > 1 ? { h: v.height, top: v.offsetTop, kb: gap > 120 } : null);
    };
    update();
    v.addEventListener('resize', update);
    v.addEventListener('scroll', update);
    return () => {
      v.removeEventListener('resize', update);
      v.removeEventListener('scroll', update);
    };
  }, [open]);

  // A new step starts at its heading: focus moves there (screen readers read
  // it) and the body scrolls back to the top. The first paint is left to the
  // focus trap's own initial focus.
  const titleRef = useRef<HTMLHeadingElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const firstPaint = useRef(true);
  useEffect(() => {
    if (!open) {
      firstPaint.current = true;
      return;
    }
    if (firstPaint.current) {
      firstPaint.current = false;
      return;
    }
    bodyRef.current?.scrollTo?.({ top: 0 });
    titleRef.current?.focus();
  }, [stage, open]);

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

  // 11.1.0 — the human check for the username claim. Mounted as soon as the
  // first step shows, so the token is normally ready before Continue.
  // 11.1.1 — always on screen: the box ticks itself for almost everyone.
  const humanSlotRef = useRef<HTMLDivElement>(null);
  const humanCheckRef = useRef<HumanCheck | null>(null);
  useEffect(() => {
    const slot = humanSlotRef.current;
    if (!open || stage !== 'you' || !slot) return;
    const check = mountHumanCheck(slot, 'username', { visible: true });
    humanCheckRef.current = check;
    return () => {
      check.remove();
      if (humanCheckRef.current === check) humanCheckRef.current = null;
    };
  }, [open, stage]);

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

  // The sequence the listener walks. A returning listener who only owes a
  // username sees that one step; a replay starts at the look.
  const seq: Stage[] = handleOnly
    ? ['you']
    : firstRun
      ? ['you', 'langs', 'look', ...(seed === 'none' ? [] : (['songs'] as Stage[])), ...TOUR_STAGES]
      : ['look', ...TOUR_STAGES];
  const pos = Math.max(0, seq.indexOf(stage));
  const required = handleOnly || (firstRun && (stage === 'you' || stage === 'langs'));
  // Escape closes the sheet only once the required steps are behind: leaving
  // earlier would skip the username and the usage-sharing choice.
  escapeRef.current = required ? () => undefined : finish;
  const goNext = () => (pos < seq.length - 1 ? setStage(seq[pos + 1]) : finish());
  const goBack = () => pos > 0 && setStage(seq[pos - 1]);

  const continueFromYou = async () => {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setNameErr(true);
      return;
    }
    setNameErr(false);
    const username = handle.trim().toLowerCase();
    if (!USERNAME_RE.test(username)) {
      setHandleErr('Enter a username: 3 to 20 letters, numbers or underscores.');
      return;
    }
    if (handleAvail === 'taken') {
      setHandleErr(`@${username} is taken. Pick another username.`);
      return;
    }
    setHandleErr(null);
    // Coming Back to this step with the same, already-claimed username must
    // not claim it a second time.
    const p = pendingClaim();
    const mine = username === getLocal<string>(KEYS.userHandle, '') || (p?.status === 'pending' && p.username === username);
    if (!mine) {
      setClaiming(true);
      const outcome = await claimHandle(username, trimmed, () => humanCheckRef.current?.token() ?? Promise.resolve(null));
      setClaiming(false);
      if (outcome.status === 'taken') {
        setHandleErr(`@${username} is taken. Pick another username.`);
        setHandleSuggestions(outcome.suggestions);
        return;
      }
      // 'confirmed' stored the handle; 'pending' parked it for retry. Either
      // way the welcome continues — a flaky network must not block it, but it
      // must not pretend the name is confirmed either.
      if (outcome.status === 'pending') {
        toast(
          outcome.reason === 'offline'
            ? `You are offline. @${username} will be confirmed when you reconnect.`
            : outcome.reason === 'check'
              ? `VinaX could not check that you are a person, so @${username} is not confirmed yet. It will try again.`
              : `@${username} is not confirmed yet. VinaX will keep trying.`,
          { duration: 5000 },
        );
      }
    }
    setLocal(KEYS.userName, trimmed);
    if (handleOnly) {
      // Pre-username listener: handle claimed, nothing else to redo.
      setHandleOnly(false);
      return;
    }
    setStage('langs');
  };

  const continueFromLangs = () => {
    setLocal(KEYS.analyticsConsent, consent);
    if (picked.length) useSettingsStore.getState().setPinnedLanguages(picked);
    // Register this (anonymous) device + name with the backend, if consented.
    void import('@/services/analytics/telemetry').then((m) => m.registerUser());
    // AppLayout's idle init ran before consent existed — start insights now so
    // a fresh opt-in is covered from this session, not the next reload.
    initSessionInsights();
    // Fetch a dozen trending songs in the first picked language for the
    // "songs" step while the listener picks a look. If the catalogue is
    // unreachable or returns too few, that step is left out — it never blocks.
    setSeed('loading');
    setSeedSongs([]);
    setSeedLiked([]);
    const drop = () => {
      setSeed('none');
      setStage((st) => (st === 'songs' ? TOUR_STAGES[0] : st));
    };
    void searchSongs(trendingSeed(picked[0] ?? 'hindi'), 14)
      .then((songs) => {
        const clean = songs.filter((x) => x.images && x.images.length).slice(0, 12);
        if (clean.length >= 6) {
          setSeedSongs(clean);
          setSeed('ready');
        } else drop();
      })
      .catch(drop);
    setStage('look');
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
    setStage(TOUR_STAGES[0]);
  };

  const slideIdx = stage.startsWith('t') ? Number(stage.slice(1)) : -1;
  const slide = slideIdx >= 0 ? TOUR[slideIdx] : null;
  const last = pos === seq.length - 1;
  const shownLangs = moreLangs ? LANGUAGES : LANGUAGES.filter((l, i) => i < FIRST_LANGS || picked.includes(l.id));
  const title = (text: string, big = false) => (
    <h2 id="vx-onboarding-title" ref={titleRef} tabIndex={-1} className={cn('vx-welcome-title outline-none', !big && 'is-sm')}>{text}</h2>
  );
  const lede = (text: string) => <p className="mt-2 text-[14.5px] leading-snug text-ink-300">{text}</p>;

  return (
    <div
      className={cn('vx-welcome-scrim fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-6', stage === 'look' && 'is-look')}
      style={vv ? { height: vv.h, top: vv.top, bottom: 'auto' } : undefined}
      data-keyboard={vv?.kb ? 'open' : undefined}
      role="dialog"
      aria-modal="true"
      aria-labelledby="vx-onboarding-title"
    >
      <div ref={dialogRef} data-stage={stage} className="vx-sheet vx-mat-thick vx-welcome w-full sm:max-w-[460px]">
        <span aria-hidden className="vx-sheet-grab" />
        {seq.length > 1 && (
          <div className="vx-welcome-steps">
            <p className="vx-welcome-count" aria-live="polite">Step {pos + 1} of {seq.length}</p>
            <div className="vx-welcome-track" aria-hidden>
              {seq.map((id, i) => <span key={id} className={cn(i < pos && 'is-done', i === pos && 'is-on')} />)}
            </div>
            {!required && !last && (
              <button type="button" onClick={stage === 'look' || stage === 'songs' ? goNext : finish} className="vx-welcome-skip">
                {stage === 'look' || stage === 'songs' ? 'Skip' : 'Skip the rest'}
              </button>
            )}
          </div>
        )}
        <div ref={bodyRef} className="vx-welcome-body">
          {stage === 'you' ? (
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
                <span className="vx-welcome-badge">Free forever</span>
              </div>
              {title('Free. No sign-up.', true)}
              {lede(handleOnly
                ? 'One thing is missing: a username. There is still no email, no password and nothing to pay.'
                : 'No email, no password and nothing to pay. Choose a name and a username. Your listening stays on this device.')}
              <label className="vx-welcome-label mt-5" htmlFor="vx-name">Your name</label>
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
              {nameErr && <p className="vx-welcome-msg is-bad">Enter a name of at least two letters.</p>}
              <label className="vx-welcome-label mt-4" htmlFor="vx-username">Username</label>
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
                  aria-describedby="vx-username-msg"
                  className={cn(INPUT, 'pl-9', handleErr && INPUT_BAD)}
                />
              </div>
              <div id="vx-username-msg" aria-live="polite">
                {handleErr ? (
                  <p className="vx-welcome-msg is-bad">{handleErr}</p>
                ) : handleAvail === 'taken' ? (
                  <p className="vx-welcome-msg is-bad">@{handle} is taken. Pick another username.</p>
                ) : handleAvail === 'free' ? (
                  <p className="vx-welcome-msg is-good">@{handle} is available.</p>
                ) : handleAvail === 'checking' ? (
                  <p className="vx-welcome-msg">Checking availability…</p>
                ) : (
                  <p className="vx-welcome-msg">Other listeners find you by this. 3 to 20 letters, numbers or underscores.</p>
                )}
              </div>
              <div ref={humanSlotRef} className="vx-welcome-human" />
              {handleSuggestions.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-[12px] font-semibold text-ink-400">Available:</span>
                  {handleSuggestions.map((sug) => (
                    <Chip key={sug} onClick={() => { setHandleEdited(true); setHandle(sug); setHandleErr(null); setHandleSuggestions([]); }}>
                      @{sug}
                    </Chip>
                  ))}
                </div>
              )}
              {!handleOnly && (
                <div className="mt-5 pt-4 border-t border-[color:var(--vx-border)] flex items-center justify-center gap-1 flex-wrap text-[13px] text-ink-400">
                  <span>Already use VinaX elsewhere?</span>
                  <button type="button" onClick={() => navigate('/handoff?mode=receive')} className="vx-welcome-link">Move from old device</button>
                  <span aria-hidden>·</span>
                  <button type="button" onClick={() => fileRef.current?.click()} className="vx-welcome-link">Import a file</button>
                </div>
              )}
              <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={onImportFile} />
              {importErr && (
                <p className="vx-welcome-msg is-bad text-center">
                  That file could not be read. Export it from Settings → Your data on the other device, then import the .json here.
                </p>
              )}
            </>
          ) : stage === 'langs' ? (
            <>
              {title('Choose your languages')}
              {lede('Home, charts and the songs VinaX lines up start from these. Change them later in Settings.')}
              <div className="flex items-center justify-between gap-3 mt-5 mb-2.5">
                <p className="vx-welcome-label !mb-0">{picked.length ? `${picked.length} selected` : 'None selected'}</p>
                <button
                  type="button"
                  onClick={() => setPicked(picked.length === LANGUAGES.length ? [] : LANGUAGES.map((l) => l.id))}
                  className="vx-welcome-skip"
                >
                  {picked.length === LANGUAGES.length ? 'Clear' : 'All languages'}
                </button>
              </div>
              <div className="vx-welcome-langs" role="group" aria-label="Your languages">
                {shownLangs.map((l) => (
                  <Chip key={l.id} active={picked.includes(l.id)} onClick={() => toggle(l.id)}>{l.label}</Chip>
                ))}
                {!moreLangs && shownLangs.length < LANGUAGES.length && (
                  <button type="button" onClick={() => setMoreLangs(true)} className="vx-welcome-more">More languages</button>
                )}
              </div>
              <label className="vx-welcome-consent">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                <span>Share anonymous usage (city-level location, no account) and session insights with on-screen text masked, to help improve VinaX. Change it anytime in Settings.</span>
              </label>
            </>
          ) : stage === 'look' ? (
            <>
              {title('Pick your look')}
              {lede('Each style changes the colours, type, shapes, navigation and player. It applies as you choose, and your music and library stay the same.')}
              <div className="vx-welcome-look">
                <TemplatePicker value={template} onChange={setTemplate} />
              </div>
              <p className="vx-welcome-msg">Change it later in Settings → Appearance → App style.</p>
            </>
          ) : stage === 'songs' ? (
            <>
              {title('Tap songs you like')}
              {lede('Home starts from the songs you pick here. They are saved to Liked songs on this device.')}
              {seedSongs.length === 0 ? (
                <div className="grid grid-cols-3 gap-3 mt-5" aria-hidden>
                  {Array.from({ length: 12 }).map((_, i) => <div key={i} className="aspect-square rounded-lg skeleton" />)}
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-3 mt-5">
                  {seedSongs.map((song) => {
                    const liked = seedLiked.includes(song.id);
                    return (
                      <button
                        key={song.id}
                        type="button"
                        onClick={() => toggleSeed(song.id)}
                        aria-pressed={liked}
                        aria-label={`${liked ? 'Unlike' : 'Like'} ${song.title}`}
                        className={cn('vx-seed', liked && 'is-liked')}
                      >
                        <img src={bestImage(song.images, 150)} onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)} alt="" loading="lazy" />
                        <span className="vx-seed-heart" aria-hidden><HeartIcon filled={liked} className="w-4 h-4" /></span>
                        <span className="vx-seed-title">{song.title}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          ) : slide ? (
            <>
              <div className="vx-tour-art" aria-hidden>{slide.icon}</div>
              <div className="mt-5">{title(slide.title)}</div>
              <div className="mt-2 space-y-1.5">
                {slide.lines.map((line) => <p key={line} className="text-[15px] leading-relaxed text-ink-300">{line}</p>)}
              </div>
              {slide.visual}
              {slide.shortcuts && (
                <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
                  {slide.shortcuts.map((sc) => (
                    <span key={sc.combo} className="inline-flex items-center gap-1.5 text-[13px] text-ink-400">
                      <KeyChip>{sc.combo}</KeyChip>
                      <span>{sc.label}</span>
                    </span>
                  ))}
                </div>
              )}
            </>
          ) : null}
        </div>
        <div className="vx-welcome-foot">
          {pos > 0 && (
            <button type="button" onClick={goBack} className="h-12 px-5 rounded-full btn-secondary text-[15px]">Back</button>
          )}
          {slide && last && (
            <button
              type="button"
              onClick={() => { finish(); useTutorialStore.getState().start('first-song'); }}
              className="flex-1 h-12 rounded-full btn-secondary text-[15px]"
            >
              Take a tour
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if (stage === 'you') void continueFromYou();
              else if (stage === 'langs') continueFromLangs();
              else if (stage === 'songs') finishSeed(true);
              else goNext();
            }}
            disabled={claiming || (stage === 'songs' && seedSongs.length === 0)}
            className="flex-1 h-12 rounded-full btn-primary text-[15px] font-bold disabled:opacity-60"
          >
            {claiming
              ? 'Checking username…'
              : stage === 'songs' && seedLiked.length
                ? `Continue with ${seedLiked.length} liked`
                : slide
                  ? last ? 'Start listening' : 'Next'
                  : stage === 'look' ? 'Use this look' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
}
