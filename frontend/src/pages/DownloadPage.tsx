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
        <img src="/icons/icon.svg" alt="" width={112} height={112} className="w-28 h-28 rounded-[var(--vx-radius-panel)] shadow-[var(--vx-art-shadow)]" />
        <h1 className="vx-page-title mt-7">VinaX for Android</h1>
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

      <ul className="vx-group mt-12" aria-label="What the app adds">
        {FEATURES.map((f) => (
          <li key={f} className="vx-row">
            <span className="grid place-items-center w-8 h-8 shrink-0 rounded-full bg-[var(--vx-accent-wash)] text-ember-400" aria-hidden>
              <CheckIcon className="w-4 h-4" />
            </span>
            <span className="vx-row-main text-[15px] text-ink-200">{f}</span>
          </li>
        ))}
      </ul>

      {!isNativePlatform() && (
        <p className="vx-sec-foot">
          Always the newest signed build. Your phone may warn about apps installed from outside the official app store —
          the APK is signed with VinaX’s release key on every build.
        </p>
      )}

      <p className="mt-10 text-center text-[14px] text-ink-400">
        Prefer the web? <Link to="/" className="vx-link">Keep listening in the browser</Link>
      </p>
    </div>
  );
}
