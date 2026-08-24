import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { KEYS } from '@/constants/storage-keys';

interface AlarmState {
  enabled: boolean;
  time: string; // "HH:MM"
  action: 'favorites' | 'resume';
  lastFired: string; // YYYY-MM-DD — fire at most once per day
  setEnabled(v: boolean): void;
  setTime(t: string): void;
  setAction(a: 'favorites' | 'resume'): void;
  markFired(d: string): void;
}

export const useAlarmStore = create<AlarmState>()(
  persist(
    (set) => ({
      enabled: false,
      time: '07:00',
      action: 'favorites',
      lastFired: '',
      setEnabled: (enabled) => set({ enabled }),
      setTime: (time) => set({ time }),
      setAction: (action) => set({ action }),
      markFired: (lastFired) => set({ lastFired }),
    }),
    { name: KEYS.alarm, storage: createJSONStorage(() => window.localStorage) },
  ),
);
