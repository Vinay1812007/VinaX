import { create } from 'zustand';

/** Lightweight cross-component UI flags (kept out of persisted stores). */
interface UiState {
  tourOpen: boolean;
  openTour(): void;
  closeTour(): void;
}

export const useUiStore = create<UiState>((set) => ({
  tourOpen: false,
  openTour: () => set({ tourOpen: true }),
  closeTour: () => set({ tourOpen: false }),
}));
