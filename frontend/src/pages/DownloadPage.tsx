import { usePageTitle } from '@/hooks/usePageTitle';
import { Link } from 'react-router-dom';
import { isNativePlatform } from '@/services/native';
import { CheckIcon, DownloadIcon } from '@/components/Icons';
import '@/styles/pages/secondary.css';

const FEATURES = [
  'Playback notification with controls, headset and car buttons',
  'No login — your taste profile lives on your device',
  'Synced lyrics, charts and mixes in your languages',
  'Automatic updates — new features arrive without reinstalling',
];

export default function DownloadPage() {
  usePageTitle('Download');
  return (
    <div className="vx-sec is-narrow">
      <div className="flex flex-col items-center text-center pt-4 sm:pt-8">
        <img src="/icons/icon.svg" alt="" className="w-24 h-24 rounded-[22px] shadow-[var(--vx-art-shadow)]" />
        <h1 className="vx-page-title mt-6">VinaX for Android</h1>
        <p className="mt-2 text-[15px] text-ink-400">Free, no account, private by design.</p>

        {isNativePlatform() ? (
          <p className="mt-8 text-[15px] font-semibold text-ink-100">You’re already on the app.</p>
        ) : (
          <a href="/apk" className="mt-8 inline-flex items-center justify-center gap-2 w-full sm:w-auto !min-h-[52px] px-8 rounded-full btn-primary text-base">
            <DownloadIcon className="w-5 h-5" />
            Download APK
          </a>
        )}
      </div>

      <ul className="vx-group mt-10" aria-label="What the app adds">
        {FEATURES.map((f) => (
          <li key={f} className="vx-row">
            <CheckIcon className="w-5 h-5 shrink-0 text-ink-300" />
            <span className="vx-row-main text-[15px] text-ink-200">{f}</span>
          </li>
        ))}
      </ul>

      {!isNativePlatform() && (
        <p className="vx-sec-foot px-1">
          Always the newest signed build. Your phone may warn about apps installed from outside the official app store —
          the APK is signed with VinaX’s release key on every build.
        </p>
      )}

      <p className="mt-8 text-center text-sm text-ink-400">
        Prefer the web? <Link to="/" className="vx-link">Keep listening in the browser</Link>
      </p>
    </div>
  );
}
