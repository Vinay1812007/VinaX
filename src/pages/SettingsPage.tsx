import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSettingsStore } from '@/store/settingsStore';
import { useRegion } from '@/features/location/useRegion';
import {
  clearCachedMetadata,
  clearFavorites,
  clearHistory,
  clearPersonalization,
  clearQueue,
  downloadProfileExport,
  importProfileJson,
  resetAppState,
} from '@/features/settings/actions';
import { ACCENT_OPTIONS } from '@/constants/accents';
import { applyGlassLevel } from '@/utils/theme';
import { COUNTRIES, REGIONS } from '@/constants/regions';
import { KEYS } from '@/constants/storage-keys';
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
import { cn } from '@/utils/cn';
import { ClockIcon, DownloadIcon, HelpIcon, HomeIcon, SettingsIcon, ShieldIcon, SparkleIcon } from '@/components/Icons';
import { HOME_BLOCKS, HOME_BLOCK_KEYS, orderHomeBlocks } from '@/constants/homeBlocks';
import { moveHomeBlock, resetHomeLayout, toggleHomeBlock } from '@/features/settings/homeLayout';
import { useDismissOnBack } from '@/hooks/useDismissOnBack';
import { useFocusTrap } from '@/hooks/useFocusTrap';

function Row({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3.5 border-b border-[color:var(--glass-border)] last:border-0">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {note && <p className="text-xs text-ink-400 mt-0.5 max-w-md leading-relaxed">{note}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cn('w-11 h-6 rounded-full transition-colors relative', on ? 'bg-ember-500' : 'bg-ink-600')}
    >
      <span className={cn('absolute top-0.5 w-5 h-5 rounded-full bg-white transition-[color,background-color,border-color,opacity,transform]', on ? 'left-[22px]' : 'left-0.5')} />
    </button>
  );
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: ComponentType<{ className?: string }>;
  children: ReactNode;
}) {
  return (
    <section className="mb-6">
      <div className="flex items-center gap-2.5 px-1 mb-2.5">
        <span className="w-7 h-7 rounded-lg bg-ember-500/15 text-ember-500 flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4" />
        </span>
        <h2 className="text-xs font-bold uppercase tracking-[0.08em] text-ink-300">{title}</h2>
      </div>
      <div className="rounded-2xl glass-card px-5">{children}</div>
    </section>
  );
}


