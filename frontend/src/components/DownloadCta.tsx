import { Link } from 'react-router-dom';
import { isNativePlatform } from '@/services/native';

/** Desktop/web nudge to install the Android app (mobile Android-web uses GetAppBanner). */
export function DownloadCta() {
  if (isNativePlatform()) return null;
  return (
    <div className="vxh-note is-desktop-only">
      <img src="/icons/icon.svg" alt="" className="vxh-note-icon" width={40} height={40} />
      <span className="vxh-note-text">
        <span className="vxh-note-title">Take VinaX anywhere</span>
        <span className="vxh-note-sub">Background playback, lockscreen controls and offline downloads on your phone</span>
      </span>
      <Link to="/download" className="vxh-note-btn">
        Get the app
      </Link>
    </div>
  );
}
