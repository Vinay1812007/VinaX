import { useAlarmStore } from '@/store/alarmStore';
import { usePlayerStore } from '@/store/playerStore';
import { useLibraryStore } from '@/store/libraryStore';
import { isNativePlatform } from '@/services/native';
import { toast } from '@/store/toastStore';

const NOTIF_ID = 7777;
const today = (): string => new Date().toISOString().slice(0, 10);

function fireFavorites(): void {
  const favs = useLibraryStore.getState().favorites;
  const p = usePlayerStore.getState();
  if (favs.length) {
    if (!p.shuffle) p.toggleShuffle();
    p.playQueue(favs, Math.floor(Math.random() * favs.length));
  } else if (p.queue.length && !p.isPlaying) {
    p.togglePlay();
  }
}

function fire(): void {
  const a = useAlarmStore.getState();
  const p = usePlayerStore.getState();
  if (a.action === 'resume' && p.queue.length) {
    if (!p.isPlaying) p.togglePlay();
  } else {
    fireFavorites();
  }
  toast('⏰ Good morning — your music is playing');
}

/** Native: keep a daily local notification in sync with the alarm so a
 *  backgrounded user is still alerted (tapping opens the app, which plays). */
async function syncNotification(): Promise<void> {
  if (!isNativePlatform()) return;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    await LocalNotifications.cancel({ notifications: [{ id: NOTIF_ID }] });
    const a = useAlarmStore.getState();
    if (!a.enabled) return;
    const [h, m] = a.time.split(':').map(Number);
    await LocalNotifications.schedule({
      notifications: [
        {
          id: NOTIF_ID,
          title: 'VinaX alarm',
          body: 'Tap to wake up to your music',
          schedule: { on: { hour: h, minute: m }, allowWhileIdle: true },
        },
      ],
    });
  } catch {
    /* notifications unavailable — the in-app alarm still works when open */
  }
}

let started = false;
export function initAlarm(): void {
  if (started) return;
  started = true;

  const check = (): void => {
    const a = useAlarmStore.getState();
    if (!a.enabled || a.lastFired === today()) return;
    const [ah, am] = a.time.split(':').map(Number);
    const d = new Date();
    const diff = d.getHours() * 60 + d.getMinutes() - (ah * 60 + am);
    // Fire once when the current time is within 2 minutes of the alarm.
    if (diff >= 0 && diff <= 2) {
      useAlarmStore.getState().markFired(today());
      fire();
    }
  };

  void syncNotification();
  useAlarmStore.subscribe(() => {
    void syncNotification();
  });
  check();
  window.setInterval(check, 20000);

  // Package D12 (audit) — the late-tap fix. The in-app poll only fires within
  // 2 minutes of the alarm time, so tapping the wake notification at 07:09
  // used to open the app to… silence. Now the tap itself is the trigger:
  // whenever the alarm notification is acted on, play immediately (still at
  // most once per day via lastFired).
  if (isNativePlatform()) {
    void import('@capacitor/local-notifications')
      .then(({ LocalNotifications }) => {
        void LocalNotifications.addListener('localNotificationActionPerformed', (e) => {
          if (e.notification.id !== NOTIF_ID) return;
          const a = useAlarmStore.getState();
          if (!a.enabled || a.lastFired === today()) return;
          useAlarmStore.getState().markFired(today());
          fire();
        });
      })
      .catch(() => {
        /* plugin unavailable — in-app polling still covers the open-app case */
      });
  }
}
