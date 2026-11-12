/**
 * VinaX AI Live voice — the call as app-wide state, so it keeps going while
 * the listener browses VinaX (like ChatGPT's and Claude's voice mode).
 * ChatView opens a call here; LiveHost (mounted by AppLayout while a call is
 * open) shows it full screen or as a small bar (`minimized`). This module is
 * tiny on purpose: AppLayout imports it in the first-load bundle; the call
 * itself (LiveHost → LiveView → liveSession) loads only when one opens.
 */
import { create } from 'zustand';
import type { LiveViewProps } from './LiveView';

export type LiveCallProps = Omit<LiveViewProps, 'onClose' | 'minimized' | 'onMinimize' | 'onExpand'>;

interface LiveCallState {
  call: LiveCallProps | null;
  /** A new call remounts the view (a fresh session). */
  key: number;
  minimized: boolean;
  open(props: LiveCallProps): void;
  minimize(): void;
  expand(): void;
  close(): void;
}

export const useLiveCall = create<LiveCallState>((set, get) => ({
  call: null,
  key: 0,
  minimized: false,
  open: (props) => { if (!get().call) set({ call: props, key: get().key + 1, minimized: false }); else set({ minimized: false }); },
  minimize: () => { if (get().call) set({ minimized: true }); },
  expand: () => set({ minimized: false }),
  close: () => set({ call: null, minimized: false }),
}));
