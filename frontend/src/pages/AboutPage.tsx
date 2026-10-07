import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import { DISPLAY_VERSION } from '@/constants/version';
import { canInstall, onInstallAvailable, promptInstall } from '@/utils/installPrompt';
import { shareLink } from '@/utils/share';
import { toast } from '@/store/toastStore';
import { ChevronRightIcon } from '@/components/Icons';
import '@/styles/pages/secondary.css';

const LINKS: Array<{ to: string; label: string; hint: string }> = [
  { to: '/help', label: 'Help and feedback', hint: 'Guides, answers and a way to reach the team' },
  { to: '/privacy', label: 'Privacy', hint: 'What stays on your device, and what you can opt in to' },
  { to: '/terms', label: 'Terms of use', hint: 'Plain-language terms' },
  { to: '/dmca', label: 'Copyright and takedowns', hint: 'For artists, labels and rights holders' },
  { to: '/contact', label: 'Contact', hint: 'One email address for everything' },
];

export default function AboutPage() {
  usePageTitle('About');
  const [installable, setInstallable] = useState(canInstall());
  useEffect(() => onInstallAvailable(() => setInstallable(true)), []);
  return (
    <div className="vx-sec">
      <header className="vx-hero-row vx-sec-block">
        <img src="/icons/icon.svg" alt="" width={96} height={96} className="w-24 h-24 shrink-0 rounded-[var(--vx-radius-panel)] shadow-[var(--vx-art-shadow)]" />
        <div>
          <h1 className="vx-display">VinaX</h1>
          <p className="mt-2 text-[14px] font-semibold text-ink-400 tabular-nums">{DISPLAY_VERSION}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {installable && (
              <button
                type="button"
                onClick={() => void promptInstall().then((ok) => ok && setInstallable(false))}
                className="px-5 rounded-full btn-primary text-sm"
              >
                Install app
              </button>
            )}
            <button
              type="button"
              onClick={() => void shareLink('/', 'VinaX — music tuned to you').then((r) => r === 'copied' && toast('Link copied'))}
              className="px-5 rounded-full btn-secondary text-sm"
            >
              Share app
            </button>
          </div>
        </div>
      </header>

      <div className="vx-sec-block vx-doc">
        <p>
          VinaX is free music with no login and no account. It plays music in Indian languages and English, and
          learns what you like on your device.
        </p>
        <p>
          There are no paywalls and no premium tiers. Your favourites, playlists, history and taste profile live on
          your device. Searches and song requests go to the catalogue so music can play, and VinaX AI receives what
          you ask it. Anonymous usage statistics are sent only if you opt in. See what VinaX has learned on
          your <Link to="/taste-profile">taste profile</Link>; the Privacy page below lists what leaves your device.
        </p>
        <p>
          Inside: six app styles that change the whole look, festival themes, VinaX AI with Think and voice chat,
          synced lyrics, Listen Together, offline downloads in the Android app, Drive mode, weekly mixes and a
          Ctrl+K command palette. Music streams from independent public catalogues, and VinaX tries another source
          when one is unavailable.
        </p>
      </div>

      <nav aria-label="About VinaX" className="vx-group">
        {LINKS.map((l) => (
          <Link key={l.to} to={l.to} className="vx-row is-link">
            <span className="vx-row-main">
              <span className="vx-row-label">{l.label}</span>
              <span className="vx-row-hint">{l.hint}</span>
            </span>
            <ChevronRightIcon className="vx-row-chev" />
          </Link>
        ))}
      </nav>
    </div>
  );
}
