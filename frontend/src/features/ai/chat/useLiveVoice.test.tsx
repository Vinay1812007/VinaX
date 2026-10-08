// @vitest-environment jsdom
/** 11.2 — holding voice chat while the voice picker is open: the mic closes,
 *  a reply being spoken stops, and release restores the listener's mute. */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

type Cbs = { onState: (s: string) => void; onServerVoice?: (s: string) => void };
const { engines, FakeEngine } = vi.hoisted(() => {
  const engines: Array<{ muted: boolean[]; interrupts: number; cbs: Cbs }> = [];
  class FakeEngine {
    waveBins = new Uint8Array(4);
    muted: boolean[] = [];
    interrupts = 0;
    cbs: Cbs;
    constructor(_opts: unknown, cbs: Cbs) {
      this.cbs = cbs;
      engines.push(this);
    }
    start(): void {}
    destroy(): void {}
    interrupt(): void {
      this.interrupts += 1;
    }
    setMuted(m: boolean): void {
      this.muted.push(m);
    }
  }
  return { engines, FakeEngine };
});
vi.mock('@/features/voice/liveVoiceEngine', () => ({ LiveVoiceEngine: FakeEngine }));
vi.mock('@/features/voice/pickSynthVoice', () => ({ pickSynthVoice: () => null }));

import { useLiveVoice } from './useLiveVoice';

const setup = () => {
  const onStopReply = vi.fn();
  const hook = renderHook(() => useLiveVoice({ getServerVoice: () => null, onUserFinal: () => undefined, onStopReply }));
  act(() => hook.result.current.start());
  return { hook, onStopReply, engine: engines[engines.length - 1] };
};

describe('useLiveVoice — hold for the voice picker', () => {
  it('closes the mic and stops a reply being spoken; release restores the mic', () => {
    const { hook, onStopReply, engine } = setup();
    act(() => engine.cbs.onState('speaking'));
    act(() => hook.result.current.hold(true));
    expect(engine.muted).toEqual([true]);
    expect(engine.interrupts).toBe(1);
    expect(onStopReply).toHaveBeenCalledTimes(1);
    expect(hook.result.current.store.get().held).toBe(true);
    act(() => hook.result.current.hold(false));
    expect(engine.muted).toEqual([true, false]);
    expect(hook.result.current.store.get().held).toBe(false);
  });

  it('keeps the listener muted on release when they had muted', () => {
    const { hook, engine } = setup();
    act(() => hook.result.current.toggleMute());
    act(() => hook.result.current.hold(true));
    act(() => hook.result.current.hold(false));
    expect(engine.muted).toEqual([true, true, true]);
    expect(engine.interrupts).toBe(0); // listening, nothing to stop
  });

  it('shows a quiet notice when the chosen voice hands over, and clears it when it speaks again', () => {
    const { hook, engine } = setup();
    act(() => engine.cbs.onServerVoice?.('quota'));
    expect(hook.result.current.store.get().voiceNotice).toMatch(/out of quota/);
    act(() => engine.cbs.onServerVoice?.('ok'));
    expect(hook.result.current.store.get().voiceNotice).toBe('');
  });
});
