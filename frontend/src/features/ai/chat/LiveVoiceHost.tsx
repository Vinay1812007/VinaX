import { useState, useSyncExternalStore, type MutableRefObject, type ReactNode } from 'react';
import { LiveVoiceOverlay } from '@/features/voice/LiveVoiceOverlay';
import { parseVoicePick } from '../voicePick';
import type { VoiceUiStore } from './liveVoiceStore';
import { VoicePickerSheet } from './VoicePicker';
import { voicePickLabel, type VoiceCatalog } from './voices';

/** The live-voice overlay, fed from the voice store so that only this
 *  component re-renders while captions and states tick.
 *  11.2 — names the chosen voice and opens the voice picker over the chat;
 *  the chat is held (mic closed, any reply stopped) while it is open, so a
 *  preview is never heard as the listener speaking. */
export function LiveVoiceHost({
  store,
  levelRef,
  waveRef,
  onInterrupt,
  onToggleMute,
  onEnd,
  voicePick,
  voiceCatalog,
  onVoicePick,
  onLoadVoices,
  onHold,
}: {
  store: VoiceUiStore;
  levelRef: MutableRefObject<number>;
  waveRef: MutableRefObject<Uint8Array | null>;
  onInterrupt: () => void;
  onToggleMute: () => void;
  onEnd: () => void;
  voicePick: string;
  voiceCatalog: VoiceCatalog | null;
  onVoicePick: (v: string) => void;
  onLoadVoices: () => void;
  onHold: (on: boolean) => void;
}): ReactNode {
  const ui = useSyncExternalStore(store.subscribe, store.get, store.get);
  const [picking, setPicking] = useState(false);
  const open = (): void => {
    onLoadVoices();
    onHold(true);
    setPicking(true);
  };
  const close = (): void => {
    setPicking(false);
    onHold(false);
  };
  return (
    <>
      <LiveVoiceOverlay
        state={ui.state}
        levelRef={levelRef}
        waveRef={waveRef}
        muted={ui.muted || ui.held}
        userCaption={ui.userCaption || ui.notice}
        aiCaption={ui.aiCaption}
        error={ui.error}
        voiceLabel={voicePickLabel(parseVoicePick(voicePick))}
        voiceNotice={ui.voiceNotice}
        onOpenVoices={ui.error === '' ? open : undefined}
        onInterrupt={onInterrupt}
        onToggleMute={onToggleMute}
        onEnd={onEnd}
      />
      {picking && (
        <VoicePickerSheet
          catalog={voiceCatalog}
          value={voicePick}
          onChange={(v) => {
            onVoicePick(v);
            // A new choice gets a fresh chance; the old voice's notice is stale.
            if (ui.voiceNotice) store.set({ voiceNotice: '' });
          }}
          onClose={close}
        />
      )}
    </>
  );
}
