/** 13.7.3 — the notification-permission queue (native only; loaded on demand). */
/**
 * 13.7.3 — one Android notification-permission dialog at a time.
 *
 * The playback notification, the announcement check and push registration all
 * need the same POST_NOTIFICATIONS permission and used to ask for it at the
 * same moment on start-up. Android answers a request made while its dialog is
 * already up with an empty, "not granted" result, so whichever caller lost
 * the race gave up — when that was push registration, the device got no
 * notifications that launch. Requests now queue behind each other, and after
 * the first dialog of a launch the automatic callers only read the answer
 * instead of asking again. Something the listener tapped (`force`) always asks.
 */
let permissionQueue: Promise<unknown> = Promise.resolve();
let askedThisLaunch = false;

export function withNotificationPermission<T>(
  fn: (ask: <R>(request: () => Promise<R>) => Promise<R | null>) => Promise<T>,
  force = false,
): Promise<T> {
  const ask = async <R,>(request: () => Promise<R>): Promise<R | null> => {
    if (!force && askedThisLaunch) return null;
    askedThisLaunch = true;
    return request();
  };
  const run = permissionQueue.then(() => fn(ask));
  permissionQueue = run.catch(() => undefined);
  return run;
}

/** Test seam: forget this launch's ask. */
export function resetNotificationPermissionQueueForTests(): void {
  permissionQueue = Promise.resolve();
  askedThisLaunch = false;
}

/**
 * Android 13+ requires POST_NOTIFICATIONS for the media playback notification
 * to be visible. We check + request via the LocalNotifications plugin (its
 * permission maps to the system notification permission).
 *
 * `force` is for a tap the listener made (Settings, a toggle); automatic
 * callers ask at most once per launch — see withNotificationPermission.
 *
 * Returns 'granted' | 'denied' | 'unsupported'.
 */
export async function ensureNotificationPermission(force = false): Promise<'granted' | 'denied' | 'unsupported'> {
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    return await withNotificationPermission(async (ask) => {
      let status = await LocalNotifications.checkPermissions();
      if (status.display !== 'granted') {
        status = (await ask(() => LocalNotifications.requestPermissions())) ?? status;
      }
      return status.display === 'granted' ? 'granted' : 'denied';
    }, force);
  } catch {
    return 'unsupported';
  }
}
