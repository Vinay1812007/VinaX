/**
 * Native Android push registration (FCM). Native platform only. Registers for
 * push, sends the device token to the server, and routes notification taps into
 * the app. This is what makes notifications arrive when the app is fully closed
 * (the WebView local-notification path only fires while the app is open).
 *
 * No-op unless: the app is a native build with @capacitor/push-notifications,
 * google-services.json is bundled, and the server has FCM_SERVICE_ACCOUNT set.
 */
import { isNativePlatform } from '@/services/native';

const BASE = 'https://www.sirimillavinay.online';
let wired = false;

export async function registerNativePush(navigate: (to: string) => void): Promise<void> {
  if (!isNativePlatform()) return;
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    if (!wired) {
      wired = true;
      // Device registered with FCM -> persist the token so the server can push.
      void PushNotifications.addListener('registration', (t) => {
        void fetch(`${BASE}/api/push/fcm-register`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token: t.value, platform: 'android' }),
        }).catch(() => {});
      });
      void PushNotifications.addListener('registrationError', () => {
        /* ignore — no push this session */
      });
      // Tap on a delivered notification -> deep-link into the app.
      void PushNotifications.addListener('pushNotificationActionPerformed', (e) => {
        const link = (e.notification.data as { link?: string } | undefined)?.link;
        if (typeof link === 'string' && link.startsWith('/')) navigate(link);
      });
    }
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive === 'granted') await PushNotifications.register();
  } catch {
    /* plugin not present in this build — silently no-op */
  }
}
