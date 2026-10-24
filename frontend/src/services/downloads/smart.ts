/**
 * 15.0 — smart downloads (Android): with Settings → Playback → Smart
 * downloads on, this week's Weekly Mix is downloaded on its own, on Wi-Fi,
 * and last week's automatic copies are removed once the new week's are in,
 * so the device always holds one week of ready-to-go music and no more.
 *
 * Rules:
 * - Only on the Android app (the web has no downloads).
 * - Only on Wi-Fi (or a wired connection) when the browser can tell; where
 *   it cannot (`navigator.connection` missing), only while Data saver is off.
 * - At most SMART_MAX songs a week, songs the listener downloaded by hand
 *   are never removed, and a song in both weeks is kept, not re-fetched.
 * - One pass per week per device, kept in local storage, so a reload does not
 *   start the week's downloads again.
 */
import { useEffect } from 'react';
import { KEYS } from '@/constants/storage-keys';
import { isNativePlatform } from '@/services/native';
import { getLocal, setLocal } from '@/services/storage/local';
import { useSettingsStore } from '@/store/settingsStore';
import { useDownloadsStore } from '@/store/downloadsStore';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useWeeklyMix, isoWeekKey } from '@/features/weekly/useWeeklyMix';
import { downloadMany, removeDownload } from '@/services/downloads';
import { toast } from '@/store/toastStore';

export const SMART_MAX = 20;

interface SmartState { week: string; ids: string[]; done: boolean }

interface ConnectionLike { type?: string; saveData?: boolean }

/** Wi-Fi or wired → true; cellular etc. → false; unknown → null. */
export function connectionAllows(nav: { connection?: ConnectionLike } = navigator as unknown as { connection?: ConnectionLike }): boolean | null {
  const c = nav.connection;
  if (!c) return null;
  if (c.saveData) return false;
  if (!c.type || c.type === 'unknown') return null;
  return c.type === 'wifi' || c.type === 'ethernet';
}

/** The ids this week's pass should fetch, given what is already on the device. */
export function planSmartDownloads(mixIds: string[], have: Set<string>, max = SMART_MAX): string[] {
  const out: string[] = [];
  for (const id of mixIds) {
    if (out.length >= max) break;
    if (!have.has(id)) out.push(id);
  }
  return out;
}

/** Last week's automatic copies to drop: not in this week's mix, not downloaded by hand. */
export function planSmartRemovals(previous: SmartState | null, keepIds: Set<string>, manual: Set<string>): string[] {
  if (!previous) return [];
  return previous.ids.filter((id) => !keepIds.has(id) && !manual.has(id));
}

let running = false;

export function SmartDownloads(): null {
  const on = useSettingsStore((s) => s.smartDownloads);
  const dataSaver = useSettingsStore((s) => s.dataSaver);
  const online = useOnlineStatus();
  const { data: mix } = useWeeklyMix();
  const items = useDownloadsStore((s) => s.items);

  useEffect(() => {
    if (!isNativePlatform() || !on || !online || running) return;
    if (!mix || !mix.length) return;
    const wifi = connectionAllows();
    if (wifi === false || (wifi === null && dataSaver)) return;
    const week = isoWeekKey();
    const state = getLocal<SmartState | null>(KEYS.smartDownloads, null);
    if (state && state.week === week && state.done) return;
    const previous = state && state.week !== week ? state : null;
    const have = new Set(Object.keys(items));
    const mixIds = mix.slice(0, SMART_MAX).map((s) => s.id);
    const wantIds = planSmartDownloads(mixIds, have);
    const manual = new Set(have);
    for (const id of previous?.ids ?? []) manual.delete(id);
    const removals = planSmartRemovals(previous, new Set(mixIds), manual);
    running = true;
    void (async () => {
      try {
        const byId = new Map(mix.map((s) => [s.id, s]));
        const songs = wantIds.map((id) => byId.get(id)).filter((s): s is NonNullable<typeof s> => !!s);
        const r = songs.length ? await downloadMany(songs) : { saved: 0, failed: 0 };
        for (const id of removals) await removeDownload(id).catch(() => undefined);
        // Only what smart downloads itself put on the device is ever removed
        // later: this week's new downloads that landed, plus last week's
        // automatic copies still in the mix. A song downloaded by hand is never listed.
        const now = useDownloadsStore.getState().items;
        const carried = (previous?.ids ?? []).filter((id) => mixIds.includes(id) && now[id]);
        const ids = [...new Set([...wantIds.filter((id) => now[id]), ...carried])];
        setLocal(KEYS.smartDownloads, { week, ids, done: r.failed === 0 || r.reason !== 'offline' } satisfies SmartState);
        if (r.saved) toast(`Weekly Mix ready offline: ${r.saved} song${r.saved === 1 ? '' : 's'} downloaded`);
      } finally {
        running = false;
      }
    })();
  }, [on, dataSaver, online, mix, items]);

  return null;
}
