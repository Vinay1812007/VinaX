import { useSyncExternalStore, type MutableRefObject, type ReactNode } from 'react';
import { LiveVoiceOverlay } from '@/features/voice/LiveVoiceOverlay';
import type { VoiceUiStore } from './liveVoiceStore';

/** The live-voice overlay, fed from the voice store so that only this
 *  component re-renders while captions and states tick. */
export function LiveVoiceHost({
  store,
  levelRef,
  waveRef,
  onInterrupt,
  onToggleMute,
  onEnd,
}: {
  store: VoiceUiStore;
  levelRef: MutableRefObject<number>;
  waveRef: MutableRefObject<Uint8Array | null>;
  onInterrupt: () => void;
  onToggleMute: () => void;
  onEnd: () => void;
}): ReactNode {
  const ui = useSyncExternalStore(store.subscribe, store.get, store.get);
  return (
    <LiveVoiceOverlay
      state={ui.state}
      levelRef={levelRef}
      waveRef={waveRef}
      muted={ui.muted}
      userCaption={ui.userCaption || ui.notice}
      aiCaption={ui.aiCaption}
      error={ui.error}
      voiceLabel=""
      onInterrupt={onInterrupt}
      onToggleMute={onToggleMute}
      onEnd={onEnd}
    />
  );
}
