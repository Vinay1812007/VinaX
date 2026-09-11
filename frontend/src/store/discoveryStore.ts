import { create } from 'zustand';

/** Explicit refresh changes query identity without clearing listening history. */
export const useDiscoveryStore = create<{ round: number; refresh: () => void }>((set) => ({
  round: 0,
  refresh: () => set((state) => ({ round: state.round + 1 })),
}));