// C7 — human names for every KEYS entry the erase modal lists. Derived from
// the registry at render, so a new storage key can never silently go unlisted
// (unknown keys fall back to their raw name — visible, if inelegant).
const ERASE_LABELS: Record<string, string> = {
  schemaVersion: 'Storage schema version',
  settings: 'Settings & preferences',
  player: 'Player state & queue',
  library: 'Favorites, collections & hidden songs',
  history: 'Listening history',
  search: 'Recent searches',
  profile: 'Taste profile',
  profileKid: 'Kid-mode taste profile',
  region: 'Region preference',
  onboarded: 'Onboarding state',
  lastSeenVersion: 'What\u2019s-New read state',
  deviceId: 'Anonymous device id',
  userName: 'Your name',
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

export default function SettingsPage() {
  usePageTitle('Settings');
  const s = useSettingsStore();
  const region = useRegion();
  const fileRef = useRef<HTMLInputElement>(null);
  const [notifPerm, setNotifPerm] = useState<'granted' | 'denied' | 'unsupported' | 'unknown'>('unknown');
  const [eraseOpen, setEraseOpen] = useState(false); // C7 deletion receipt
  useDismissOnBack(eraseOpen, () => setEraseOpen(false));
  const eraseRef = useRef<HTMLDivElement>(null);
  useFocusTrap(eraseRef, eraseOpen, () => setEraseOpen(false));
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

  return (
    <div className="max-w-2xl mx-auto">
      <PageHeader title="Settings" subtitle="Manage your preferences — everything stays on this device." />
      {(pushSupported() || isNativePlatform()) && (
        <Section title="Notifications" icon={SparkleIcon}>
          {pushSupported() ? (
            <Row label="Push notifications" note="Get new song picks on this device. Turn off anytime.">
              <Toggle on={pushOn} onChange={(v) => void togglePush(v)} label="Push notifications" />
            </Row>
          ) : (
            <Row label="New-music alerts" note="When the app opens, new announcements appear as notifications.">
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
      <Section title="Help & Support" icon={HelpIcon}>
        <Row label="Help & Feedback" note="FAQs, how-tos, and report a bug or share an idea.">
          <Link to="/help" className="px-4 py-2 rounded-full btn-secondary text-sm">Open</Link>
        </Row>
      </Section>
      <Section title="Wake-up alarm" icon={ClockIcon}>
        <Row label="Wake alarm" note="Plays music at the set time. Most reliable with the app open and your phone charging.">
          <Toggle on={alarm.enabled} onChange={(v) => alarm.setEnabled(v)} label="Wake alarm" />
        </Row>
        {alarm.enabled && (
          <>
            <Row label="Time">
              <input type="time" value={alarm.time} onChange={(e) => alarm.setTime(e.target.value)} className="glass-input px-3 py-1.5 rounded-lg text-sm" />
            </Row>
            <Row label="Wake with">
              <div className="flex gap-1.5">
                {(['favorites', 'resume'] as const).map((a) => (
                  <Chip key={a} active={alarm.action === a} onClick={() => alarm.setAction(a)}>
                    {a === 'favorites' ? 'Shuffle favorites' : 'Resume'}
                  </Chip>
                ))}
              </div>
            </Row>
          </>
        )}
      </Section>

      <Section title="Appearance & Playback" icon={SettingsIcon}>
        <Row label="App language" note="Choose the app's display language.">
          <div className="flex flex-wrap gap-1.5">
            {UI_LANGS.map((l) => (
              <Chip key={l.id} active={s.uiLanguage === l.id} onClick={() => s.setUiLanguage(l.id)}>
                {l.label}
              </Chip>
            ))}
          </div>
        </Row>
        <Row label="Theme">
          <div className="flex gap-1.5">
            {(['dark', 'amoled', 'light', 'system'] as const).map((t) => (
              <Chip key={t} active={s.theme === t} onClick={() => s.setTheme(t)}>
                {t === 'dark' ? 'Dark' : t === 'light' ? 'Light' : t === 'amoled' ? 'Black' : 'System'}
              </Chip>
            ))}
          </div>
        </Row>
        <Row label="Accent color" note="The highlight color across buttons, links and the player. Every choice stays readable in light and dark.">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Accent color">
            {ACCENT_OPTIONS.map((a) => (
              <button
                key={a.id}
                role="radio"
                aria-checked={s.accent === a.id}
                aria-label={`${a.label} accent`}
                title={a.label}
                onClick={() => s.setAccent(a.id)}
                className={`w-8 h-8 rounded-full border-2 transition active:scale-95 ${
                  s.accent === a.id ? 'border-ink-100 scale-110 shadow-glow' : 'border-transparent opacity-80 hover:opacity-100'
                }`}
                style={{ backgroundColor: a.dot }}
              />
            ))}
          </div>
        </Row>
        <Row label="Glass effect" note="How see-through panels and bars feel — iOS-style frosted glass. Left is classic solid, right is deep glass.">
          <div className="flex items-center gap-3 w-full max-w-[260px]">
            <span className="text-[10px] font-bold tracking-widest text-ink-400 shrink-0">SOLID</span>
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
              className="flex-1 accent-ember-500"
            />
            <span className="text-[10px] font-bold tracking-widest text-ink-400 shrink-0">GLASS</span>
          </div>
        </Row>
        <Row label="Background blur" note="Independent from glass — dial from sharp glass to a soft, hazy backdrop.">
          <div className="flex items-center gap-3 w-full max-w-[260px]">
            <span className="text-[10px] font-bold tracking-widest text-ink-400 shrink-0">SHARP</span>
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
              className="flex-1 accent-ember-500"
            />
            <span className="text-[10px] font-bold tracking-widest text-ink-400 shrink-0">HAZY</span>
          </div>
        </Row>
        <Row label="Autoplay" note="Start playback immediately when you pick a song.">
          <Toggle on={s.autoplay} onChange={s.setAutoplay} label="Autoplay" />
        </Row>
        <Row label="Auto-queue similar" note="When the queue ends, keep the vibe going with similar tracks.">
          <Toggle on={s.autoqueueSimilar} onChange={s.setAutoqueueSimilar} label="Auto-queue similar" />
        </Row>
        <Row label="Keep screen on in player" note="Holds a screen wake lock while the full-screen player is open and playing.">
          <Toggle on={s.keepScreenOn} onChange={s.setKeepScreenOn} label="Keep screen on in player" />
        </Row>
        {isNativePlatform() && (
          <Row label="Lock screen lyrics" note="Show the current synced line on your lock screen and media controls as a song plays.">
            <Toggle on={s.lockScreenLyrics} onChange={(v) => { s.setLockScreenLyrics(v); if (v) void ensureNotificationPermission().then(() => getNotificationPermission().then(setNotifPerm)); }} label="Lock screen lyrics" />
          </Row>
        )}
        {notifPerm === 'denied' && (
          <div className="mx-1 mb-3 p-3 rounded-xl bg-ember-500/10 border border-ember-500/30 text-xs text-ink-200 flex items-center justify-between gap-3">
            <span>Notifications are off — lock-screen lyrics and playback controls need them to appear.</span>
            <button
              onClick={() => void ensureNotificationPermission().then(() => getNotificationPermission().then(setNotifPerm))}
              className="shrink-0 px-3 py-1.5 rounded-full btn-primary"
            >
              Enable
            </button>
          </div>
        )}
        <Row label="Crossfade" note="Smoothly fade between tracks and fade new songs in.">
          <Toggle on={s.crossfade} onChange={s.setCrossfade} label="Crossfade" />
        </Row>
        {s.crossfade && (
          <Row label="Crossfade length">
            <div className="flex gap-1.5">
              {[3, 5, 8, 12].map((n) => (
                <Chip key={n} active={s.crossfadeSeconds === n} onClick={() => s.setCrossfadeSeconds(n)}>
                  {n}s
                </Chip>
              ))}
            </div>
          </Row>
        )}
        <Row label="Resume playback" note="Pick up longer tracks where you left off.">
          <Toggle on={s.resumePlayback} onChange={s.setResumePlayback} label="Resume playback" />
        </Row>
        {isNativePlatform() && (
          <Row label="Haptics" note="Subtle vibration on key actions in the app.">
            <Toggle on={s.haptics} onChange={s.setHaptics} label="Haptics" />
          </Row>
        )}
        <Row label="Dynamic theme" note="Extract accent color from current track artwork (experimental).">
          <Toggle on={s.dynamicTheme} onChange={s.setDynamicTheme} label="Dynamic theme" />
        </Row>
        <Row label="Reduce motion" note="Minimise animations and transitions across the app (better for motion sensitivity and older phones).">
          <Toggle on={s.reduceMotion} onChange={(v) => { s.setReduceMotion(v); document.documentElement.classList.toggle('reduce-motion', v); }} label="Reduce motion" />
        </Row>
        <Row label="Density" note="Comfortable spacing or compact for more on screen.">
          <div className="flex gap-1.5">
            {(['comfortable', 'compact'] as const).map((d) => (
              <Chip key={d} active={s.density === d} onClick={() => s.setDensity(d)}>
                {d === 'comfortable' ? 'Comfortable' : 'Compact'}
              </Chip>
            ))}
          </div>
        </Row>
        <Row label="App version" note={isNativePlatform() ? 'Checks the website for a newer signed APK.' : 'Web version updates automatically on deploy.'}>
          <div className="flex items-center gap-2">
            <span className="text-sm text-ink-300">{DISPLAY_VERSION}</span>
            {isNativePlatform() && (
              <button
                onClick={() =>
                  void checkForUpdate().then((u) => {
                    if (u) useUpdateStore.getState().setInfo(u);
                    else toast('You’re on the latest version');
                  })
                }
                className="px-4 py-2 rounded-full glass-button text-sm"
              >
                Check for updates
              </button>
            )}
          </div>
        </Row>
        {!isNativePlatform() && (
          <Row label="Keyboard shortcuts" note="Space, arrows, N/P, M, S, R, F — or press ? anywhere.">
            <button
              onClick={() => window.dispatchEvent(new Event('vinax:shortcuts'))}
              className="px-4 py-2 rounded-full glass-button text-sm"
            >
              View
            </button>
          </Row>
        )}
        <Row label="Audio quality" note="Picks the closest available stream; falls back automatically.">
          <div className="flex gap-1.5">
            {(['low', 'medium', 'high'] as AudioQualityPref[]).map((q) => (
              <Chip key={q} active={s.audioQuality === q} onClick={() => s.setAudioQuality(q)}>
                {q}
              </Chip>
            ))}
          </div>
        </Row>
        <Row label="Lyrics size" note="Text size for synced lyrics in the player, karaoke, and lyrics page.">
          <div className="flex gap-1.5">
            {(['sm', 'md', 'lg', 'xl'] as const).map((z) => (
              <Chip key={z} active={s.lyricsSize === z} onClick={() => s.setLyricsSize(z)}>
                {z === 'sm' ? 'Small' : z === 'md' ? 'Medium' : z === 'lg' ? 'Large' : 'Huge'}
              </Chip>
            ))}
          </div>
        </Row>
      </Section>

      <Section title="Recommendations" icon={SparkleIcon}>
        <Row label="Intensity" note="Low = mostly popular/trending. High = strongly personalized.">
          <div className="flex items-center gap-2">
            <input
              type="range"
              aria-label="Recommendation intensity"
              min={0}
              max={1}
              step={0.1}
              value={s.recommendationIntensity}
              onChange={(e) => s.setRecommendationIntensity(Number(e.target.value))}
              className="w-32"
              style={{ '--fill': `${s.recommendationIntensity * 100}%` } as React.CSSProperties}
            />
            <span className="text-xs text-ink-400 w-8 tabular-nums">{Math.round(s.recommendationIntensity * 100)}%</span>
          </div>
        </Row>
        <Row label="Explore mode" note="Reserve a corner of your shelves for songs deliberately unlike your usual — trending picks from languages you haven’t tried.">
          <Toggle on={s.exploreMode} onChange={s.setExploreMode} label="Explore mode" />
        </Row>
        <Row label="Kid mode" note="Hides songs the catalog marks explicit — everywhere — and keeps a separate taste profile so a child’s listening never shapes yours. Favorites and downloads stay shared. Only as good as the catalog’s explicit flags.">
          <Toggle
            on={s.kidMode}
            onChange={(v) => {
              s.setKidMode(v);
              toast(v ? 'Kid mode on — explicit songs hidden, separate taste profile active' : 'Kid mode off — back to your own taste profile');
            }}
            label="Kid mode"
          />
        </Row>
        <div className="py-3.5 border-b border-[color:var(--glass-border)]">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <p className="text-sm font-medium">Preferred languages</p>
              <p className="text-xs text-ink-400 mt-0.5">Pinned languages get boosted everywhere.</p>
            </div>
            <button
              onClick={() => {
                const allPinned = s.pinnedLanguages.length === LANGUAGES.length;
                s.setPinnedLanguages(allPinned ? [] : LANGUAGES.map((l) => l.id));
                if (!allPinned) s.setMutedLanguages([]);
              }}
              className="shrink-0 px-3 py-1.5 rounded-full glass-button text-xs font-semibold"
            >
              {s.pinnedLanguages.length === LANGUAGES.length ? 'Clear all' : 'All languages'}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {LANGUAGES.map((l) => (
              <Chip key={l.id} active={s.pinnedLanguages.includes(l.id)} onClick={() => s.togglePinnedLanguage(l.id)}>
                {l.label}
              </Chip>
            ))}
          </div>
        </div>
        <div className="py-3.5">
          <p className="text-sm font-medium">Muted languages</p>
          <p className="text-xs text-ink-400 mt-0.5 mb-3">Never recommended anywhere.</p>
          <div className="flex flex-wrap gap-2">
            {LANGUAGES.map((l) => (
              <Chip key={l.id} active={s.mutedLanguages.includes(l.id)} tone="danger" onClick={() => s.toggleMutedLanguage(l.id)}>
                {l.label}
              </Chip>
            ))}
          </div>
        </div>
      </Section>

      {/* Home builder (4.16.0) — hide or reorder the big Home blocks. */}
      <Section title="Home layout" icon={HomeIcon}>
        <div className="flex items-start justify-between gap-3 py-3.5 border-b border-[color:var(--glass-border)]">
          <p className="text-xs text-ink-400 leading-relaxed">
            Build your own Home: switch blocks off or move them up and down. The greeting, Aura Mix and
            language rail always stay on top. Applies on this device only.
          </p>
          <button
            onClick={() => {
              resetHomeLayout();
              toast('Home layout reset to default');
            }}
            className="shrink-0 px-3 py-1.5 rounded-full glass-button text-xs font-semibold"
          >
            Reset layout
          </button>
        </div>
        {orderHomeBlocks(s.homeOrder).map((key, i, arr) => {
          const def = HOME_BLOCKS.find((b) => b.key === key);
          if (!def) return null;
          const on = !s.hiddenHome.includes(key);
          return (
            <div key={key} className="flex items-center gap-2 py-2.5 border-b border-[color:var(--glass-border)] last:border-0">
              <div className="flex flex-col gap-0.5">
                <button
                  aria-label={`Move ${def.label} up`}
                  disabled={i === 0}
                  onClick={() => moveHomeBlock(key, -1, HOME_BLOCK_KEYS)}
                  className="w-7 h-6 rounded-md glass-button text-[11px] leading-none disabled:opacity-30"
                >
                  ▲
                </button>
                <button
                  aria-label={`Move ${def.label} down`}
                  disabled={i === arr.length - 1}
                  onClick={() => moveHomeBlock(key, 1, HOME_BLOCK_KEYS)}
                  className="w-7 h-6 rounded-md glass-button text-[11px] leading-none disabled:opacity-30"
                >
                  ▼
                </button>
              </div>
              <div className="min-w-0 flex-1">
                <p className={cn('text-sm font-medium truncate', !on && 'text-ink-400 line-through')}>{def.label}</p>
                <p className="text-xs text-ink-400 truncate">{def.hint}</p>
              </div>
              <Toggle on={on} onChange={() => toggleHomeBlock(key)} label={`Show ${def.label}`} />
            </div>
          );
        })}
      </Section>

      <div className="mb-6 rounded-2xl p-5 glass-card relative overflow-hidden">
        <div
          aria-hidden
          className="absolute -inset-px pointer-events-none bg-[radial-gradient(60%_100%_at_0%_0%,rgb(var(--aura-violet)/0.12),transparent_70%)]"
        />
        <div className="relative flex items-start gap-4">
          <div className="w-11 h-11 rounded-2xl bg-ember-500/15 text-ember-400 flex items-center justify-center shrink-0">
            <ShieldIcon className="w-6 h-6" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-bold">Private by design</h2>
            <p className="text-sm text-ink-300 mt-1 leading-relaxed">
              No login. No profile servers. Your taste — favorites, history, recommendations — lives on this
              device, stays yours to export, and can be erased any time.
            </p>
            <p className="text-xs text-ink-400 mt-2.5">
              <Link to="/privacy" className="text-ember-400 hover:underline">How privacy works</Link>
              {' · '}
              <Link to="/taste-profile" className="text-ember-400 hover:underline">See what VinaX knows about you</Link>
            </p>
          </div>
        </div>
      </div>

      <Section title="Region & Privacy" icon={ShieldIcon}>
        <Row
          label="Allow region inference"
          note={`Coarse country only — from Cloudflare's edge country header or your browser locale/timezone. Your IP is never stored. Current: ${region ? `${region.country ?? 'unknown'} (${region.source})` : 'unknown'}.`}
        >
          <Toggle on={s.allowRegionInference} onChange={s.setAllowRegionInference} label="Allow region inference" />
        </Row>
        <Row label="Country override">
          <select
            aria-label="Country override"
            value={s.manualCountry ?? ''}
            onChange={(e) => s.setManualCountry(e.target.value || null)}
            className="glass-input rounded-xl px-3 py-2 text-sm"
          >
            <option value="">Auto-detect</option>
            {COUNTRIES.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </Row>
        <Row label="Region override">
          <select
            aria-label="Region override"
            value={s.manualRegionLabel ?? ''}
            onChange={(e) => s.setManualRegionLabel(e.target.value || null)}
            className="glass-input rounded-xl px-3 py-2 text-sm"
          >
            <option value="">None</option>
            {REGIONS.map((r) => (
              <option key={r.id} value={r.label}>{r.label}</option>
            ))}
          </select>
        </Row>
      </Section>

      <Section title="Your Data" icon={DownloadIcon}>
        <Row label="Move to a new device" note="Encrypted QR handoff — scan on the new phone and everything comes across. Parked 10 minutes, burned after one use.">
          <Link to="/handoff" className="px-4 py-2 rounded-full glass-button text-sm inline-block">Start</Link>
        </Row>
        <Row label="Export profile & settings" note="Portable JSON of all local data — favorites, history, profile, preferences.">
          <button onClick={downloadProfileExport} className="px-4 py-2 rounded-full glass-button text-sm">Export</button>
        </Row>
        <Row label="Import profile & settings">
          <>
            <input
              ref={fileRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) {
                  const ok = importProfileJson(await f.text());
                  if (!ok) toast('Invalid import file — not a VinaX export.');
                }
              }}
            />
            <button onClick={() => fileRef.current?.click()} className="px-4 py-2 rounded-full glass-button text-sm">Import</button>
          </>
        </Row>
        <Row label="Clear history"><button onClick={clearHistory} className="px-4 py-2 rounded-full border border-ink-600 text-sm hover:border-red-400 hover:text-red-300">Clear</button></Row>
        <Row label="Clear favorites"><button onClick={clearFavorites} className="px-4 py-2 rounded-full border border-ink-600 text-sm hover:border-red-400 hover:text-red-300">Clear</button></Row>
        <Row label="Clear queue"><button onClick={clearQueue} className="px-4 py-2 rounded-full border border-ink-600 text-sm hover:border-red-400 hover:text-red-300">Clear</button></Row>
        <Row label="Clear cached metadata" note="Drops the in-memory API cache; data refetches on demand.">
          <button onClick={clearCachedMetadata} className="px-4 py-2 rounded-full border border-ink-600 text-sm hover:border-red-400 hover:text-red-300">Clear</button>
        </Row>
        <Row label="Clear personalization profile" note="Erases taste profile + event log. Favorites stay.">
          <button onClick={() => void clearPersonalization()} className="px-4 py-2 rounded-full border border-ink-600 text-sm hover:border-red-400 hover:text-red-300">Clear</button>
        </Row>
        <Row label="Reset app state" note="Erases everything VinaX stores on this device and reloads.">
          <button
            onClick={() => setEraseOpen(true)}
            className="px-4 py-2 rounded-full bg-red-500/15 border border-red-500/50 text-red-300 text-sm font-semibold hover:bg-red-500/25"
          >
            Reset
          </button>
        </Row>
        {/* C7 — the deletion receipt: exactly what "erase everything" removes,
            listed from the live KEYS registry so it can never drift stale. */}
        {eraseOpen && (
          <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-ink-950/80 backdrop-blur-sm p-0 sm:p-6" role="dialog" aria-modal="true" aria-label="Erase everything">
            <div ref={eraseRef} className="w-full sm:max-w-md glass-modal rounded-t-3xl sm:rounded-3xl p-6 max-h-[85vh] overflow-y-auto">
              <h2 className="text-xl font-bold mb-1">Erase everything?</h2>
              <p className="text-xs text-ink-400 mb-4">
                This deletes the following from THIS device only — VinaX has no servers holding a copy, so there is no undo.
              </p>
              <ul className="space-y-1 mb-4 text-[13px] text-ink-200">
                {eraseItems.map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <span aria-hidden className="text-red-300 mt-0.5">✕</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2.5">
                <button
                  onClick={() => {
                    void navigator.clipboard?.writeText(eraseItems.join('\n')).then(() => toast('List copied'));
                  }}
                  className="px-4 py-2.5 rounded-full border border-ink-600 text-sm text-ink-200"
                >
                  Copy list
                </button>
                <button onClick={() => setEraseOpen(false)} className="flex-1 px-4 py-2.5 rounded-full border border-ink-600 text-sm font-semibold text-ink-200">
                  Keep my data
                </button>
                <button
                  onClick={() => void resetAppState()}
                  className="px-4 py-2.5 rounded-full bg-red-500/20 border border-red-500/50 text-red-300 text-sm font-bold hover:bg-red-500/30"
                >
                  Erase all
                </button>
              </div>
            </div>
          </div>
        )}
      </Section>

      <p className="text-xs text-ink-400 leading-relaxed mb-8 px-1">
        Privacy: VinaX has no accounts and no user backend. Favorites, history, queue, settings, and
        your taste profile exist only in this browser/app. Region awareness uses, at most, a coarse
        country code from Cloudflare’s edge or your browser locale — raw IP addresses are never read
        by the app and never stored. Your taste profile stays on your device.
      </p>
    </div>
  );
}
