import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { KEYS } from '@/constants/storage-keys';

interface AlarmState {
  enabled: boolean;
  time: string; // "HH:MM"
  action: 'favorites' | 'resume' | 'collection';
  /** v5.17.0 — playlist to wake with when action is 'collection'. */
  collectionId: string | null;
  /** v5.17.0 — ramp the volume up over 30 s instead of a jolt. */
  fadeIn: boolean;
  lastFired: string; // YYYY-MM-DD — fire at most once per day
  setEnabled(v: boolean): void;
  setTime(t: string): void;
  setAction(a: 'favorites' | 'resume' | 'collection'): void;
  setCollectionId(id: string | null): void;
  setFadeIn(v: boolean): void;
  markFired(d: string): void;
}

export const useAlarmStore = create<AlarmState>()(
  persist(
    (set) => ({
      enabled: false,
      time: '07:00',
      action: 'favorites',
      collectionId: null,
      fadeIn: true,
      lastFired: '',
      setEnabled: (enabled) => set({ enabled }),
      setTime: (time) => set({ time }),
      setAction: (action) => set({ action }),
      setCollectionId: (collectionId) => set({ collectionId }),
      setFadeIn: (fadeIn) => set({ fadeIn }),
      markFired: (lastFired) => set({ lastFired }),
    }),
    { name: KEYS.alarm, storage: createJSONStorage(() => window.localStorage) },
  ),
);
