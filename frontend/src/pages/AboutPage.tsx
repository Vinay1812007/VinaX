import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import { DISPLAY_VERSION } from '@/constants/version';
import { canInstall, onInstallAvailable, promptInstall } from '@/utils/installPrompt';
import { shareLink } from '@/utils/share';
import { toast } from '@/store/toastStore';
import { ChevronRightIcon } from '@/components/Icons';
import '@/styles/pages/secondary.css';

const LINKS: Array<{ to: string; label: string }> = [
  { to: '/help', label: 'Help and feedback' },
  { to: '/privacy', label: 'Privacy' },
  { to: '/terms', label: 'Terms of use' },
  { to: '/dmca', label: 'Copyright and takedowns' },
  { to: '/contact', label: 'Contact' },
];

export default function AboutPage() {
  usePageTitle('About');
  const [installable, setInstallable] = useState(canInstall());
  useEffect(() => onInstallAvailable(() => setInstallable(true)), []);
  return (
    <div className="vx-sec">
      <header className="flex flex-wrap items-center gap-4 sm:gap-5 mb-8">
        <img src="/icons/icon.svg" alt="" className="w-[72px] h-[72px] rounded-2xl shadow-[var(--vx-art-shadow)]" />
        <div className="min-w-0 flex-1">
          <h1 className="vx-page-title">VinaX</h1>
          <p className="mt-1 text-[13px] font-medium text-ink-400 tabular-nums">{DISPLAY_VERSION}</p>
        </div>
        <div className="flex flex-wrap gap-2 w-full sm:w-auto">
          {installable && (
            <button
              onClick={() => void promptInstall().then((ok) => ok && setInstallable(false))}
              className="px-5 py-2.5 rounded-full btn-primary text-sm"
            >
              Install app
            </button>
          )}
          <button
            onClick={() => void shareLink('/', 'VinaX — music tuned to you').then((r) => r === 'copied' && toast('Link copied'))}
            className="px-5 py-2.5 rounded-full btn-secondary text-sm"
          >
            Share app
          </button>
        </div>
      </header>

      <div className="vx-sec-block space-y-4 text-[15px] leading-[1.65] text-ink-200 max-w-[68ch]">
        <p>
          VinaX is free music with no login and no account. It plays across 12 Indian languages and English, and
          learns what you love right here on your device.
        </p>
        <p>
          No paywalls and no premium tiers. Personalization is computed on your device, nothing you type is stored on
          our servers, and your IP address is never kept. The only data we receive is optional, anonymous usage you
          can switch off — see what VinaX knows on your{' '}
          <Link to="/taste-profile" className="vx-link">taste profile</Link>.
        </p>
        <p>
          Inside: VinaX AI with Think, Research and voice chat, synced karaoke lyrics, Listen Together rooms, offline
          downloads in the Android app, Drive mode, weekly mixes and a Ctrl+K command palette. Music streams from
          independent public catalogs with automatic failover.
        </p>
      </div>

      <nav aria-label="About VinaX" className="vx-group">
        {LINKS.map((l) => (
          <Link key={l.to} to={l.to} className="vx-row is-link">
            <span className="vx-row-main vx-row-label">{l.label}</span>
            <ChevronRightIcon className="vx-row-chev" />
          </Link>
        ))}
      </nav>
    </div>
  );
}
