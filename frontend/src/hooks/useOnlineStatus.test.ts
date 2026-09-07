/**
 * v5.11.5 — navigator.onLine=false is only a hint: Chrome on macOS reports it
 * under a VPN/virtual adapter with the network working. The hook must verify
 * with a real request before showing "You're offline".
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { probeOnline, useOnlineStatus } from './useOnlineStatus';

const setOnLine = (v: boolean) => Object.defineProperty(navigator, 'onLine', { value: v, configurable: true });

afterEach(() => {
  vi.restoreAllMocks();
  setOnLine(true);
});

describe('probeOnline', () => {
  it('any HTTP answer means online; only a thrown fetch means offline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    expect(await probeOnline()).toBe(true);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    expect(await probeOnline()).toBe(false);
  });

  it('probes with HEAD and no-store so the service worker / HTTP cache cannot answer for the network', async () => {
    const f = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', f);
    await probeOnline();
    expect(f).toHaveBeenCalledWith('/manifest.webmanifest', expect.objectContaining({ method: 'HEAD', cache: 'no-store' }));
  });
});

describe('useOnlineStatus', () => {
  it('overrides a false navigator.onLine when the network actually answers', async () => {
    setOnLine(false);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    const { result } = renderHook(() => useOnlineStatus());
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('stays offline when the probe also fails', async () => {
    setOnLine(false);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(false);
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current).toBe(false);
  });

  it('trusts navigator.onLine=true without probing', () => {
    setOnLine(true);
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);
    expect(f).not.toHaveBeenCalled();
  });
});
