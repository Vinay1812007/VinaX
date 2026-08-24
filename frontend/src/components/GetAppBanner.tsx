import { useState } from 'react';
import { Link } from 'react-router-dom';
import { KEYS } from '@/constants/storage-keys';
import { getLocal, setLocal } from '@/services/storage/local';
import { isNativePlatform } from '@/services/native';
import { XIcon } from './Icons';

const DISMISS_KEY = `${KEYS.settings}.getapp-dismissed`;

/** Shown to Android users listening on the website: install the real app. */
export function GetAppBanner() {
  const androidWeb =
    !isNativePlatform() && typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
  const [dismissed, setDismissed] = useState(() => getLocal<boolean>(DISMISS_KEY, false));

  if (!androidWeb || dismissed) return null;

  return (
    <div className="mb-5 rounded-2xl glass p-4 flex items-center gap-3 animate-fade-up">
      <img src="/icons/icon.svg" alt="" className="w-10 h-10 rounded-xl shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold">Get the VinaX app</p>
        <p className="text-xs text-ink-300">Background playback, lockscreen controls, in-app updates.</p>
      </div>
      <Link
        to="/download"
        className="shrink-0 px-4 py-2 rounded-full text-sm btn-primary"
      >
        Download
      </Link>
      <button
        aria-label="Dismiss"
        onClick={() => {
          setLocal(DISMISS_KEY, true);
          setDismissed(true);
        }}
        className="shrink-0 p-1.5 text-ink-400 hover:text-ink-100"
      >
        <XIcon className="w-4 h-4" />
      </button>
    </div>
  );
}
