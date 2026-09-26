import { useState } from 'react';
import { Link } from 'react-router-dom';
import { KEYS } from '@/constants/storage-keys';
import { getLocal, setLocal } from '@/services/storage/local';
import { isNativePlatform } from '@/services/native';
import { XIcon } from './Icons';
import { IconButton } from './IconButton';

const DISMISS_KEY = `${KEYS.settings}.getapp-dismissed`;

/** Shown to Android users listening on the website: install the real app. */
export function GetAppBanner() {
  const androidWeb =
    !isNativePlatform() && typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
  const [dismissed, setDismissed] = useState(() => getLocal<boolean>(DISMISS_KEY, false));

  if (!androidWeb || dismissed) return null;

  return (
    <div className="vxh-note">
      <img src="/icons/icon.svg" alt="" className="vxh-note-icon" width={40} height={40} />
      <span className="vxh-note-text">
        <span className="vxh-note-title">Get the VinaX app</span>
        <span className="vxh-note-sub">Background playback and lockscreen controls</span>
      </span>
      <span className="vxh-note-actions">
        <Link to="/download" className="vxh-note-btn">
          Download
        </Link>
        <IconButton
          size="sm"
          label="Dismiss"
          onClick={() => {
            setLocal(DISMISS_KEY, true);
            setDismissed(true);
          }}
        >
          <XIcon className="w-4 h-4" />
        </IconButton>
      </span>
    </div>
  );
}
