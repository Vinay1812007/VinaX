import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { checkAnnouncements } from '@/services/announcements';
import { isNativePlatform } from '@/services/native';

/** App-only: checks admin announcements on open/resume, shows them as
 *  notifications, and routes taps to the linked page. Renders nothing. */
export function AnnouncementBridge(): null {
  const navigate = useNavigate();
  useEffect(() => {
    if (!isNativePlatform()) {
      // 11.7.1 — the web half: a browser whose listener already allowed
      // notifications re-sends its subscription (at once if the server never
      // confirmed it, else daily), a few seconds after boot so it never
      // competes with the first screen.
      const timer = window.setTimeout(() => {
        void import('@/services/push').then((m) => m.syncPush()).catch(() => undefined);
      }, 5_000);
      return () => window.clearTimeout(timer);
    }
    const nav = (to: string): void => {
      navigate(to);
    };
    void checkAnnouncements(nav);
    // Android-only, so loaded on demand: it stays out of every browser's first load.
    const push = import('@/services/push/nativePush');
    void push.then((m) => m.registerNativePush(nav)).catch(() => undefined);
    let unmounted = false;
    let remove: (() => void) | null = null;
    void import('@capacitor/app')
      .then(({ App }) =>
        App.addListener('appStateChange', (s) => {
          if (!s.isActive) return;
          void checkAnnouncements(nav);
          void push.then((m) => m.refreshNativePush()).catch(() => undefined);
        }),
      )
      .then((handle) => {
        if (unmounted) void handle.remove();
        else
          remove = () => {
            void handle.remove();
          };
      })
      .catch(() => null);
    return () => {
      unmounted = true;
      if (remove) remove();
    };
  }, [navigate]);
  return null;
}
