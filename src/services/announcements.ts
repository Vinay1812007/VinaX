/** Admin announcements for the Android app. The WebView has no Web Push, so
 *  the app checks on open/resume and shows a local notification instead.
 *  Anonymous by design: a plain GET for the latest broadcast, nothing sent. */
import { KEYS } from '@/constants/storage-keys';
import { ensureNotificationPermission, isNativePlatform } from '@/services/native';

const SEEN_KEY = 'vinax.announce-seen.v1';
const OPT_KEY = 'vinax.app-alerts.v1';
const ASKED_KEY = 'vinax.notif-asked.v1';
const BASE = 'https://www.sirimillavinay.online';

export function appAlertsEnabled(): boolean {
  try {
    return localStorage.getItem(OPT_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setAppAlertsEnabled(on: boolean): void {
  try {
    localStorage.setItem(OPT_KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
  if (on) void ensureNotificationPermission();
}

interface Announcement {
  title?: string;
  body?: string;
  link?: string;
  ts?: number;
}

let listenerWired = false;

export async function checkAnnouncements(navigate: (to: string) => void): Promise<void> {
  if (!isNativePlatform() || !appAlertsEnabled()) return;
  try {
    // Don't collide with onboarding — the next open will ask instead.
    if (!localStorage.getItem(KEYS.onboarded)) return;
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    if (!listenerWired) {
      listenerWired = true;
      void LocalNotifications.addListener('localNotificationActionPerformed', (e) => {
        const link = (e.notification.extra as { link?: string } | undefined)?.link;
        // Reject protocol-relative "//attacker.com/x" — startsWith('/') alone
        // would accept it and navigate() would send the WebView off-origin.
        if (typeof link === 'string' && /^\/[^/]/.test(link)) navigate(link);
      });
    }
    // First run after onboarding: this is the app's notification-permission ask.
    if (!localStorage.getItem(ASKED_KEY)) {
      localStorage.setItem(ASKED_KEY, '1');
      const perm = await ensureNotificationPermission();
      if (perm !== 'granted') return;
    }
    const res = await fetch(`${BASE}/api/announcements`);
    if (!res.ok) return;
    const data = (await res.json()) as { announcement?: Announcement | null };
    const a = data.announcement;
    if (!a || typeof a.ts !== 'number' || !a.title) return;
    const seen = Number(localStorage.getItem(SEEN_KEY) ?? '0');
    if (a.ts <= seen) return;
    localStorage.setItem(SEEN_KEY, String(a.ts));
    await LocalNotifications.schedule({
      notifications: [
        {
          id: Math.floor(a.ts % 2_000_000_000),
          title: a.title.slice(0, 120),
          body: (a.body ?? '').slice(0, 300),
          extra: { link: typeof a.link === 'string' ? a.link : '/' },
        },
      ],
    });
  } catch {
    /* announcements are best-effort */
  }
}
