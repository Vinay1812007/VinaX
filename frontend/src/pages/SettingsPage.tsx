import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import { scrollBehavior } from '@/utils/motion';
import { useSettingsStore, type DiscoveryMode, type QueueLanguages } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useRegion } from '@/features/location/useRegion';
import {
  clearCachedMetadata,
  clearFavoritesWithUndo,
  clearHistoryWithUndo,
  clearQueue,
  downloadProfileExport,
  importProfileJson,
  readBackupFile,
  resetAppState,
} from '@/features/settings/actions';
import { PersonalizationPreview } from '@/features/personalization/PersonalizationPreview';
import { SoftMuteList } from '@/features/personalization/SoftMuteList';
import { ACCENT_OPTIONS } from '@/constants/accents';
import { activeFestival, nextFestival } from '@/constants/festivals';
import { applyGlassLevel } from '@/utils/theme';
import { COUNTRIES, REGIONS } from '@/constants/regions';
import { KEYS } from '@/constants/storage-keys';
import { getLocal, setLocal } from '@/services/storage/local';
import { DISPLAY_VERSION } from '@/constants/version';
import { ensureNotificationPermission, getNotificationPermission, isNativePlatform } from '@/services/native';
import { pushSupported, isPushSubscribed, enablePush, disablePush } from '@/services/push';
import { appAlertsEnabled, setAppAlertsEnabled } from '@/services/announcements';
import { useAlarmStore } from '@/store/alarmStore';
import { checkForUpdate } from '@/services/update';
import { useUpdateStore } from '@/store/updateStore';
import { toast } from '@/store/toastStore';
import { LANGUAGES } from '@/constants/languages';
import { Chip } from '@/components/Chip';
import { UI_LANGS } from '@/i18n';
import type { AudioQualityPref } from '@/services/audio/engine';
import { PageHeader } from '@/components/PageHeader';
import { SoundSettings } from '@/components/SoundSettings';
import { Sheet } from '@/components/Sheet';
import { IconButton } from '@/components/IconButton';
import { cn } from '@/utils/cn';
import { createContext, useContext, useLayoutEffect } from 'react';
import {
  BellIcon,
  CheckIcon,
  ChevronRightIcon,
  ClockIcon,
  DownloadIcon,
  HelpIcon,
  PlayIcon,
  SearchIcon,
  ShieldIcon,
  SparkleIcon,
  SunIcon,
  WaveIcon,
  XIcon,
} from '@/components/Icons';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { handleStatus, retryPendingClaim, type HandleStatus } from '@/features/identity/handleClaim';
import { useUiStore } from '@/store/uiStore';
import { lazy, Suspense } from 'react';
import '@/styles/pages/settings.css';

const BackupCenter = lazy(() => import('@/features/settings/BackupCenter').then((m) => ({ default: m.BackupCenter })));
const ResetTasteSheet = lazy(() => import('@/features/personalization/ResetTasteSheet').then((m) => ({ default: m.ResetTasteSheet })));

/**
 * v5.19.0 — Settings search. A query at the top filters every row by its
 * label, note and keywords (case-insensitive, all words must match); sections
 * with no visible rows collapse; matches are highlighted.
 */
const SettingsSearchCtx = createContext('');
function matchesQuery(q: string, ...texts: Array<string | undefined>): boolean {
  if (!q) return true;
  const hay = texts.filter(Boolean).join(' ').toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}
function Highlight({ text, q }: { text: string; q: string }) {
  const w = q.trim().split(/\s+/).filter(Boolean)[0];
  if (!w) return <>{text}</>;
  const i = text.toLowerCase().indexOf(w.toLowerCase());
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="vx-set-mark">{text.slice(i, i + w.length)}</mark>
      {text.slice(i + w.length)}
    </>
  );
}

/**
 * v7.0.0 — the three discovery modes. 7.2: every mode carries its own
 * one-line explanation, shown together, so the choice can be read rather
 * than tried. The lines say what CHANGES, not how it feels.
 */
/** 8.1.0 — which languages a queue may draw from. */
const QUEUE_LANGUAGE_OPTIONS: Array<{ value: QueueLanguages; label: string; line: string }> = [
  { value: 'mix', label: 'Your languages', line: 'The playing song’s language leads; songs from your other languages can follow, never two switches in a row.' },
  { value: 'one', label: 'One language', line: 'Every queue stays in the language of the song that is playing.' },
];

const DISCOVERY_OPTIONS: Array<{ value: DiscoveryMode; label: string; line: string }> = [
  { value: 'familiar', label: 'Familiar', line: 'Mostly songs and artists you already play. New artists are rare.' },
  { value: 'balanced', label: 'Balanced', line: 'Your taste first, with about one new artist in every four or five songs.' },
  { value: 'discover', label: 'Discover', line: 'Up to half of a queue from artists you have never played. Home adds new languages.' },
];

/** The intensity slider in one plain line, for the value it is on now. */
function intensityWords(v: number): string {
  if (v <= 0.3) return 'Mostly what is popular and trending right now';
  if (v >= 0.7) return 'Mostly your own listening';
  return 'A mix of what is trending and what you play';
}

/* ------------------------------------------------------------ primitives */

/**
 * One settings row: label (+ hint) on the left, the control on the right.
 * `stack` — for wide controls (segmented choices, sliders, swatches): on
 * phones the control drops below the label at full width.
 */
function Row({ label, note, keywords, children, stack }: { label: string; note?: string; keywords?: string; children: ReactNode; stack?: boolean }) {
  const q = useContext(SettingsSearchCtx);
  if (!matchesQuery(q, label, note, keywords)) return null;
  return (
    <div data-settings-row className={cn('vx-set-row', stack && 'is-stack')}>
      <div className="vx-set-text">
        <p className="vx-set-label"><Highlight text={label} q={q} /></p>
        {note && <p className="vx-set-hint"><Highlight text={note} q={q} /></p>}
      </div>
      <div className="vx-set-control">{children}</div>
    </div>
  );
}

