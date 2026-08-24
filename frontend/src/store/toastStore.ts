import { create } from 'zustand';

export interface Toast {
  id: number;
  message: string;
}

interface ToastState {
  toasts: Toast[];
  push(message: string): void;
  dismiss(id: number): void;
}

let nextId = 1;

export const useToastStore = create<ToastState>()((set, get) => ({
  toasts: [],
  push: (message) => {
    const id = nextId++;
    set({ toasts: [...get().toasts.slice(-2), { id, message }] });
    window.setTimeout(() => get().dismiss(id), 2400);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export const toast = (message: string): void => useToastStore.getState().push(message);
