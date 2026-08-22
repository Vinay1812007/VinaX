import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { LANGUAGES } from '@/constants/languages';
import { KEYS } from '@/constants/storage-keys';
// Dynamic-imported inside finish() so the heavy changelog module doesn't
// land in first-load (WhatsNewSheet.tsx does the same for the same reason).
import { getLocal, setLocal } from '@/services/storage/local';
import { readBrowserSignals } from '@/services/location/browserSignals';
import { useSettingsStore } from '@/store/settingsStore';
import { useUiStore } from '@/store/uiStore';
import { ensureNotificationPermission, isNativePlatform } from '@/services/native';
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

const TOUR: TourSlide[] = [
  {
    icon: <SparkleIcon className="w-7 h-7" />,
    title: 'Welcome to VinaX',
    lines: [
      'Free forever — no login, no account, no ads, private by design.',
      '12 Indian languages and English, tuned to what you actually love to play.',
      'Everything runs on this device — your taste never leaves your phone.',
    ],
  },
  {
    icon: <HomeIcon className="w-7 h-7" />,
    title: 'A home that learns you',
    lines: [
      'Shelves adapt to your taste — Continue Listening, On Repeat, Most Listened, Because You Listened To, Fresh Finds, Hidden Gems and more.',
      '6 mood mixes rotate every day, with seasonal shelves — Monsoon Melodies, Weekend Party, festival specials — when the moment fits.',
      'Pull down to refresh: every shelf re-fetches with a new set of picks.',
    ],
  },
  {
    icon: <PlayIcon className="w-7 h-7" />,
    title: 'Play, swipe, sing along',
    lines: [
      'Tap any song to start — the queue builds itself around what you played.',
      'Swipe the mini-player left/right to skip, up for the full player.',
      'Karaoke-style lyrics sing along in real time, line by line.',
      'Close the app mid-song and come back — you land right where you left off.',
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
      'A full chat with seven engines: FLASH (default), 20B (fastest), SUPER (deepest thinking), INSTANT (music knowledge), 120B (creative + AI DJ), ULTRA (all-rounder) and NANO 3 (music discovery).',
      'Flip on Think for careful reasoning, or Research to pull from the live web.',
      '“play <song>” turns the reply into a real mini-player right in the chat.',
      'Voice chat listens and answers out loud — fully hands-free.',
    ],
  },
  {
    icon: <SearchIcon className="w-7 h-7" />,
    title: 'Search & command palette',
    lines: [
      'Tap search, or press the shortcut anywhere, to jump to any page, control the player, or find and play a song from one input.',
      'Right-click (or long-press) any song for instant actions: play next, queue, favorite, copy link.',
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
      'Create a room in one tap and share the code — friends join in a second.',
      'Everyone hears the same second, kept in sync to about a beat.',
      'Guests can request songs straight into your queue.',
      'End the room for everyone whenever you’re done.',
    ],
  },
  {
    icon: <HeartIcon className="w-7 h-7" />,
    title: 'Yours means yours',
    lines: [
      'Favorites, history, downloads and taste all live on this device — nothing is ever uploaded.',
      'Ten accent themes with dark, light and AMOLED — the whole app tints itself to the artwork playing.',
      'New phone? Export a file, import it anywhere (Settings → Your Data).',
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
  const [firstRun, setFirstRun] = useState(() => !getLocal<boolean>(KEYS.onboarded, false));
  const open = firstRun || tourOpen;
  const [step, setStep] = useState(-1); // -1 = language pick, 0..n = tour
  const detected = readBrowserSignals().languages;
  const [picked, setPicked] = useState<string[]>(detected.length ? detected : ['hindi', 'english']);
  const [name, setName] = useState<string>(() => getLocal<string>(KEYS.userName, ''));
  const [consent, setConsent] = useState<boolean>(true);
  const [nameErr, setNameErr] = useState(false);
  const [importErr, setImportErr] = useState(false);
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
  const openerRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const escapeRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement as HTMLElement | null;
    return () => {
      openerRef.current?.focus?.();
    };
  }, [open]);

  // On first mount, drop focus into the dialog so the very first keystroke
  // is captured by the modal instead of by whatever had focus before.
  useEffect(() => {
    if (!open) return;
    const root = dialogRef.current;
    const first = root?.querySelector<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled])',
    );
    first?.focus?.();
  }, [open]);

  // Escape closes the sheet; Tab is trapped inside so keyboard focus can't
  // wander into the (aria-hidden but rendered) app behind it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        escapeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const root = dialogRef.current;
      if (!root) return;
      const focusables = root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !root.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open]);

  if (!open) return null;

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const finish = () => {
    setLocal(KEYS.onboarded, true);
    setFirstRun(false);
    closeTour();
    // A fresh install has no "previous version" — stamp the current content
    // fingerprint (not the version string) so What's New doesn't fire on
    // the very first launch. Dynamically imported so the ~10 KB gz
    // historical changelog stays out of the first-load bundle.
    void import('@/constants/changelog').then((m) => {
      setLocal(KEYS.lastSeenVersion, m.latestNotesFingerprint());
    });
    // Ask for the notification permission lock-screen lyrics + media controls need.
    if (isNativePlatform()) void ensureNotificationPermission();
  };
  // Route the ref to the current finish so the keydown effect stays stable.
  escapeRef.current = finish;

  const continueFromWelcome = () => {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setNameErr(true);
      return;
    }
    setNameErr(false);
    setLocal(KEYS.userName, trimmed);
    setLocal(KEYS.analyticsConsent, consent);
    if (picked.length) useSettingsStore.getState().setPinnedLanguages(picked);
    // Register this (anonymous) device + name with the backend, if consented.
    void import('@/services/analytics/telemetry').then((m) => m.registerUser());
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
        {step === -1 ? (
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
              onChange={(e) => setName(e.target.value)}
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
            <div className="flex gap-3">
              <button onClick={continueFromWelcome} className="flex-1 py-3 rounded-full btn-premium font-bold">
                Continue
              </button>
            </div>
            <p className="mt-3 text-center text-xs font-semibold text-ink-400">No account. No tracking. No ads.</p>
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full mt-3 text-xs text-ink-400 hover:text-ink-200 transition"
            >
              Already using VinaX on another device?{' '}
              <span className="text-ember-400 font-semibold">Import your profile</span>
            </button>
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
