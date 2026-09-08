import { create } from 'zustand';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: number;
  message: string;
  /** v5.17.0 — optional one-tap action (Undo, Open…). */
  action?: ToastAction;
}

export interface ToastOptions {
  action?: ToastAction;
  /** Milliseconds on screen; actions get longer by default. */
  duration?: number;
}

interface ToastState {
  toasts: Toast[];
  push(message: string, opts?: ToastOptions): void;
  dismiss(id: number): void;
}

let nextId = 1;

export const useToastStore = create<ToastState>()((set, get) => ({
  toasts: [],
  push: (message, opts) => {
    const id = nextId++;
    set({ toasts: [...get().toasts.slice(-2), { id, message, action: opts?.action }] });
    window.setTimeout(() => get().dismiss(id), opts?.duration ?? (opts?.action ? 5000 : 2400));
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export const toast = (message: string, opts?: ToastOptions): void => useToastStore.getState().push(message, opts);
