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
  /** 1.15 — what the right-hand panel shows on wide screens: the playing song, or the queue. */
  railView: 'playing' | 'queue';
  setRailView(v: 'playing' | 'queue'): void;
  /** 1.15 — the open page's own name, colour ("R G B") and play action, for the sticky top bar once the page scrolls. */
  pageTitle: string | null;
  pageTone: string | null;
  pagePlay: { label: string; run: () => void } | null;
  setPage(patch: Partial<Pick<UiState, 'pageTitle' | 'pageTone' | 'pagePlay'>>): void;
}

export const useUiStore = create<UiState>((set) => ({
  tourOpen: false,
  openTour: () => set({ tourOpen: true }),
  closeTour: () => set({ tourOpen: false }),
  signIn: null,
  openSignIn: (reason, resume) => set({ signIn: { reason, resume } }),
  closeSignIn: () => set({ signIn: null }),
  railView: 'playing',
  setRailView: (railView) => set({ railView }),
  pageTitle: null,
  pageTone: null,
  pagePlay: null,
  setPage: (patch) => set(patch),
}));
