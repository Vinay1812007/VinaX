import { create } from 'zustand';

/** 13.9 — why the sign-in sheet opened: the copy follows the reason. */
export type SignInReason = 'listen' | 'save' | 'account';

export interface SignInPromptState {
  reason: SignInReason;
  /** What the visitor was doing; runs once they have signed in (play the song they tapped). */
  resume?: () => void;
}

/** Lightweight cross-component UI flags (kept out of persisted stores). */
interface UiState {
  tourOpen: boolean;
  openTour(): void;
  closeTour(): void;
  /** 13.9 — the "Sign in to start listening" sheet for a visitor browsing signed out. */
  signIn: SignInPromptState | null;
  openSignIn(reason: SignInReason, resume?: () => void): void;
  closeSignIn(): void;
}

export const useUiStore = create<UiState>((set) => ({
  tourOpen: false,
  openTour: () => set({ tourOpen: true }),
  closeTour: () => set({ tourOpen: false }),
  signIn: null,
  openSignIn: (reason, resume) => set({ signIn: { reason, resume } }),
  closeSignIn: () => set({ signIn: null }),
}));
