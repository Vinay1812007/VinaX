import { create } from 'zustand';

interface DiagState {
  notice: string | null;
  setNotice(notice: string | null): void;
}

/** Surfaced problems that must not stay invisible (native bridge failures). */
export const useDiagStore = create<DiagState>()((set) => ({
  notice: null,
  setNotice: (notice) => set({ notice }),
}));
