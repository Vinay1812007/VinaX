// @vitest-environment jsdom
/**
 * 11.1.0 — the human-check widget wrapper: off our hosts, hands over each token once and resets for the next, and never
 * leaves a caller waiting when the widget fails.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/native', () => ({ isNativePlatform: () => false }));

type Opts = Record<string, (...a: unknown[]) => unknown> & { sitekey?: string; action?: string; appearance?: string };
let opts: Opts;
const api = { render: vi.fn(), reset: vi.fn(), remove: vi.fn() };

async function load(key: string, host = 'www.sirimillavinay.online') {
  vi.resetModules();
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', key);
  vi.stubGlobal('location', { hostname: host });
  return import('./turnstile');
}
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  api.render.mockReset().mockImplementation((_h: HTMLElement, o: Opts) => {
    opts = o;
    return 'w1';
  });
  api.reset.mockReset();
  api.remove.mockReset();
  window.turnstile = api;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  delete window.turnstile;
});

describe('turnstile wrapper', () => {
  it('ships the production site key, on for our hosts and off everywhere else', async () => {
    const prod = await load('');
    expect(prod.TURNSTILE_SITE_KEY).toMatch(/^0x4[A-Za-z0-9_-]+$/);
    expect(prod.turnstileEnabled()).toBe(true);
    expect((await load('', 'sirimillavinay.online')).turnstileEnabled()).toBe(true);
    // Preview builds, e2e on localhost and look-alike hosts get no widget.
    for (const host of ['vinax.pages.dev', 'localhost', 'sirimillavinay.online.evil.test']) {
      const mod = await load('', host);
      expect(mod.turnstileEnabled()).toBe(false);
      expect(await mod.mountHumanCheck(document.createElement('div'), 'username').token()).toBeNull();
    }
    expect(api.render).not.toHaveBeenCalled();
  });

  it('renders with the key and action, hands a token over once, then resets for the next', async () => {
    const { mountHumanCheck, turnstileEnabled } = await load('site-key');
    expect(turnstileEnabled()).toBe(true);
    const host = document.createElement('div');
    const check = mountHumanCheck(host, 'username');
    await tick();
    expect(opts.sitekey).toBe('site-key');
    expect(opts.action).toBe('username');
    // A caller waiting before the token exists gets it when it arrives.
    const waiting = check.token();
    opts.callback('t-1');
    expect(await waiting).toBe('t-1');
    expect(api.reset).toHaveBeenCalledWith('w1');
    // A token already there is handed over at once — and only once.
    opts.callback('t-2');
    expect(await check.token()).toBe('t-2');
    expect(api.reset).toHaveBeenCalledTimes(2);
    // The slot is marked only while the widget asks for a tap.
    opts['before-interactive-callback']();
    expect(host.dataset.check).toBe('interactive');
    opts['after-interactive-callback']();
    expect(host.dataset.check).toBeUndefined();
    check.remove();
    expect(api.remove).toHaveBeenCalledWith('w1');
  });

  it('visible: always on screen and marked for layout; default: shows only to ask for a tap', async () => {
    const { mountHumanCheck } = await load('');
    const shown = document.createElement('div');
    const check = mountHumanCheck(shown, 'username', { visible: true });
    await tick();
    expect(opts.appearance).toBe('always');
    expect(shown.dataset.visible).toBe('true');
    check.remove();
    expect(shown.dataset.visible).toBeUndefined();
    const hidden = document.createElement('div');
    mountHumanCheck(hidden, 'username');
    await tick();
    expect(opts.appearance).toBe('interaction-only');
    expect(hidden.dataset.visible).toBeUndefined();
  });

  it('a widget error or removal releases anyone waiting with null', async () => {
    const { mountHumanCheck } = await load('site-key');
    const check = mountHumanCheck(document.createElement('div'), 'username');
    await tick();
    const a = check.token();
    expect(opts['error-callback']()).toBe(true);
    expect(await a).toBeNull();
    const b = check.token();
    check.remove();
    expect(await b).toBeNull();
    expect(await check.token()).toBeNull();
  });

  it('oneShotHumanToken mounts a floating slot and removes it afterwards', async () => {
    const { oneShotHumanToken } = await load('site-key');
    const p = oneShotHumanToken('username');
    await tick();
    expect(document.querySelector('.vx-human-check-float')).not.toBeNull();
    opts.callback('t-3');
    expect(await p).toBe('t-3');
    expect(document.querySelector('.vx-human-check-float')).toBeNull();
  });
});
