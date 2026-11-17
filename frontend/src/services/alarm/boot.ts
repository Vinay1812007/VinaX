/**
 * Loads the alarm scheduler (services/alarm) only when it has work to do, so
 * the first load does not carry it.
 *
 * - App: always. The scheduler keeps the daily wake notification in step with
 *   the alarm (it cancels a stale one too) and plays when that notification
 *   is tapped, even on a cold start.
 * - Web: once an alarm is on — at boot when one is stored, or the moment the
 *   listener turns one on in Settings.
 */

interface AlarmFlagStore {
  getState(): { enabled: boolean };
  subscribe(listener: (state: { enabled: boolean }) => void): () => void;
}

/** Run `start` now when the alarm is on, else once it is turned on. */
export function startWhenAlarmSet(store: AlarmFlagStore, start: () => void): void {
  if (store.getState().enabled) {
    start();
    return;
  }
  const off = store.subscribe((s) => {
    if (!s.enabled) return;
    off();
    start();
  });
}

export function bootAlarm(native: boolean): void {
  const start = (): void => {
    void import('./index').then((m) => m.initAlarm()).catch(() => undefined);
  };
  if (native) {
    start();
    return;
  }
  void import('@/store/alarmStore')
    .then(({ useAlarmStore }) => startWhenAlarmSet(useAlarmStore, start))
    .catch(() => undefined);
}
