import { create } from 'zustand';
import type { UpdateInfo } from '@/services/update';

interface UpdateState {
  info: UpdateInfo | null;
  setInfo(info: UpdateInfo | null): void;
}

export const useUpdateStore = create<UpdateState>()((set) => ({
  info: null,
  setInfo: (info) => set({ info }),
}));
