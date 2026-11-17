// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { precacheMode, startPrecache } from './precache';
import { useSettingsStore } from '@/store/settingsStore';

describe('precacheMode', () => {
  it('is full without any data saver', () => {
    expect(precacheMode({ native: false, dataSaver: false })).toBe('full');
    expect(precacheMode({ native: false, dataSaver: false, type: 'cellular' })).toBe('full');
  });

  it('is light with Data saver or the browser data saver on a metered or unknown connection', () => {
    expect(precacheMode({ native: false, dataSaver: true })).toBe('light');
    expect(precacheMode({ native: false, dataSaver: true, type: 'cellular' })).toBe('light');
    expect(precacheMode({ native: false, dataSaver: false, saveData: true, type: 'unknown' })).toBe('light');
  });

  it('is full on Wi-Fi or a wire even with data saver on', () => {
    expect(precacheMode({ native: false, dataSaver: true, type: 'wifi' })).toBe('full');
    expect(precacheMode({ native: false, dataSaver: false, saveData: true, type: 'ethernet' })).toBe('full');
  });

  it('is always full in the Android app (offline launch needs every page)', () => {
    expect(precacheMode({ native: true, dataSaver: true, saveData: true, type: 'cellular' })).toBe('full');
  });
});

describe('startPrecache', () => {
  afterEach(() => {
    useSettingsStore.setState({ dataSaver: false });
    vi.unstubAllGlobals();
  });

  const fakeReg = () => {
    const postMessage = vi.fn();
    return { reg: { active: { postMessage } } as unknown as ServiceWorkerRegistration, postMessage };
  };

  it('posts the full precache by default and the light one with Data saver on', () => {
    vi.stubGlobal('navigator', { ...navigator, serviceWorker: new EventTarget() });
    const a = fakeReg();
    startPrecache(a.reg);
    expect(a.postMessage).toHaveBeenCalledWith({ type: 'PRECACHE' });

    useSettingsStore.setState({ dataSaver: true });
    const b = fakeReg();
    startPrecache(b.reg);
    expect(b.postMessage).toHaveBeenCalledWith({ type: 'PRECACHE', mode: 'light' });
  });

  it('asks for the full precache when a data-saving phone moves onto Wi-Fi', () => {
    const connection = Object.assign(new EventTarget(), { saveData: true, type: 'cellular' });
    vi.stubGlobal('navigator', { ...navigator, serviceWorker: new EventTarget(), connection });
    const { reg, postMessage } = fakeReg();
    startPrecache(reg);
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'PRECACHE', mode: 'light' });
    connection.type = 'wifi';
    connection.dispatchEvent(new Event('change'));
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'PRECACHE' });
  });

  it('asks for the full precache when Settings > Data saver is turned off', () => {
    vi.stubGlobal('navigator', { ...navigator, serviceWorker: new EventTarget() });
    useSettingsStore.setState({ dataSaver: true });
    const { reg, postMessage } = fakeReg();
    startPrecache(reg);
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'PRECACHE', mode: 'light' });
    useSettingsStore.setState({ dataSaver: false });
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'PRECACHE' });
  });
});
