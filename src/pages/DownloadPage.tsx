import { usePageTitle } from '@/hooks/usePageTitle';
import { Link } from 'react-router-dom';
import { isNativePlatform } from '@/services/native';

const FEATURES = [
  'Playback notification with controls + Bluetooth/headset support',
  'No login — your taste profile lives on your device',
  'Synced lyrics, endless charts, smart mixes in your languages',
  'Automatic updates — new features arrive without reinstalling',
];

export default function DownloadPage() {
  usePageTitle('Download');
  return (
    <div className="max-w-md mx-auto text-center pt-6">
      <img src="/icons/icon.svg" alt="" className="w-24 h-24 rounded-3xl mx-auto shadow-2xl" />
      <h1 className="text-3xl font-bold tracking-tight mt-5">
        VinaX<span className="text-ember-500">.</span> for Android
      </h1>
      <p className="text-sm text-ink-300 mt-2">Music tuned to you — free, no account, private by design.</p>

      <ul className="text-left mt-6 space-y-2.5">
        {FEATURES.map((f) => (
          <li key={f} className="flex items-start gap-2.5 text-sm text-ink-200">
            <span className="text-tide-400 mt-0.5">✓</span> {f}
          </li>
        ))}
      </ul>

      {isNativePlatform() ? (
        <p className="mt-8 text-sm text-tide-400 font-semibold">You’re already on the app 🎉</p>
      ) : (
        <>
          <a
            href="/apk"
            className="mt-8 inline-flex items-center gap-2 px-8 py-4 rounded-full btn-primary text-lg hover:bg-ember-400 active:scale-95 transition-transform shadow-xl"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
              <path d="M12 3v12M7 10l5 5 5-5M4 21h16" />
            </svg>
            Download APK
          </a>
          <p className="text-[11px] text-ink-500 mt-4 leading-relaxed">
            Always the newest signed build. Android may warn about apps from outside Play Store —
            the APK is signed with VinaX’s release key on every build.
          </p>
        </>
      )}

      <p className="mt-8 text-xs text-ink-400">
        Prefer the web? <Link to="/" className="text-ember-400 font-semibold">Keep listening in the browser →</Link>
      </p>
    </div>
  );
}
