import { useEffect, useRef, type ReactNode } from 'react';
import { isNativePlatform } from '@/services/native';
import { thisDevice } from '@/utils/device';
import { useTogether } from '@/services/together/session';
import { leaveSession } from './engine';
import { appIntentUrl } from './invite';

/**
 * 1.13 — website → app. On an Android phone's browser, offer to carry on in
 * the VinaX app, where the room keeps playing with the screen off. The link
 * opens the app straight in this room when it is installed (the APK from
 * 1.13 on) and the download page when it is not. Shown nowhere else: not in
 * the app, not on iPhone or a computer.
 *
 * A guest who hands over leaves the room in this tab as it goes to the
 * background, so the song does not play twice. A host is never offered it:
 * the room belongs to the device that started it, and leaving would end it
 * for everyone.
 */
export function OpenInApp({ code }: { code?: string }): ReactNode {
  const armed = useRef(0);
  useEffect(() => {
    const onHide = (): void => {
      if (document.visibilityState !== 'hidden' || Date.now() - armed.current > 4000) return;
      armed.current = 0;
      if (useTogether.getState().mode === 'guest') leaveSession();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, []);
  if (isNativePlatform() || thisDevice().os !== 'android') return null;
  return (
    <a
      className="vx-lt-app"
      href={appIntentUrl(code ? `/together?code=${encodeURIComponent(code)}` : '/together')}
      onClick={() => {
        armed.current = Date.now();
      }}
    >
      <img src="/icons/icon.svg?v=14" alt="" width={36} height={36} />
      <span className="vx-lt-app-text">
        <b>Open in the VinaX app</b>
        <small>{code ? 'Same room — keeps playing with the screen off' : 'Rooms keep playing with the screen off'}</small>
      </span>
      <span className="vx-lt-app-go" aria-hidden>Open</span>
    </a>
  );
}
