import { describe, expect, it, vi } from 'vitest';
import { bootAlarm, startWhenAlarmSet } from './boot';

function fakeStore(enabled: boolean) {
  let state = { enabled };
  const listeners = new Set<(s: { enabled: boolean }) => void>();
  return {
    getState: () => state,
    subscribe(fn: (s: { enabled: boolean }) => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    set(next: { enabled: boolean }) {
      state = next;
      for (const fn of [...listeners]) fn(state);
    },
    listeners,
  };
}

const mocks = vi.hoisted(() => ({ initAlarm: vi.fn(), store: { current: null as ReturnType<typeof fakeStore> | null } }));
vi.mock('./index', () => ({ initAlarm: mocks.initAlarm }));
vi.mock('@/store/alarmStore', () => ({
  useAlarmStore: {
    getState: () => mocks.store.current!.getState(),
    subscribe: (fn: (s: { enabled: boolean }) => void) => mocks.store.current!.subscribe(fn),
  },
}));

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

describe('startWhenAlarmSet', () => {
  it('starts at once when an alarm is stored', () => {
    const store = fakeStore(true);
    const start = vi.fn();
    startWhenAlarmSet(store, start);
    expect(start).toHaveBeenCalledTimes(1);
    expect(store.listeners.size).toBe(0);
  });

  it('waits while no alarm is set, then starts once it is turned on', () => {
    const store = fakeStore(false);
    const start = vi.fn();
    startWhenAlarmSet(store, start);
    expect(start).not.toHaveBeenCalled();
    store.set({ enabled: false });
    expect(start).not.toHaveBeenCalled();
    store.set({ enabled: true });
    expect(start).toHaveBeenCalledTimes(1);
    expect(store.listeners.size).toBe(0);
    store.set({ enabled: false });
    store.set({ enabled: true });
    expect(start).toHaveBeenCalledTimes(1);
  });
});

describe('bootAlarm', () => {
  it('in the app, starts the scheduler even with no alarm set', async () => {
    mocks.store.current = fakeStore(false);
    mocks.initAlarm.mockClear();
    bootAlarm(true);
    await flush();
    expect(mocks.initAlarm).toHaveBeenCalledTimes(1);
  });

  it('on the web, starts the scheduler only once an alarm is turned on', async () => {
    const store = fakeStore(false);
    mocks.store.current = store;
    mocks.initAlarm.mockClear();
    bootAlarm(false);
    await flush();
    expect(mocks.initAlarm).not.toHaveBeenCalled();
    store.set({ enabled: true });
    await flush();
    expect(mocks.initAlarm).toHaveBeenCalledTimes(1);
  });

  it('on the web, starts at boot when an alarm is stored', async () => {
    mocks.store.current = fakeStore(true);
    mocks.initAlarm.mockClear();
    bootAlarm(false);
    await flush();
    expect(mocks.initAlarm).toHaveBeenCalledTimes(1);
  });
});
