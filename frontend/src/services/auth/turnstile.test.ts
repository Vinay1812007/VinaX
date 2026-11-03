// @vitest-environment jsdom
/**
 * Cloudflare Turnstile at sign-in: the site key comes from the Worker (none:
 * no check), and each sign-in runs one widget that is removed afterwards.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountTurnstile, resetTurnstileForTests, turnstileSiteKey, turnstileToken } from './turnstile';

const answer = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

beforeEach(() => resetTurnstileForTests());
afterEach(() => {
  delete (window as unknown as { turnstile?: unknown }).turnstile;
  vi.unstubAllGlobals();
});

describe('Turnstile at sign-in', () => {
  it('asks the Worker for the site key once; null when off or unreachable', async () => {
    const f = answer({ turnstileSiteKey: '0xSITE' });
    expect(await turnstileSiteKey('', f)).toBe('0xSITE');
    expect(await turnstileSiteKey('', f)).toBe('0xSITE');
    expect(f).toHaveBeenCalledTimes(1);
    resetTurnstileForTests();
    expect(await turnstileSiteKey('', answer({ turnstileSiteKey: null }))).toBeNull();
    resetTurnstileForTests();
    expect(await turnstileSiteKey('', vi.fn(async () => Promise.reject(new TypeError('net'))))).toBeNull();
  });

  it('no site key: no check is needed', async () => {
    vi.stubGlobal('fetch', answer({ turnstileSiteKey: null }));
    expect(await turnstileToken('', 'app-signin')).toBeUndefined();
  });

  it('runs one widget for the sign-in action and removes it when it answers', async () => {
    vi.stubGlobal('fetch', answer({ turnstileSiteKey: '0xSITE' }));
    const removed: string[] = [];
    let opts: Record<string, unknown> = {};
    (window as unknown as { turnstile: unknown }).turnstile = {
      render: (_el: HTMLElement, o: Record<string, unknown>) => { opts = o; queueMicrotask(() => (o.callback as (t: string) => void)('tok-1')); return 'w1'; },
      remove: (id: string) => removed.push(id),
    };
    expect(await turnstileToken('', 'app-signin')).toBe('tok-1');
    expect(opts).toMatchObject({ sitekey: '0xSITE', action: 'app-signin', appearance: 'interaction-only' });
    expect(removed).toEqual(['w1']);
    expect(document.querySelector('.vx-turnstile')).toBeNull();
  });

  it('a widget error means the check failed', async () => {
    vi.stubGlobal('fetch', answer({ turnstileSiteKey: '0xSITE' }));
    (window as unknown as { turnstile: unknown }).turnstile = {
      render: (_el: HTMLElement, o: Record<string, unknown>) => { queueMicrotask(() => (o['error-callback'] as () => void)()); return 'w2'; },
      remove: () => undefined,
    };
    expect(await turnstileToken('', 'app-signin')).toBeNull();
    expect(document.querySelector('.vx-turnstile')).toBeNull();
  });

  it('the widget under the button: its token is used once, then it runs again; no panel is opened', async () => {
    vi.stubGlobal('fetch', answer({ turnstileSiteKey: '0xSITE' }));
    const calls: string[] = [];
    let opts: Record<string, unknown> = {};
    (window as unknown as { turnstile: unknown }).turnstile = {
      render: (_el: HTMLElement, o: Record<string, unknown>) => { opts = o; return 'w-under'; },
      reset: (id: string) => calls.push(`reset:${id}`),
      remove: (id: string) => calls.push(`remove:${id}`),
    };
    const el = document.createElement('div');
    document.body.appendChild(el);
    const remove = await mountTurnstile(el, '', 'app-signin');
    expect(typeof remove).toBe('function');
    expect(opts).toMatchObject({ sitekey: '0xSITE', action: 'app-signin', 'refresh-expired': 'auto' });
    expect(opts).not.toHaveProperty('appearance');
    // Signing in before the check finished waits for it.
    const pending = turnstileToken('', 'app-signin');
    (opts.callback as (t: string) => void)('tok-1');
    expect(await pending).toBe('tok-1');
    expect(calls).toEqual(['reset:w-under']);
    // A ready token is taken at once.
    (opts.callback as (t: string) => void)('tok-2');
    expect(await turnstileToken('', 'app-signin')).toBe('tok-2');
    expect(document.querySelector('.vx-turnstile')).toBeNull();
    (remove as () => void)();
    expect(calls).toContain('remove:w-under');
    el.remove();
  });

  it('nothing is drawn while the check is off', async () => {
    vi.stubGlobal('fetch', answer({ turnstileSiteKey: null }));
    const el = document.createElement('div');
    document.body.appendChild(el);
    expect(await mountTurnstile(el, '', 'app-signin')).toBe(false);
    expect(el.childElementCount).toBe(0);
    el.remove();
  });
});
