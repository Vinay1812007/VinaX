import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { checkAnnouncements } from '@/services/announcements';
import { registerNativePush } from '@/services/push/nativePush';
import { isNativePlatform } from '@/services/native';

/** App-only: checks admin announcements on open/resume, shows them as
 *  notifications, and routes taps to the linked page. Renders nothing. */
export function AnnouncementBridge(): null {
  const navigate = useNavigate();
  useEffect(() => {
    if (!isNativePlatform()) return undefined;
    const nav = (to: string): void => {
      navigate(to);
    };
    void checkAnnouncements(nav);
    void registerNativePush(nav);
    let unmounted = false;
    let remove: (() => void) | null = null;
    void import('@capacitor/app')
      .then(({ App }) =>
        App.addListener('appStateChange', (s) => {
          if (s.isActive) void checkAnnouncements(nav);
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
