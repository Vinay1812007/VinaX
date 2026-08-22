import { useEffect, useState } from 'react';
import { usePageTitle } from '@/hooks/usePageTitle';
import { DISPLAY_VERSION } from '@/constants/version';
import { canInstall, onInstallAvailable, promptInstall } from '@/utils/installPrompt';
import { shareLink } from '@/utils/share';
import { toast } from '@/store/toastStore';

export default function AboutPage() {
  usePageTitle('About');
  const [installable, setInstallable] = useState(canInstall());
  useEffect(() => onInstallAvailable(() => setInstallable(true)), []);
  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <img src="/icons/icon.svg" alt="" className="w-16 h-16 rounded-2xl" />
        <div>
          <h1 className="text-3xl font-bold tracking-tight">VinaX</h1>
          <p className="text-sm text-ink-400">Music tuned to you · {DISPLAY_VERSION}</p>
        </div>
        <button
          onClick={() => void shareLink('/', 'VinaX — music tuned to you').then((r) => r === 'copied' && toast('Link copied'))}
          className="ml-auto px-5 py-2.5 rounded-full btn-secondary text-sm"
        >
          Share app
        </button>
        {installable && (
          <button
            onClick={() => void promptInstall().then((ok) => ok && setInstallable(false))}
            className="px-5 py-2.5 rounded-full btn-primary"
          >
            Install app
          </button>
        )}
      </div>

      <div className="space-y-5 text-sm text-ink-200 leading-relaxed">
        <p>
          <em>VinaX</em> is music tuned to you — free forever, with no login and no account. It plays
          across 12 Indian languages and English, learns what you love right here on your device, and
          hands you a home screen, an AI DJ and a smart search that all feel personal from the very
          first song.
        </p>
        <p>
          The vision is simple: <strong>great music for India, open to everyone.</strong> No paywalls, no
          premium tiers — just press play. A few ads on the website keep the lights on (the app itself is
          ad-free), and it stays that way without trading your privacy:
          personalization is computed on your device, nothing you type is stored on our servers, and
          your IP address is never kept. The only data we ever receive is optional, anonymous usage that
          you can switch off — everything you can see on your <a href="/taste-profile" className="text-ember-400">Taste Profile</a> page
          stays with you.
        </p>
        <p>
          There is a lot packed in: VinaX AI with seven engines plus Think, Research and hands-free
          voice chat; synced karaoke lyrics; Listen Together rooms; offline downloads in the Android app;
          a full-screen player with Radio and Drive mode; weekly mixes; and a Ctrl+K command palette for
          power users. The design is original throughout, and music streams from independent public
          catalogs with automatic failover, so one hiccup never takes the app down.
        </p>

        <p className="text-xs text-ink-400 pt-2">
          <a href="/privacy" className="text-ember-400">Privacy</a> · <a href="/terms" className="text-ember-400">Terms</a> · <a href="/contact" className="text-ember-400">Contact</a> · <a href="/dmca" className="text-ember-400">Copyright</a>
        </p>
      </div>
    </div>
  );
}
