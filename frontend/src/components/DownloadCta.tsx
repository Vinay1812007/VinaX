import { Link } from 'react-router-dom';
import { isNativePlatform } from '@/services/native';

/** Desktop/web nudge to install the Android app (mobile Android-web uses GetAppBanner). */
export function DownloadCta() {
  if (isNativePlatform()) return null;
  return (
    <div className="hidden lg:flex items-center gap-4 mb-6 rounded-card glass p-4 animate-fade-up">
      <div className="relative shrink-0">
        <div className="absolute -inset-2 rounded-2xl bg-premium opacity-40 blur-xl" aria-hidden />
        <img src="/icons/icon.svg" alt="" className="relative w-12 h-12 rounded-2xl" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-base font-bold">Take VinaX anywhere</p>
        <p className="text-sm text-ink-300">
          Background playback, lockscreen controls, and offline downloads on your phone.
        </p>
      </div>
      <Link to="/download" className="shrink-0 px-5 py-2.5 rounded-full btn-premium font-bold text-sm">
        Get the app
      </Link>
    </div>
  );
}
