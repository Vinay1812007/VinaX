import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { KEYS } from '@/constants/storage-keys';

interface OutputState {
  /** setSinkId device id; '' = system default output. */
  sinkId: string;
  label: string;
  setOutput(sinkId: string, label: string): void;
}

export const useOutputStore = create<OutputState>()(
  persist(
    (set) => ({
      sinkId: '',
      label: 'This device',
      setOutput: (sinkId, label) => set({ sinkId, label }),
    }),
    { name: KEYS.output, storage: createJSONStorage(() => window.localStorage) },
  ),
);
