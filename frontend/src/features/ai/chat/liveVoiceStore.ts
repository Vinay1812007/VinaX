import type { LiveVoiceState } from '@/features/voice/liveVoiceEngine';

/** What the live-voice overlay shows. Captions change several times a second
 *  while someone speaks, so they live in this tiny store — subscribed to by
 *  the overlay host alone — instead of in page state, where every interim
 *  caption would re-render the whole conversation. */
export interface VoiceUi {
  state: LiveVoiceState;
  muted: boolean;
  userCaption: string;
  aiCaption: string;
  notice: string;
  error: string;
  /** 11.2 — a quiet line when the chosen voice had to hand over to this
   *  device's voice ('' while the chosen voice is speaking). */
  voiceNotice: string;
  /** 11.2 — the voice picker is open over the chat: the mic is held. */
  held: boolean;
}

export const idleVoiceUi = (): VoiceUi => ({
  state: 'idle',
  muted: false,
  userCaption: '',
  aiCaption: '',
  notice: '',
  error: '',
  voiceNotice: '',
  held: false,
});

export interface VoiceUiStore {
  get: () => VoiceUi;
  set: (patch: Partial<VoiceUi>) => void;
  reset: () => void;
  subscribe: (fn: () => void) => () => void;
}

export function createVoiceUiStore(): VoiceUiStore {
  let value = idleVoiceUi();
  const subs = new Set<() => void>();
  const emit = (): void => subs.forEach((fn) => fn());
  return {
    get: () => value,
    set: (patch) => {
      value = { ...value, ...patch };
      emit();
    },
    reset: () => {
      value = idleVoiceUi();
      emit();
    },
    subscribe: (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}
