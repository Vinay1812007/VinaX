import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CheckIcon, DownloadIcon, GlobeIcon, MicIcon, PlayIcon, SparkleIcon, UsersIcon } from '@/components/Icons';
import { RadioGlyph } from '@/features/radio/RadioGlyph';
import { HUB_LANGUAGES } from '@/constants/languages';
import { greetingName } from '@/utils/greetingName';

/** The welcome's backdrop: language names in their own scripts (decorative). */
const SCRIPTS = ['తెలుగు', 'हिन्दी', 'தமிழ்', 'ਪੰਜਾਬੀ', 'ಕನ್ನಡ', 'മലയാളം', 'বাংলা', 'मराठी', 'ગુજરાતી', 'اردو', 'English', 'भोजपुरी'];

/** How many languages have their own page, in words a listener reads at a glance. */
const LANGUAGE_COUNT = HUB_LANGUAGES.length;

/**
 * 10.0.0 — the first visit: before anything has been played on this device,
 * Home opens with the promise in plain words (free, no sign-up, no account,
 * Indian languages) and one obvious action, Start listening, which plays the
 * opening mix the page already holds. No data of its own: nothing here asks
 * the catalogue, so the first-paint request budget is unchanged.
 *
 * Returning listeners never see it; they get the short greeting instead.
 * A listener who gave a name in the welcome sheet is greeted by it, inside the
 * page heading (first name only — utils/greetingName).
 */
export function HomeWelcome({ name, onStart, ready }: { name?: string; onStart: () => void; ready: boolean }) {
  const first = greetingName(name);
  return (
    <section className="vxh-welcome" aria-labelledby="vxh-welcome-title">
      <div className="vxh-welcome-scripts" aria-hidden>
        {[0, 1].map((row) => (
          <p key={row}>{SCRIPTS.slice(row * 6, row * 6 + 6).map((w) => <span key={w}>{w}</span>)}</p>
        ))}
      </div>
      <p className="vxh-welcome-kicker"><span className="vxh-welcome-badge">Free forever</span> No sign-up. No account.</p>
      <h1 id="vxh-welcome-title" className="vxh-welcome-title">
        {first && <span className="vxh-welcome-hello">Welcome, {first}. </span>}
        All the music you love. <span className="vxh-welcome-free">Free.</span>
      </h1>
      <p className="vxh-welcome-sub">
        Hindi, Telugu, Tamil, Punjabi and {LANGUAGE_COUNT - 4} more languages. No subscription, no email, no password: just press play.
      </p>
      <div className="vxh-welcome-actions">
        <button type="button" className="vxh-cta" onClick={onStart} aria-busy={!ready || undefined}>
          <PlayIcon /> Start listening
        </button>
        <Link to="/languages" className="vxh-cta is-quiet">Pick your languages</Link>
      </div>
      <ul className="vxh-welcome-promise" aria-label="What you get">
        <li><CheckIcon /> No ads in the player</li>
        <li><CheckIcon /> {LANGUAGE_COUNT} languages</li>
        <li><CheckIcon /> Your taste stays on this device</li>
      </ul>
    </section>
  );
}

interface Feature {
  to: string;
  title: string;
  line: string;
  icon: ReactNode;
  tone: 'ember' | 'tide';
}

const FEATURES: Feature[] = [
  { to: '/VinaXAI', title: 'VinaX AI', line: 'Describe a mood, get a playlist', icon: <SparkleIcon />, tone: 'tide' },
  { to: '/radio', title: 'AI Radio', line: 'Endless music from one song', icon: <RadioGlyph />, tone: 'tide' },
  { to: '/together', title: 'Listen Together', line: 'One queue, shared with friends', icon: <UsersIcon />, tone: 'ember' },
  { to: '/karaoke', title: 'Synced lyrics', line: 'Sing along, line by line', icon: <MicIcon />, tone: 'ember' },
  { to: '/download', title: 'Offline on Android', line: 'Download songs, play without data', icon: <DownloadIcon />, tone: 'ember' },
  { to: '/languages', title: `${LANGUAGE_COUNT} languages`, line: 'Each with its own charts and guide', icon: <GlobeIcon />, tone: 'ember' },
];

/** 10.0.0 — what comes with VinaX, every part of it free: one tile per real destination. */
export function HomeFeatures() {
  return (
    <section className="vxh-features" aria-labelledby="vxh-features-title">
      <div className="vxh-head">
        <h2 id="vxh-features-title">Everything included, all free</h2>
      </div>
      <ul className="vxh-feature-grid">
        {FEATURES.map((f) => (
          <li key={f.to}>
            <Link to={f.to} className={`vxh-feature is-${f.tone}`}>
              <span className="vxh-feature-icon" aria-hidden>{f.icon}</span>
              <span className="vxh-feature-text">
                <span className="vxh-feature-title">{f.title}</span>
                <span className="vxh-feature-line">{f.line}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