/**
 * A full-width settings block: like `Row`, but the control sits under the
 * label instead of beside it. Takes part in Settings search like every row.
 */
function Block({ label, note, keywords, action, children }: { label: string; note?: string; keywords?: string; action?: ReactNode; children: ReactNode }) {
  const q = useContext(SettingsSearchCtx);
  if (!matchesQuery(q, label, note, keywords)) return null;
  const id = `vx-block-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  return (
    <div data-settings-row className="vx-set-row is-block">
      <div className="vx-set-block-head">
        <div className="vx-set-text">
          <p id={id} className="vx-set-label"><Highlight text={label} q={q} /></p>
          {note && <p className="vx-set-hint"><Highlight text={note} q={q} /></p>}
        </div>
        {action}
      </div>
      <div className="vx-set-block-body">{children}</div>
    </div>
  );
}

/** A row that goes somewhere: the whole row is the link (or button), with a chevron. */
function LinkRow({ to, onClick, label, note, keywords, value }: { to?: string; onClick?: () => void; label: string; note?: string; keywords?: string; value?: string }) {
  const q = useContext(SettingsSearchCtx);
  if (!matchesQuery(q, label, note, keywords)) return null;
  const inner = (
    <>
      <span className="vx-set-text">
        <span className="vx-set-label"><Highlight text={label} q={q} /></span>
        {note && <span className="vx-set-hint"><Highlight text={note} q={q} /></span>}
      </span>
      <span className="vx-set-control">
        {value && <span className="vx-set-value">{value}</span>}
        <ChevronRightIcon className="vx-set-chev" />
      </span>
    </>
  );
  return to ? (
    <Link data-settings-row to={to} className="vx-set-row is-link">{inner}</Link>
  ) : (
    <button data-settings-row type="button" onClick={onClick} className="vx-set-row is-link">{inner}</button>
  );
}

/** A proper switch: accent track when on, a white knob that slides. */
function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className="vx-tap vx-switch">
      <span />
    </button>
  );
}

/** A small set of mutually exclusive choices as one segmented control. */
function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string; title?: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="vx-seg">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={value === o.value}
          aria-label={o.title}
          title={o.title}
          onClick={() => onChange(o.value)}
          className="vx-seg-item"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A compact action button at the right edge of a row. */
function RowButton({ onClick, children, tone, disabled, label }: { onClick: () => void; children: ReactNode; tone?: 'danger' | 'danger-solid'; disabled?: boolean; label?: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} className={cn('vx-tap vx-set-btn', tone === 'danger' && 'is-danger', tone === 'danger-solid' && 'is-danger-solid')}>
      {children}
    </button>
  );
}

interface SectionDef {
  id: string;
  title: string;
  icon: ComponentType<{ className?: string }>;
}

function Section({ title, id, children }: { title: string; id: string; children: ReactNode }) {
  const q = useContext(SettingsSearchCtx);
  const ref = useRef<HTMLElement>(null);
  const [empty, setEmpty] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setEmpty(!!q && !el.querySelector('[data-settings-row]'));
  }, [q]);
  return (
    <section ref={ref} id={id} className={cn('vx-set-section', empty && 'hidden')} data-settings-section aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="vx-set-title">{title}</h2>
      <div className="vx-set-group">{children}</div>
    </section>
  );
}

/** Desktop: the section index on the left, following the scroll. */
function SectionIndex({ sections }: { sections: SectionDef[] }) {
  const [active, setActive] = useState(sections[0]?.id);
  useEffect(() => {
    let frame = 0;
    const measure = (): void => {
      frame = 0;
      let current = sections[0]?.id;
      for (const s of sections) {
        const el = document.getElementById(s.id);
        if (!el || el.offsetParent === null) continue;
        if (el.getBoundingClientRect().top <= 140) current = s.id;
      }
      setActive(current);
    };
    const onScroll = (): void => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener('scroll', onScroll, { capture: true });
      if (frame) cancelAnimationFrame(frame);
    };
  }, [sections]);
  return (
    <nav aria-label="Settings sections" className="vx-set-index">
      {sections.map(({ id, title, icon: Icon }) => (
        <button
          key={id}
          type="button"
          aria-current={active === id ? 'true' : undefined}
          onClick={() => document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: scrollBehavior() })}
          className="vx-set-index-item"
        >
          <Icon className="w-5 h-5" />
          <span>{title}</span>
        </button>
      ))}
    </nav>
  );
}

/** v5.12.0 — artists blocked with “Never play …” from a song menu, with undo. */
function NeverPlayRow() {
  const hiddenArtists = useLibraryStore((s) => s.hiddenArtists);
  const toggleHiddenArtist = useLibraryStore((s) => s.toggleHiddenArtist);
  if (!hiddenArtists.length) return null;
  return (
    <Block label="Never play" note="Skipped everywhere. Tap an artist to allow them again." keywords="blocked artists hidden">
      <div className="flex flex-wrap gap-2">
        {hiddenArtists.map((a) => (
          <Chip key={a} active onClick={() => toggleHiddenArtist(a)}>
            {a.replace(/\b\w/g, (c) => c.toUpperCase())} ✕
          </Chip>
        ))}
      </div>
    </Block>
  );
}

// C7 — human names for every KEYS entry the erase modal lists. Derived from
// the registry at render, so a new storage key can never silently go unlisted
// (unknown keys fall back to their raw name — visible, if inelegant).
const ERASE_LABELS: Record<string, string> = {
  schemaVersion: 'Storage schema version',
  settings: 'Settings & preferences',
  player: 'Player state & queue',
  queueOwnership: 'Who queued each song',
  library: 'Favorites, collections & hidden songs',
  history: 'Listening history',
  search: 'Recent searches',
  profile: 'Taste profile',
  profileKid: 'Kid-mode taste profile',
  region: 'Region preference',
  onboarded: 'Onboarding state',
  lastSeenVersion: 'What’s-New read state',
  deviceId: 'Anonymous device id',
  userName: 'Your name',
  userHandle: 'Your username',
  userHandlePending: 'Username waiting to be confirmed',
  signedDeviceId: 'Service-issued device token',
  updateSnooze: '“Update later” choice',
  analyticsConsent: 'Analytics consent choice',
  downloads: 'Downloads index',
  alarm: 'Wake alarm',
  lyricsOffset: 'Lyric sync offsets',
  karaoke: 'Karaoke history',
  weekly: 'Weekly mix cache',
  output: 'Audio output preference',
  roomHostTokens: 'Listen Together host keys',
  updateAttempt: 'Update install attempt marker',
  aiChats: 'VinaX AI chat history',
};
const eraseItems = [
  ...Object.keys(KEYS).map((k) => ERASE_LABELS[k] ?? k),
  'Play-event log (IndexedDB)',
  'Cached artwork & audio (Cache Storage)',
];

/** v5.19.0 — "nothing matches" line for Settings search (checked after paint). */
function NoMatches({ q }: { q: string }) {
  const [none, setNone] = useState(false);
  useLayoutEffect(() => {
    const t = window.setTimeout(() => setNone(!document.querySelector('[data-settings-row]')), 0);
    return () => window.clearTimeout(t);
  }, [q]);
  if (!none) return null;
  return (
    <div className="vx-set-empty">
      <SearchIcon className="w-6 h-6" />
      <p className="vx-set-empty-title">No results for “{q}”</p>
      <p className="vx-set-hint">Try theme, alarm, quality or language.</p>
    </div>
  );
}

/**
 * Username row — says exactly what the service knows. A handle chosen while
 * offline is "waiting", never shown as confirmed; a refused one asks for a
 * new choice (reopens the welcome step's handle picker).
 */
function UsernameRow() {
  const [status, setStatus] = useState<HandleStatus>(handleStatus);
  const [busy, setBusy] = useState(false);
  const openTour = useUiStore((x) => x.openTour);
  useEffect(() => {
    const refresh = () => setStatus(handleStatus());
    window.addEventListener('online', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('online', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);
  const retry = async () => {
    setBusy(true);
    const out = await retryPendingClaim();
    setBusy(false);
    setStatus(handleStatus());
    if (out?.status === 'confirmed') toast(`@${out.username} is confirmed`);
    else if (out?.status === 'taken') toast(`@${out.username} is taken — choose another`);
    else if (out) toast('Still could not reach the service — will retry when you reconnect');
  };
  const label = status.state === 'none' ? 'No username yet' : `@${status.handle}`;
  const note =
    status.state === 'confirmed'
      ? 'Confirmed by the service. Unique to you across VinaX.'
      : status.state === 'pending'
        ? `Chosen ${new Date(status.since).toLocaleDateString()} but not confirmed yet — VinaX retries when you are online.`
        : status.state === 'taken'
          ? 'That username was already taken when VinaX tried to confirm it. Pick another.'
          : 'Usernames are claimed from the welcome step.';
  return (
    <Row label={label} note={note} keywords="username handle account">
      {status.state === 'pending' ? (
        <RowButton onClick={() => void retry()} disabled={busy}>
          {busy ? 'Confirming…' : 'Confirm now'}
        </RowButton>
      ) : status.state === 'taken' || status.state === 'none' ? (
        <RowButton onClick={openTour}>Choose</RowButton>
      ) : (
        <span className="vx-set-status">
          <CheckIcon className="w-4 h-4" />
          Confirmed
        </span>
      )}
    </Row>
  );
}

/** 5.14.0 — festival skins switch with a live "today / next" line. */
function FestivalRow() {
  const on = useSettingsStore((x) => x.festivalSkins);
  const setOn = useSettingsStore((x) => x.setFestivalSkins);
  const today = activeFestival();
  const next = nextFestival();
  const line = today
    ? `${today.name} is on now`
    : next
      ? `Next: ${next.festival.name} in ${next.inDays} day${next.inDays === 1 ? '' : 's'}`
      : 'No festival on the calendar';
  return (
    <Row label="Festival themes" note={`${line}.`} keywords="every festival brings its own look accent background glow greeting">
      <Toggle on={on} onChange={setOn} label="Festival themes" />
    </Row>
  );
}

/** A labelled range with words at both ends (sentence case, not an eyebrow). */
function RangeRow({ from, to, children }: { from: string; to: string; children: ReactNode }) {
  return (
    <div className="vx-set-range">
      <span aria-hidden>{from}</span>
      {children}
      <span aria-hidden>{to}</span>
    </div>
  );
}

/** What the Sound block answers to in Settings search. */
const SOUND_KEYWORDS = 'sound effects equalizer equaliser eq presets bass vocal treble loud podcast balance left right mono audio loudness normalisation normalization volume status';

const SECTIONS: SectionDef[] = [
  { id: 'appearance', title: 'Appearance', icon: SunIcon },
  { id: 'playback', title: 'Playback', icon: PlayIcon },
  { id: 'sound', title: 'Sound', icon: WaveIcon },
  { id: 'recommendations', title: 'Recommendations', icon: SparkleIcon },
  { id: 'notifications', title: 'Notifications', icon: BellIcon },
  { id: 'alarm', title: 'Wake-up alarm', icon: ClockIcon },
  { id: 'privacy', title: 'Region & privacy', icon: ShieldIcon },
  { id: 'your-data', title: 'Your data', icon: DownloadIcon },
  { id: 'help', title: 'Help & about', icon: HelpIcon },
];

export default function SettingsPage() {
  const [settingsQuery, setSettingsQuery] = useState('');
  usePageTitle('Settings');
  const s = useSettingsStore();
  const wide = useMediaQuery('(min-width: 1024px)');
  // Usage-sharing consent lives outside the settings store (it is never part of a backup).
  const [usageSharing, setUsageSharing] = useState<boolean>(() => getLocal<boolean>(KEYS.analyticsConsent, false) === true);
  const region = useRegion();
  const fileRef = useRef<HTMLInputElement>(null);
  const [notifPerm, setNotifPerm] = useState<'granted' | 'denied' | 'unsupported' | 'unknown'>('unknown');
  const [eraseOpen, setEraseOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false); // C7 deletion receipt
  const [resetOpen, setResetOpen] = useState(false); // 7.2 taste reset, backup first
  useEffect(() => {
    if (isNativePlatform()) void getNotificationPermission().then(setNotifPerm);
  }, []);
  const [pushOn, setPushOn] = useState(false);
  const [appAlerts, setAppAlerts] = useState(() => appAlertsEnabled());
  useEffect(() => {
    if (pushSupported()) void isPushSubscribed().then(setPushOn);
  }, []);
  const togglePush = async (v: boolean): Promise<void> => {
    if (v) {
      const r = await enablePush();
      if (r === 'ok') {
        setPushOn(true);
        toast('Notifications enabled');
      } else if (r === 'denied') {
        toast('Permission was denied in your browser');
      } else if (r === 'unsupported') {
        toast('Not supported on this browser');
      } else {
        toast('Could not enable notifications');
      }
    } else {
      await disablePush();
      setPushOn(false);
      toast('Notifications disabled');
    }
  };
  const alarm = useAlarmStore();
  const collections = useLibraryStore((s) => s.collections);
  // A link like /settings#your-data lands on the section, under the sticky bar.
  const { hash } = useLocation();
  useEffect(() => {
    if (!hash) return;
    const el = document.getElementById(hash.slice(1));
    el?.scrollIntoView({ block: 'start', behavior: scrollBehavior() });
  }, [hash]);

  const showNotifications = pushSupported() || isNativePlatform();
  const sections = showNotifications ? SECTIONS : SECTIONS.filter((x) => x.id !== 'notifications');

  return (
    <SettingsSearchCtx.Provider value={settingsQuery.trim()}>
      <div className="vx-settings">
        {wide && !settingsQuery && <SectionIndex sections={sections} />}
        <div className="vx-set-main">
          <PageHeader title="Settings" />
          <div className="vx-set-search">
            <SearchIcon className="vx-set-search-icon" />
            <input
              value={settingsQuery}
              onChange={(e) => setSettingsQuery(e.target.value)}
              placeholder="Search settings"
              aria-label="Search settings"
              type="search"
              enterKeyHint="search"
            />
            {settingsQuery && (
              <IconButton label="Clear search" size="sm" onClick={() => setSettingsQuery('')} className="vx-set-search-clear">
                <XIcon className="w-4 h-4" />
              </IconButton>
            )}
          </div>
          {settingsQuery && <NoMatches q={settingsQuery} />}

          <Section title="Appearance" id="appearance">
            <Row stack label="App language" keywords="display language interface">
              <Segmented label="App language" value={s.uiLanguage} onChange={s.setUiLanguage} options={UI_LANGS.map((l) => ({ value: l.id, label: l.label }))} />
            </Row>
            <Row stack label="Theme" keywords="dark light black system auto day night mode">
              <Segmented
                label="Theme"
                value={s.theme}
                onChange={s.setTheme}
                options={[
                  { value: 'dark', label: 'Dark' },
                  { value: 'amoled', label: 'Black' },
                  { value: 'light', label: 'Light' },
                  { value: 'system', label: 'System' },
                  { value: 'auto', label: 'Auto', title: 'Auto (day/night)' },
                ]}
              />
            </Row>
            <FestivalRow />
            <Row stack label="Accent color" keywords="colour highlight buttons links player">
              <div className="vx-set-swatches" role="radiogroup" aria-label="Accent color">
                {ACCENT_OPTIONS.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    role="radio"
                    aria-checked={s.accent === a.id}
                    aria-label={`${a.label} accent`}
                    title={a.label}
                    onClick={() => s.setAccent(a.id)}
                    className="vx-set-swatch"
                    style={{ backgroundColor: a.dot }}
                  />
                ))}
              </div>
            </Row>
            <Row stack label="Custom accent" note="Any colour. VinaX builds a readable palette from it." keywords="colour color palette hex">
              <div className="flex items-center gap-2">
                <input type="color" aria-label="Custom accent colour" value={s.accentCustom ?? '#a78bfa'} onChange={(e) => s.setAccentCustom(e.target.value)} className="vx-set-color" />
                <input value={s.accentCustom ?? ''} onChange={(e) => { const v = e.target.value.trim(); if (/^#[0-9a-fA-F]{6}$/.test(v)) s.setAccentCustom(v); }} placeholder="#a78bfa" maxLength={7} className="vx-set-input w-28 font-mono" aria-label="Custom accent hex" />
                {s.accent === 'custom' && <RowButton onClick={() => s.setAccentCustom(null)}>Use a preset</RowButton>}
              </div>
            </Row>
            <Row stack label="Display size" note="Text and controls, everywhere." keywords="scale font zoom">
              <Segmented label="Display size" value={s.uiScale} onChange={s.setUiScale} options={[{ value: 'sm', label: 'Small' }, { value: 'md', label: 'Default' }, { value: 'lg', label: 'Large' }]} />
            </Row>
            <Row stack label="Density" keywords="comfortable compact spacing">
              <Segmented label="Density" value={s.density} onChange={s.setDensity} options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]} />
            </Row>
            <Row label="High contrast" note="Brighter text, visible borders and a strong focus ring." keywords="accessibility">
              <Toggle on={s.highContrast} onChange={s.setHighContrast} label="High contrast" />
            </Row>
            <Row stack label="Glass effect" note="From solid panels to frosted glass." keywords="transparency see-through classic">
              <RangeRow from="Solid" to="Glass">
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={s.glassLevel}
                  aria-label="Glass effect intensity"
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    s.setGlassLevel(v);
                    applyGlassLevel(v, s.glassBlur);
                  }}
                />
              </RangeRow>
            </Row>
            <Row stack label="Background blur" note="From sharp to a soft, hazy backdrop." keywords="glass haze">
              <RangeRow from="Sharp" to="Hazy">
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={s.glassBlur}
                  aria-label="Background blur intensity"
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    s.setGlassBlur(v);
                    applyGlassLevel(s.glassLevel, v);
                  }}
                />
              </RangeRow>
            </Row>
            <Row label="Dynamic theme" note="Takes the accent from the playing song’s artwork." keywords="experimental colour">
              <Toggle on={s.dynamicTheme} onChange={s.setDynamicTheme} label="Dynamic theme" />
            </Row>
            <Row label="Reduce motion" note="Fewer animations and transitions." keywords="accessibility motion sensitivity older phones">
              <Toggle on={s.reduceMotion} onChange={(v) => { s.setReduceMotion(v); document.documentElement.classList.toggle('reduce-motion', v); }} label="Reduce motion" />
            </Row>
            <Block label="Startup page" note="What opens first." keywords="home search library last where I left off">
              <div className="flex gap-2 flex-wrap">
                {(['home', 'search', 'library', 'last'] as const).map((v) => (
                  <Chip key={v} active={s.startPage === v} onClick={() => s.setStartPage(v)}>{v === 'home' ? 'Home' : v === 'search' ? 'Search' : v === 'library' ? 'Library' : 'Where I left off'}</Chip>
                ))}
              </div>
            </Block>
          </Section>

          <Section title="Playback" id="playback">
            <Row label="Autoplay" note="As your list runs out, similar songs keep the music going. Smart Queue on the Queue page turns this and “DJ builds every queue” on together.">
              <Toggle on={s.autoplay} onChange={s.setAutoplay} label="Autoplay" />
            </Row>
            <Row label="Crossfade" note="Fade between songs and fade new songs in." keywords="smooth transition">
              <Toggle on={s.crossfade} onChange={s.setCrossfade} label="Crossfade" />
            </Row>
            {s.crossfade && (
              <Row stack label="Crossfade length">
                <Segmented label="Crossfade length" value={s.crossfadeSeconds} onChange={s.setCrossfadeSeconds} options={[3, 5, 8, 12].map((n) => ({ value: n, label: `${n}s` }))} />
              </Row>
            )}
            <Row label="Resume playback" note="Pick up longer tracks where you left off.">
              <Toggle on={s.resumePlayback} onChange={s.setResumePlayback} label="Resume playback" />
            </Row>
            <Row stack label="Audio quality" note="The closest available stream; falls back automatically." keywords="bitrate low medium high">
              <Segmented<AudioQualityPref> label="Audio quality" value={s.audioQuality} onChange={s.setAudioQuality} options={[{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }]} />
            </Row>
            <Row label="Data saver" note="Lightest audio, no video canvas, lighter artwork." keywords="mobile data">
              <Toggle on={s.dataSaver} onChange={s.setDataSaver} label="Data saver" />
            </Row>
            <Row label="Keep screen on in player" note="While the full-screen player is open and playing." keywords="wake lock">
              <Toggle on={s.keepScreenOn} onChange={s.setKeepScreenOn} label="Keep screen on in player" />
            </Row>
            {isNativePlatform() && (
              <Row label="Lock screen lyrics" note="The current synced line on your lock screen and media controls.">
                <Toggle on={s.lockScreenLyrics} onChange={(v) => { s.setLockScreenLyrics(v); if (v) void ensureNotificationPermission().then(() => getNotificationPermission().then(setNotifPerm)); }} label="Lock screen lyrics" />
              </Row>
            )}
            {notifPerm === 'denied' && (
              <div className="vx-set-banner">
                <span>Notifications are off — lock-screen lyrics and playback controls need them to appear.</span>
                <button
                  type="button"
                  onClick={() => void ensureNotificationPermission().then(() => getNotificationPermission().then(setNotifPerm))}
                  className="vx-tap vx-set-btn is-accent"
                >
                  Enable
                </button>
              </div>
            )}
            <Row
              label="DJ voice"
              note="The DJ introduces each song while the music ducks. The studio voice sends the line to the service; your device’s voice is the offline fallback."
              keywords="segue now playing speak voice talk"
            >
              <Toggle on={s.djVoice} onChange={s.setDjVoice} label="DJ voice" />
            </Row>
            <Row stack label="Lyrics size" note="Synced lyrics in the player, karaoke and lyrics page." keywords="text">
              <Segmented label="Lyrics size" value={s.lyricsSize} onChange={s.setLyricsSize} options={[{ value: 'sm', label: 'Small' }, { value: 'md', label: 'Medium' }, { value: 'lg', label: 'Large' }, { value: 'xl', label: 'Huge' }]} />
            </Row>
            {isNativePlatform() && (
              <Row label="Haptics" note="Subtle vibration on key actions.">
                <Toggle on={s.haptics} onChange={s.setHaptics} label="Haptics" />
              </Row>
            )}
            <Row stack label="Daily listening goal" note="A ring on Your VinaX fills as you listen." keywords="minutes target">
              <Segmented
                label="Daily listening goal"
                value={s.dailyGoalMinutes}
                onChange={s.setDailyGoalMinutes}
                options={[0, 15, 30, 60, 120].map((n) => ({ value: n, label: n === 0 ? 'Off' : n >= 60 ? `${n / 60}h` : `${n} min` }))}
              />
            </Row>
            <NeverPlayRow />
          </Section>

          {/* v5.19.0 — on-device sound processing (restyled to this list from settings.css).
              Its rows are its own markup, so search matches the block as a whole. */}
          {matchesQuery(settingsQuery.trim(), SOUND_KEYWORDS) && (
            <div data-tour="sound" id="sound" className="vx-set-sound">
              {settingsQuery.trim() && <span data-settings-row hidden />}
              <SoundSettings />
            </div>
          )}

          <Section title="Recommendations" id="recommendations">
            {/* 7.2 — what the app believes about this listener, before the switches that change it. */}
            <Block
              label="What VinaX thinks you like"
              note="From the taste profile on this device. Nothing here is uploaded."
              keywords="personalization preview taste languages artists muted"
            >
              <div className="vx-set-preview">
                <PersonalizationPreview />
              </div>
            </Block>
            <Block
              label="Trending vs. your taste"
              note="How much Home and the DJ lean on what is popular right now."
              keywords="intensity personalization trending against what you actually play"
            >
              <RangeRow from="Trending" to="Your taste">
                <input
                  type="range"
                  aria-label="Trending vs. your taste"
                  aria-valuetext={intensityWords(s.recommendationIntensity)}
                  min={0}
                  max={1}
                  step={0.1}
                  value={s.recommendationIntensity}
                  onChange={(e) => s.setRecommendationIntensity(Number(e.target.value))}
                  style={{ '--fill': `${s.recommendationIntensity * 100}%` } as React.CSSProperties}
                />
              </RangeRow>
              <p className="vx-set-hint mt-2">{intensityWords(s.recommendationIntensity)}.</p>
            </Block>
            <Block
              label="Discovery"
              note="How far recommendations roam. Every queue opens with songs you know."
              keywords="familiar balanced discover explore new artists"
            >
              <div className="vx-set-options" role="group" aria-label="Discovery mode">
                {DISCOVERY_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    aria-label={o.label}
                    aria-pressed={s.discoveryMode === o.value}
                    aria-describedby={`vx-discovery-${o.value}`}
                    onClick={() => s.setDiscoveryMode(o.value)}
                    className="vx-set-option"
                  >
                    <span className="vx-set-option-title">
                      {o.label}
                      <CheckIcon className="vx-set-option-check" />
                    </span>
                    <span id={`vx-discovery-${o.value}`} className="vx-set-option-line">{o.line}</span>
                  </button>
                ))}
              </div>
            </Block>
            <Block
              label="Queue languages"
              note="Whether what plays next may move between the languages you listen in."
              keywords="language mix telugu hindi tamil english queue switch"
            >
              <div className="vx-set-options" role="group" aria-label="Queue languages">
                {QUEUE_LANGUAGE_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    aria-label={o.label}
                    aria-pressed={(s.queueLanguages ?? 'mix') === o.value}
                    aria-describedby={`vx-queue-languages-${o.value}`}
                    onClick={() => s.setQueueLanguages(o.value)}
                    className="vx-set-option"
                  >
                    <span className="vx-set-option-title">
                      {o.label}
                      <CheckIcon className="vx-set-option-check" />
                    </span>
                    <span id={`vx-queue-languages-${o.value}`} className="vx-set-option-line">{o.line}</span>
                  </button>
                ))}
              </div>
            </Block>
            <Row
              label="AI in recommendations"
              note="Lets AI engines tag songs, re-rank what plays next, run the DJ and read descriptions you type in Search. Off keeps every pick on your device; nothing about your listening is sent for recommendations."
              keywords="ai assist privacy on-device embeddings ranking"
            >
              <Toggle on={s.aiAssist} onChange={s.setAiAssist} label="AI in recommendations" />
            </Row>
            <Row
              label="AI DJ"
              note="The DJ engine orders what plays next — an energy arc, no repeats — and suggests a few songs beyond the app’s picks, each checked against the catalogue. Off keeps the on-device order."
              keywords="sequence queue reason"
            >
              <Toggle on={s.aiDj} onChange={s.setAiDj} label="AI DJ" />
            </Row>
            <Row
              label="DJ builds every queue"
              note="Tap any song and the DJ builds what follows from it. Off plays the list you tapped. Songs you queue by hand are never replaced. Needs Autoplay; Smart Queue on the Queue page turns both on."
              keywords="album playlist shelf queue builder takeover"
            >
              <Toggle on={s.djTakeover} onChange={s.setDjTakeover} label="DJ builds every queue" />
            </Row>
            <Row
              label="AI-designed shelves on Home"
              note="A “Designed for you” block titled from your taste and the time of day, and an AI-ordered “Trending for you”. Off keeps Trending in your own order."
              keywords="home shelves designed for you"
            >
              <Toggle on={s.aiHomeShelves} onChange={s.setAiHomeShelves} label="AI-designed shelves" />
            </Row>
            {/* 7.2 — the temporary mutes, kept well away from the permanent "Never play" list. */}
            <Block
              label="Playing less of"
              note="Artists you asked to hear less of with “Less like this”. Each one comes back on its own; Never play, under Playback, is the permanent block."
              keywords="soft mute muted less like this artists"
            >
              <SoftMuteList />
            </Block>
            <Row
              label="Kid mode"
              note="Hides songs the catalogue marks explicit, everywhere, and keeps a separate taste profile. Favourites and downloads stay shared. Only as good as the catalogue’s flags."
              keywords="children explicit family"
            >
              <Toggle
                on={s.kidMode}
                onChange={(v) => {
                  s.setKidMode(v);
                  toast(v ? 'Kid mode on — explicit songs hidden, separate taste profile active' : 'Kid mode off — back to your own taste profile');
                }}
                label="Kid mode"
              />
            </Row>
            <Block
              label="Preferred languages"
              note="Pinned languages get boosted everywhere."
              keywords="pinned language boost"
              action={
                <RowButton
                  onClick={() => {
                    const allPinned = s.pinnedLanguages.length === LANGUAGES.length;
                    s.setPinnedLanguages(allPinned ? [] : LANGUAGES.map((l) => l.id));
                    if (!allPinned) s.setMutedLanguages([]);
                  }}
                >
                  {s.pinnedLanguages.length === LANGUAGES.length ? 'Clear all' : 'All languages'}
                </RowButton>
              }
            >
              <div className="flex flex-wrap gap-2">
                {LANGUAGES.map((l) => (
                  <Chip key={l.id} active={s.pinnedLanguages.includes(l.id)} onClick={() => s.togglePinnedLanguage(l.id)}>
                    {l.label}
                  </Chip>
                ))}
              </div>
            </Block>
            <Block label="Muted languages" note="Never recommended anywhere." keywords="mute language hide">
              <div className="flex flex-wrap gap-2">
                {LANGUAGES.map((l) => (
                  <Chip key={l.id} active={s.mutedLanguages.includes(l.id)} tone="danger" onClick={() => s.toggleMutedLanguage(l.id)}>
                    {l.label}
                  </Chip>
                ))}
              </div>
            </Block>
          </Section>

          {showNotifications && (
            <Section title="Notifications" id="notifications">
              {pushSupported() ? (
                <Row label="Push notifications" note="New song picks on this device. Turn off anytime.">
                  <Toggle on={pushOn} onChange={(v) => void togglePush(v)} label="Push notifications" />
                </Row>
              ) : (
                <Row label="New-music alerts" note="New announcements appear as notifications when the app opens.">
                  <Toggle
                    on={appAlerts}
                    onChange={(v) => {
                      setAppAlerts(v);
                      setAppAlertsEnabled(v);
                      toast(v ? 'Alerts on' : 'Alerts off');
                    }}
                    label="New-music alerts"
                  />
                </Row>
              )}
            </Section>
          )}

          <Section title="Wake-up alarm" id="alarm">
            <Row label="Wake alarm" note="Most reliable with the app open and your phone charging." keywords="plays music at the set time">
              <Toggle on={alarm.enabled} onChange={(v) => alarm.setEnabled(v)} label="Wake alarm" />
            </Row>
            {alarm.enabled && (
              <>
                <Row label="Time">
                  <input type="time" aria-label="Alarm time" value={alarm.time} onChange={(e) => alarm.setTime(e.target.value)} className="vx-set-input" />
                </Row>
                <Block label="Wake with">
                  <div className="flex gap-2 flex-wrap">
                    {(['favorites', 'resume'] as const).map((a) => (
                      <Chip key={a} active={alarm.action === a} onClick={() => alarm.setAction(a)}>
                        {a === 'favorites' ? 'Shuffle favorites' : 'Resume'}
                      </Chip>
                    ))}
                    {/* v5.17.0 — any of your playlists */}
                    {collections.map((c) => (
                      <Chip key={c.id} active={alarm.action === 'collection' && alarm.collectionId === c.id} onClick={() => { alarm.setAction('collection'); alarm.setCollectionId(c.id); }}>
                        {c.name}
                      </Chip>
                    ))}
                  </div>
                </Block>
                <Row label="Gentle wake" note="Starts quietly and rises to your volume over 30 seconds.">
                  <Toggle on={alarm.fadeIn} onChange={alarm.setFadeIn} label="Gentle wake" />
                </Row>
              </>
            )}
          </Section>

          <Section title="Region & privacy" id="privacy">
            <Row
              label="Share anonymous usage"
              note="City-level location, no account, and session insights with all on-screen text masked, to help improve VinaX. Off by default. Turning it off stops usage events at once and session insights after the next reload."
              keywords="analytics telemetry consent"
            >
              <Toggle
                on={usageSharing}
                label="Share anonymous usage"
                onChange={(v) => {
                  setLocal(KEYS.analyticsConsent, v);
                  setUsageSharing(v);
                  if (v) {
                    void import('@/services/analytics/telemetry').then((m) => m.registerUser());
                    void import('@/services/analytics/sessionInsights').then((m) => m.initSessionInsights());
                  }
                  toast(v ? 'Thank you — anonymous usage sharing is on' : 'Usage sharing is off');
                }}
              />
            </Row>
            <Row
              label="Allow region inference"
              note={`Coarse country only, from the network edge or your browser’s locale and time zone. Your IP is never stored. Now: ${region ? `${region.country ?? 'unknown'} (${region.source})` : 'unknown'}.`}
              keywords="location country ip"
            >
              <Toggle on={s.allowRegionInference} onChange={s.setAllowRegionInference} label="Allow region inference" />
            </Row>
            <Row label="Country override" keywords="location">
              <select
                aria-label="Country override"
                value={s.manualCountry ?? ''}
                onChange={(e) => s.setManualCountry(e.target.value || null)}
                className="vx-set-select"
              >
                <option value="">Auto-detect</option>
                {COUNTRIES.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </Row>
            <Row label="Region override" keywords="location state">
              <select
                aria-label="Region override"
                value={s.manualRegionLabel ?? ''}
                onChange={(e) => s.setManualRegionLabel(e.target.value || null)}
                className="vx-set-select"
              >
                <option value="">None</option>
                {REGIONS.map((r) => (
                  <option key={r.id} value={r.label}>{r.label}</option>
                ))}
              </select>
            </Row>
            <LinkRow to="/privacy" label="How privacy works" note="No accounts. Your taste lives on this device." keywords="private by design login servers" />
            <LinkRow to="/taste-profile" label="What VinaX knows about you" note="Your taste profile, in full." keywords="see taste profile" />
          </Section>

          <Section title="Your data" id="your-data">
            <UsernameRow />
            <LinkRow to="/handoff" label="Move to a new device" note="An encrypted, one-use QR. Parked for 10 minutes." keywords="handoff transfer qr" />
            <Row label="Backup Center" note="What a backup holds and leaves out; restore with a merge-or-replace preview and undo." keywords="restore merge">
              <RowButton onClick={() => setBackupOpen(true)}>Open</RowButton>
            </Row>
            {backupOpen && (
              <Suspense fallback={null}>
                <BackupCenter onClose={() => setBackupOpen(false)} />
              </Suspense>
            )}
            <Row
              label="Export a backup"
              note="A JSON file of your settings, library, history and taste profile. Never downloaded audio, device identity or caches."
              keywords="download json smart collections saved searches bookmarks home layout name username"
            >
              <RowButton onClick={() => { downloadProfileExport(); toast('Backup file downloaded'); }}>Export</RowButton>
            </Row>
            <Row label="Restore a backup (quick)" note="Replaces the same categories on this device. A damaged file changes nothing." keywords="import older exports migrated">
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/json"
                  className="hidden"
                  aria-label="Choose a VinaX backup file"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (!f) return;
                    const read = await readBackupFile(f);
                    if (!read.ok) {
                      toast(read.error, { duration: 7000 });
                      return;
                    }
                    const out = importProfileJson(read.text);
                    if (!out.ok) {
                      const detail = out.rejected?.[0] ? ` ${out.rejected[0].label}: ${out.rejected[0].error}` : '';
                      toast(`${out.error}${detail}`, { duration: 7000 });
                    }
                  }}
                />
                <RowButton onClick={() => fileRef.current?.click()}>Restore</RowButton>
              </>
            </Row>
            <Row label="Clear history"><RowButton tone="danger" onClick={clearHistoryWithUndo} label="Clear history">Clear</RowButton></Row>
            <Row label="Clear favorites"><RowButton tone="danger" onClick={clearFavoritesWithUndo} label="Clear favorites">Clear</RowButton></Row>
            <Row label="Clear queue"><RowButton tone="danger" onClick={clearQueue} label="Clear queue">Clear</RowButton></Row>
            <Row label="Clear cached metadata" note="Drops the in-memory cache; data refetches on demand." keywords="api cache">
              <RowButton tone="danger" onClick={clearCachedMetadata} label="Clear cached metadata">Clear</RowButton>
            </Row>
            <Row
              label="Reset taste profile"
              note="Erases what VinaX learned and the event log behind it. Offers a backup first. Favorites, playlists and history stay."
              keywords="languages artists habits dials less like this mutes"
            >
              <RowButton tone="danger" onClick={() => setResetOpen(true)} label="Reset taste profile">Reset</RowButton>
            </Row>
            {resetOpen && (
              <Suspense fallback={null}>
                <ResetTasteSheet onClose={() => setResetOpen(false)} showDataLink={false} />
              </Suspense>
            )}
            <Row label="Reset app state" note="Erases everything VinaX stores on this device and reloads." keywords="erase delete everything">
              <RowButton tone="danger-solid" onClick={() => setEraseOpen(true)}>Reset</RowButton>
            </Row>
          </Section>

          <Section title="Help & about" id="help">
            <LinkRow to="/help" label="Help & Feedback" note="Guides, answers, and a way to report a bug or share an idea." keywords="faq support how-to" />
            {!isNativePlatform() && (
              <LinkRow onClick={() => window.dispatchEvent(new Event('vinax:shortcuts'))} label="Keyboard shortcuts" note="Or press ? anywhere." keywords="space arrows keys" />
            )}
            <Row label="App version" note={isNativePlatform() ? 'Checks the website for a newer signed APK.' : 'Updates automatically on deploy.'} keywords="update">
              <div className="flex items-center gap-2">
                <span className="vx-set-value">{DISPLAY_VERSION}</span>
                {isNativePlatform() && (
                  <RowButton
                    onClick={() =>
                      void checkForUpdate({ manual: true }).then((u) => {
                        if (u) useUpdateStore.getState().setInfo(u);
                        else toast('You’re on the latest version');
                      })
                    }
                  >
                    Check for updates
                  </RowButton>
                )}
              </div>
            </Row>
          </Section>
        </div>
      </div>

      {/* C7 — the deletion receipt: exactly what "erase everything" removes,
          listed from the live KEYS registry so it can never drift stale. */}
      {eraseOpen && (
        <Sheet label="Erase everything" onClose={() => setEraseOpen(false)} closeOnBackdrop={false} layout="column" maxHeight="medium" backdropClassName="bg-black/70" className="vx-settings-erase">
          <h2 className="vx-sheet-title !pt-0">Erase everything?</h2>
          <p className="vx-sheet-sub mb-4 shrink-0">
            This deletes the following from this device only. VinaX has no servers holding a copy, so there is no undo.
          </p>
          <ul className="vx-erase-list" tabIndex={0} aria-label="What will be erased">
            {eraseItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <div className="vx-sheet-actions">
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(eraseItems.join('\n')).then(() => toast('List copied'));
              }}
              className="btn-secondary !flex-none px-4 text-sm"
            >
              Copy list
            </button>
            <button type="button" onClick={() => setEraseOpen(false)} className="btn-secondary text-sm">
              Keep my data
            </button>
            <button type="button" onClick={() => void resetAppState()} className="vx-erase-confirm">
              Erase all
            </button>
          </div>
        </Sheet>
      )}
    </SettingsSearchCtx.Provider>
  );
}
